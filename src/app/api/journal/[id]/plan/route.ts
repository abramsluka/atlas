import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import type { PlanItem } from '@/features/journal/types'
import { transcribeAudio, ensureEntryTranscript, entryContentForAI } from '@/lib/journalAudio'
import { generateTitle } from '@/lib/journalTitle'
import { getAnthropicForUser } from '@/lib/anthropic'
import { noKeyResponse, NoApiKeyError } from '@/lib/userKeys'
import { isAiLimitError, aiLimitResponse } from '@/lib/aiErrors'
import { getProfileBlock } from '@/lib/profile/getProfileBlock'

export const maxDuration = 60

const PLANNER_SYSTEM = `You turn a spoken or typed brain-dump into a clean, ordered plan for the day.

Rules:
- Output ONE line per distinct thing the person intends to do today.
- Preserve the order they intend. If they imply sequence ("first… then… after that…"), order accordingly. Otherwise keep the order they said things.
- Obey spoken corrections. Treat "scratch that", "actually", "no wait", "instead", "change that to", "never mind", "remove", "delete" as edits — apply them and do NOT include the retracted version. If they replace X with Y, output Y only.
- Merge duplicates. If they mention the same task twice, keep it once.
- Every line starts with a verb and is roughly 2–8 words: "Go to the range", "Work out at 11:00", "Eat pre-workout carbs". Bare noun fragments ("Range", "Climbing") are too terse. Full sentences with reasoning attached are too long.
- Keep their specifics — times, durations, places, named people, food options. Alternatives stay on one line: "Post-workout food: burrito, sushi, or sandwich".
- Rewrite their phrasing freely into a short action line. When they ramble, justify, or tell a story around a task, extract only the action and drop the story, filler, and self-talk ("um", "I guess", "I think maybe I should").
- Do NOT invent tasks, times, or detail they didn't say. Do NOT add commentary, encouragement, headers, numbering, or bullet characters.

Example brain-dump:
"Okay so today, um, I really need to finally get to that customer work for Fido, probably like 30 or 45 minutes of it. Then I was thinking I'd eat something before the gym, maybe cereal, because last time I trained fasted it was terrible. Gym at 11. And after, I don't know, I've been meaning to try that new burrito place, or maybe sushi. Oh and at some point tonight maybe the range, or climbing if Jake is down."

Example output:
{ "plan": ["Do Fido customer work for 30–45 min","Eat pre-workout cereal","Work out at 11:00","Get post-workout food: burrito or sushi","Go to the range or climbing with Jake"] }

Return a JSON object shaped { "plan": [...] } — the value is an array of strings, one string per plan item, in order.
If there is no actionable content, return { "plan": [] }.`

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
      instruction = await transcribeAudio(user.id, file, audioPath.split('/').pop() ?? 'audio.webm')
    } catch (err) {
      await db.storage.from('journal-audio').remove([refineAudioPath])
      if (err instanceof NoApiKeyError) return noKeyResponse(err.provider)
      if (isAiLimitError(err)) return aiLimitResponse()
      console.error('[journal/plan] transcription failed:', err)
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
      transcript = await ensureEntryTranscript(db, user.id, entry)
    } catch (err) {
      // A typed body can still be planned without the voice transcript
      if (err instanceof NoApiKeyError && !entry.body?.trim()) return noKeyResponse(err.provider)
      if (isAiLimitError(err) && !entry.body?.trim()) return aiLimitResponse()
      console.error('[journal/plan] entry transcription failed:', err)
      if (!(err instanceof NoApiKeyError) && !isAiLimitError(err) && !entry.body?.trim()) {
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

  const anthropic = await getAnthropicForUser(user.id)
  if (!anthropic) return noKeyResponse('anthropic')

  const profileBlock = await getProfileBlock(db, user.id, 'journal')

  let raw = ''
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1000,
      system: profileBlock ? `${PLANNER_SYSTEM}\n\n${profileBlock}` : PLANNER_SYSTEM,
      messages: [{ role: 'user', content: userMessage }],
      // Constrain the model to a JSON object we can always parse, instead of
      // hoping it returns a bare array we can regex out of prose. This is what
      // eliminates the "Could not parse plan from AI response" failures.
      output_config: {
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: { plan: { type: 'array', items: { type: 'string' } } },
            required: ['plan'],
            additionalProperties: false,
          },
        },
      },
    })
    raw = msg.content[0].type === 'text' ? msg.content[0].text : ''
  } catch (err) {
    if (isAiLimitError(err)) return aiLimitResponse()
    throw err
  }

  // Primary path: structured output is a { plan: [...] } object. Fallback: if the
  // model ever returns a bare array (or the format is unavailable), pull it out.
  let lines: string[] | null = null
  const toLines = (value: unknown): string[] | null =>
    Array.isArray(value) ? value.map(String).map(s => s.trim()).filter(Boolean) : null
  try {
    const parsed = JSON.parse(raw)
    lines = toLines(Array.isArray(parsed) ? parsed : parsed?.plan)
  } catch {
    const jsonMatch = raw.match(/\[[\s\S]*\]/)
    if (jsonMatch) {
      try { lines = toLines(JSON.parse(jsonMatch[0])) } catch { /* fall through */ }
    }
  }

  if (!lines) {
    console.error('[journal/plan] could not parse plan from AI response:', raw.slice(0, 500))
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

  // Every morning plan should carry a short auto-title. Re-read (transcription
  // inside this request may have titled it already), then title from the plan.
  if (plan.length > 0) {
    const { data: fresh } = await db
      .from('journal_entries')
      .select('title')
      .eq('id', id)
      .maybeSingle()
    if (fresh && !fresh.title) {
      const title = await generateTitle(user.id, lines.join('\n'), 'plan')
      if (title) {
        await db
          .from('journal_entries')
          .update({ title, updated_at: new Date().toISOString() })
          .eq('id', id)
      }
    }
  }

  return NextResponse.json({ plan })
}
