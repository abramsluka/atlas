import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'
import type { PlanItem } from '@/features/journal/types'
import { transcribeAudio, ensureEntryTranscript, entryContentForAI } from '@/lib/journalAudio'

export const maxDuration = 60

const PLANNER_SYSTEM = `You turn a spoken or typed brain-dump into a clean, ordered plan for the day.

Rules:
- Output ONE line per distinct thing the person intends to do today.
- Preserve the order they intend. If they imply sequence ("first… then… after that…"), order accordingly. Otherwise keep the order they said things.
- Obey spoken corrections. Treat "scratch that", "actually", "no wait", "instead", "change that to", "never mind", "remove", "delete" as edits — apply them and do NOT include the retracted version. If they replace X with Y, output Y only.
- Merge duplicates. If they mention the same task twice, keep it once.
- Strip filler, hedging, and self-talk ("um", "I guess", "I think maybe I should"). Keep only the action.
- Each line is short and action-first: "Morning run", "Gym — push day", "Deep work: Atlas planner", "Lunch with Alex". Imperative or noun phrase, not a sentence.
- Do NOT invent tasks, times, or detail they didn't say. Do NOT add commentary, encouragement, headers, numbering, or bullet characters.
- Keep their own wording where reasonable; you are tidying, not rewriting their day.

Return ONLY a JSON array of strings, one string per plan item, in order.
Example: ["Morning run","Gym — push day","Deep work: Atlas planner","Lunch with Alex"]
If there is no actionable content, return [].`

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient()
  const { data: entry, error } = await db
    .from('journal_entries')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (error || !entry) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (entry.kind !== 'morning') {
    return NextResponse.json({ error: 'Plan generation only applies to morning entries' }, { status: 400 })
  }

  const body = await request.json().catch(() => ({}))
  const audioPath: unknown = body.audioPath
  const message: unknown = body.message

  // Resolve the instruction/brain-dump text
  let instruction: string | null = null
  let refineAudioPath: string | null = null

  if (audioPath) {
    // Refine via a freshly-uploaded voice note. Path must be one we handed out:
    // this user's folder, this entry (same rule as the reply route).
    if (typeof audioPath !== 'string' || !audioPath.startsWith(`${user.id}/${id}_`)) {
      return NextResponse.json({ error: 'Invalid audio path' }, { status: 400 })
    }
    refineAudioPath = audioPath

    const { data: file, error: dlError } = await db.storage
      .from('journal-audio')
      .download(audioPath)
    if (dlError || !file) {
      return NextResponse.json({ error: 'Recording not found in storage' }, { status: 400 })
    }

    try {
      instruction = await transcribeAudio(file, audioPath.split('/').pop() ?? 'audio.webm')
    } catch (err) {
      console.error('[journal/plan] transcription failed:', err)
      await db.storage.from('journal-audio').remove([refineAudioPath])
      return NextResponse.json({ error: `Could not transcribe recording: ${err}` }, { status: 500 })
    }
    if (!instruction) {
      await db.storage.from('journal-audio').remove([refineAudioPath])
      return NextResponse.json({ error: 'Recording was empty or unintelligible' }, { status: 400 })
    }
  } else if (typeof message === 'string' && message.trim()) {
    instruction = message.trim()
  } else {
    // First generation — use the entry's own recording and/or typed body
    let transcript: string | null = null
    try {
      transcript = await ensureEntryTranscript(db, entry)
    } catch (err) {
      console.error('[journal/plan] entry transcription failed:', err)
      if (!entry.body?.trim()) {
        return NextResponse.json({ error: `Could not transcribe recording: ${err}` }, { status: 500 })
      }
    }
    instruction = entryContentForAI(entry.body, transcript) || null
    if (!instruction) {
      return NextResponse.json({ error: 'Entry has no content to plan from' }, { status: 400 })
    }
  }

  const currentPlan: PlanItem[] = entry.plan ?? []
  const isRefine = currentPlan.length > 0

  const userMessage = isRefine
    ? `This is my current plan for today:

<current_plan>
${currentPlan.map((p, i) => `${i + 1}. ${p.text}`).join('\n')}
</current_plan>

Apply this change and return the full updated plan in order:

<change>
${instruction}
</change>`
    : `Here is what I said I want to do today. Turn it into my ordered plan.

<brain_dump>
${instruction}
</brain_dump>`

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1000,
    system: PLANNER_SYSTEM,
    messages: [{ role: 'user', content: userMessage }],
  })

  const raw = msg.content[0].type === 'text' ? msg.content[0].text : ''
  const jsonMatch = raw.match(/\[[\s\S]*\]/)
  if (!jsonMatch) {
    return NextResponse.json({ error: 'Could not parse plan from AI response' }, { status: 500 })
  }

  let lines: string[]
  try {
    const parsed = JSON.parse(jsonMatch[0])
    if (!Array.isArray(parsed)) throw new Error('not an array')
    lines = parsed.map(String).map(s => s.trim()).filter(Boolean)
  } catch {
    return NextResponse.json({ error: 'Could not parse plan from AI response' }, { status: 500 })
  }

  // Preserve done state across refines: an unchanged line that was checked stays
  // checked; a reworded line resets to undone (the user changed it).
  const prevDone = new Set(
    currentPlan.filter(p => p.done).map(p => p.text.trim().toLowerCase())
  )
  const plan: PlanItem[] = lines.map(text => ({
    id: crypto.randomUUID(),
    text,
    done: prevDone.has(text.trim().toLowerCase()),
  }))

  const { error: saveError } = await db
    .from('journal_entries')
    .update({ plan, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (saveError) return NextResponse.json({ error: saveError.message }, { status: 500 })
  return NextResponse.json({ plan })
}
