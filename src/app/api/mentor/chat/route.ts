/*
-- ============================================================
-- MENTOR MIGRATION — run in Supabase SQL editor (or via supabase db push)
-- ============================================================

-- Quick-capture thoughts ("The Void")
create table if not exists jots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  created_at timestamptz default now()
);
alter table jots enable row level security;
create policy "Users access own jots" on jots
  for all using (auth.uid() = user_id);

-- Per-session memory summaries (rolling, capped at 20)
create table if not exists mentor_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  summary text not null,
  created_at timestamptz default now()
);
alter table mentor_memories enable row level security;
create policy "Users access own memories" on mentor_memories
  for all using (auth.uid() = user_id);

-- Living user profile (one row per user, upserted after each session)
create table if not exists mentor_context (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade unique,
  primary_goal text,
  about_me text,
  goal_last_comment text,
  last_synthesized_at timestamptz,
  updated_at timestamptz default now()
);
alter table mentor_context enable row level security;
create policy "Users access own context" on mentor_context
  for all using (auth.uid() = user_id);

-- Weekly synthesis reports
create table if not exists weekly_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  week_of date not null,
  report_text text not null,
  created_at timestamptz default now(),
  unique(user_id, week_of)
);
alter table weekly_reports enable row level security;
create policy "Users access own weekly reports" on weekly_reports
  for all using (auth.uid() = user_id);

-- Jot synthesis cards
create table if not exists jot_syntheses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  synthesis_text text not null,
  jot_count integer not null,
  created_at timestamptz default now()
);
alter table jot_syntheses enable row level security;
create policy "Users access own syntheses" on jot_syntheses
  for all using (auth.uid() = user_id);

-- NOTE: goals table NOT dropped — health_profile.linked_target_goal_id references it.
-- To clean up fully: ALTER TABLE health_profile DROP COLUMN linked_target_goal_id;
--                    DROP TABLE IF EXISTS habit_logs; DROP TABLE IF EXISTS goals;
*/

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'
import { subDays, subWeeks } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import { getUserTimezone } from '@/lib/getUserTimezone'
import { toLocalDate } from '@/lib/date'
import { getOuraContextRange, summarizeOuraForCoach } from '@/features/health/ouraContext'
import { computePatterns } from '@/lib/computePatterns'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ─── helpers ─────────────────────────────────────────────────────────────────

type GymLogRow = {
  logged_at: string
  weight: number | null
  reps: number | null
  exercise_id: string
  gym_exercises: { name: string } | null
}

function formatGymLogs(logs: GymLogRow[], tz: string): string {
  // Group by local date → exercise → sets
  const byDay: Record<string, Record<string, Array<{ reps: number | null; weight: number | null }>>> = {}
  for (const log of logs) {
    const date = new Date(log.logged_at).toLocaleDateString('en-CA', { timeZone: tz })
    const name = log.gym_exercises?.name ?? 'Unknown'
    if (!byDay[date]) byDay[date] = {}
    if (!byDay[date][name]) byDay[date][name] = []
    byDay[date][name].push({ reps: log.reps, weight: log.weight })
  }
  return Object.entries(byDay)
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 14)
    .map(([date, exercises]) => {
      const exLines = Object.entries(exercises)
        .map(([name, sets]) => {
          const setsStr = sets.map(s => `${s.reps ?? '?'} reps @ ${s.weight ?? '?'} lbs`).join(', ')
          return `  ${name}: ${setsStr}`
        })
        .join('\n')
      return `${date}:\n${exLines}`
    })
    .join('\n\n')
}

type JournalRow = {
  date: string
  title: string | null
  body: string
  mood: number | null
  audio_transcript: string | null
  ai_reflection: string | null
}

function formatJournalEntry(e: JournalRow): string {
  const contentParts: string[] = []
  if (e.body?.trim()) contentParts.push(e.body.trim())
  if (e.audio_transcript?.trim()) contentParts.push(`[Voice transcript]: ${e.audio_transcript.trim()}`)
  const content = contentParts.join('\n\n')
  const truncated = content.length > 400 ? content.slice(0, 400) + '…' : content

  const lines = [
    `${e.date}${e.title ? ` — "${e.title}"` : ''}`,
    e.mood != null ? `Mood: ${e.mood}/5` : null,
    truncated || '(no written content)',
    e.ai_reflection
      ? `↳ Atlas reflected: ${e.ai_reflection.length > 180 ? e.ai_reflection.slice(0, 180) + '…' : e.ai_reflection}`
      : null,
  ].filter(Boolean)
  return lines.join('\n')
}

type CheckinRow = {
  date: string
  morning_planned_training: string | null
  morning_intent: string | null
  evening_actual_training: string | null
  evening_reflection: string | null
}

function formatCheckin(c: CheckinRow): string {
  const lines: string[] = [`${c.date}:`]
  if (c.morning_planned_training) lines.push(`  Planned training: ${c.morning_planned_training}`)
  if (c.morning_intent) lines.push(`  Morning intent: ${c.morning_intent}`)
  if (c.evening_actual_training) lines.push(`  Actual training: ${c.evening_actual_training}`)
  if (c.evening_reflection) lines.push(`  Evening reflection: ${c.evening_reflection}`)
  return lines.join('\n')
}


type SupplementLogRow = {
  taken_at: string
  supplements: { name: string } | null
}

function formatSupplementLogs(logs: SupplementLogRow[]): string {
  const byDate: Record<string, string[]> = {}
  for (const log of logs) {
    const date = new Date(log.taken_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    if (!byDate[date]) byDate[date] = []
    if (log.supplements?.name) byDate[date].push(log.supplements.name)
  }
  return Object.entries(byDate)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, names]) => `${date}: ${names.join(', ')}`)
    .join('\n')
}

// ─── route ───────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { message, history } = await req.json() as {
    message: string
    history?: Array<{ role: 'user' | 'assistant'; content: string }>
  }

  if (!message?.trim()) return NextResponse.json({ error: 'message is required' }, { status: 400 })

  const db = createServiceClient()
  const TZ = await getUserTimezone(user.id)

  // Step 1 — load persistent context in parallel
  const [contextResult, memoriesResult] = await Promise.all([
    db.from('mentor_context').select('*').eq('user_id', user.id).maybeSingle(),
    db.from('mentor_memories').select('summary').eq('user_id', user.id).order('created_at', { ascending: false }).limit(5),
  ])

  const mentorCtx = contextResult.data as { primary_goal: string | null; about_me: string | null; goal_last_comment: string | null } | null
  const memories = (memoriesResult.data ?? []).map(m => m.summary)

  // Step 2 — date windows
  const fourWeeksAgo = subWeeks(new Date(), 4).toISOString()
  const today = toLocalDate(TZ)
  const fourteenDaysAgo = formatInTimeZone(subDays(new Date(), 14), TZ, 'yyyy-MM-dd')
  const sevenDaysAgo = formatInTimeZone(subDays(new Date(), 7), TZ, 'yyyy-MM-dd')
  const thirtyDaysAgo = formatInTimeZone(subDays(new Date(), 30), TZ, 'yyyy-MM-dd')

  // Start pattern computation concurrently with data fetches (has its own internal queries)
  const patternPromise = computePatterns(db, user.id, TZ, today)

  // Step 3 — fetch all data sources unconditionally
  const [
    gymLogData,
    ouraData,
    waterData,
    weightData,
    foodData,
    journalData,
    checkinData,
    jotData,
    healthProfileData,
    supplementLogData,
  ] = await Promise.all([
    db.from('gym_logs').select('logged_at, weight, reps, exercise_id, gym_exercises(name)').eq('user_id', user.id).gte('logged_at', fourWeeksAgo).order('logged_at', { ascending: false }).limit(200),
    getOuraContextRange(db, user.id, fourteenDaysAgo, today),
    db.from('water_logs').select('date, amount_oz').eq('user_id', user.id).gte('date', sevenDaysAgo).order('date', { ascending: false }),
    db.from('body_weights').select('date_key, weight').eq('user_id', user.id).gte('date_key', thirtyDaysAgo).order('date_key', { ascending: false }).limit(10),
    db.from('food_logs').select('date, item_name, calories, protein_g, carbs_g').eq('user_id', user.id).gte('date', sevenDaysAgo).order('date', { ascending: false }).limit(30),
    db.from('journal_entries').select('date, title, body, mood, audio_transcript, ai_reflection').eq('user_id', user.id).gte('date', fourteenDaysAgo).order('date', { ascending: false }).limit(14),
    db.from('daily_checkins').select('date, morning_planned_training, morning_intent, evening_actual_training, evening_reflection').eq('user_id', user.id).gte('date', sevenDaysAgo).order('date', { ascending: false }),
    db.from('jots').select('content, created_at').eq('user_id', user.id).gte('created_at', formatInTimeZone(subDays(new Date(), 14), TZ, "yyyy-MM-dd'T'HH:mm:ssxxx")).order('created_at', { ascending: false }).limit(20),
    db.from('health_profile').select('*').eq('user_id', user.id).maybeSingle(),
    db.from('supplement_logs').select('taken_at, supplements(name)').eq('user_id', user.id).gte('taken_at', formatInTimeZone(subDays(new Date(), 7), TZ, "yyyy-MM-dd'T'HH:mm:ssxxx")).order('taken_at', { ascending: false }).limit(30),
  ])

  // Step 4 — system prompt
  const parts: string[] = [
    `You are Atlas, Luka's personal AI mentor and life coach. You have been following his journey closely and know him deeply. You speak like a trusted advisor who has earned the right to be direct: honest, specific, occasionally challenging, always in his corner. You reference real numbers and real patterns when you have them. You don't pad responses with filler or motivation-poster language. You ask one good follow-up question when it would deepen the conversation. Keep responses conversational — this is a chat, not a report.

Read the tone and intent of what Luka is asking, and calibrate your approach accordingly:
- If he needs accountability, a hard truth, or a performance read — be direct and challenging. Don't soften it.
- If he seems to be processing something, thinking out loud, or working through a feeling — ask more questions than you answer. Help him think, don't just tell him what to think.
- If he wants a plan, next steps, or tactical guidance — give him specific, sequenced actions. Be concrete.
Shift naturally between these as the conversation evolves. Do not announce the mode or explain your approach — just do it.

When journal data is present: look for mood trends across entries (not just today's), recurring themes or words, and whether what he's writing about lines up with what he's doing physically. If his mood has been trending down, or the same thing keeps showing up across multiple entries, name it — don't wait for him to connect the dots.`,
  ]

  if (mentorCtx?.about_me) {
    parts.push(`WHO LUKA IS:\n${mentorCtx.about_me}`)
  }
  if (mentorCtx?.primary_goal) {
    parts.push(`Luka's current primary goal: ${mentorCtx.primary_goal}`)
  }
  if (mentorCtx?.goal_last_comment) {
    parts.push(`Last thing you told him about this goal: ${mentorCtx.goal_last_comment}`)
  }
  if (memories.length > 0) {
    parts.push(`CONTEXT FROM RECENT SESSIONS:\n${memories.map(m => `- ${m}`).join('\n')}`)
  }

  const patternText = await patternPromise
  if (patternText) {
    parts.push(patternText)
  }

  const systemPrompt = parts.join('\n\n')

  // Step 5 — build user message with data
  const dataSections: string[] = []

  if (gymLogData.data?.length) {
    const formatted = formatGymLogs(gymLogData.data as unknown as GymLogRow[], TZ)
    if (formatted) dataSections.push(`GYM TRAINING (last 4 weeks — grouped by day):\n${formatted}`)
  }

  if (Array.isArray(ouraData) && ouraData.length > 0) {
    const summary = summarizeOuraForCoach(ouraData)
    if (summary) dataSections.push(`OURA RECOVERY DATA:\n${summary}`)
  }

  if (waterData.data?.length) {
    const waterByDate: Record<string, number> = {}
    for (const row of waterData.data as Array<{ date: string; amount_oz: number }>) {
      waterByDate[row.date] = (waterByDate[row.date] ?? 0) + row.amount_oz
    }
    const waterLines = Object.entries(waterByDate)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, oz]) => `${date}: ${(oz / 33.814).toFixed(1)}L (${oz} oz)`)
      .join('\n')
    if (waterLines) dataSections.push(`WATER LOGS (last 7 days):\n${waterLines}`)
  }

  if (weightData.data?.length) {
    const weightLines = (weightData.data as Array<{ date_key: string; weight: number }>)
      .map(r => `${r.date_key}: ${r.weight} lbs`)
      .join('\n')
    if (weightLines) dataSections.push(`WEIGHT LOG (last 30 days):\n${weightLines}`)
  }

  if (foodData.data?.length) {
    const foodLines = (foodData.data as Array<{ date: string; item_name: string; calories: number | null; protein_g: number | null }>)
      .map(r => `${r.date}: ${r.item_name}${r.calories != null ? ` (${r.calories} kcal${r.protein_g != null ? `, ${r.protein_g}g protein` : ''})` : ''}`)
      .join('\n')
    if (foodLines) dataSections.push(`FOOD LOGS (last 7 days):\n${foodLines}`)
  }

  if (journalData.data?.length) {
    const entries = journalData.data as JournalRow[]
    const withContent = entries.filter(e => e.body?.trim() || e.audio_transcript?.trim())
    if (withContent.length > 0) {
      dataSections.push(`JOURNAL ENTRIES (last 2 weeks):\n${withContent.map(formatJournalEntry).join('\n\n')}`)
    }
  }

  if (checkinData.data?.length) {
    const checkins = checkinData.data as CheckinRow[]
    const withContent = checkins.filter(c =>
      c.morning_planned_training || c.morning_intent || c.evening_actual_training || c.evening_reflection
    )
    if (withContent.length > 0) {
      dataSections.push(`DAILY CHECK-INS (last 7 days):\n${withContent.map(formatCheckin).join('\n\n')}`)
    }
  }

  if (jotData.data?.length) {
    const jots = jotData.data as Array<{ content: string; created_at: string }>
    const jotLines = jots.map(j => {
      const ts = new Date(j.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: TZ })
      return `${ts}: ${j.content}`
    }).join('\n')
    dataSections.push(`JOTS (last 14 days):\n${jotLines}`)
  }

  if (healthProfileData.data) {
    const profile = healthProfileData.data as Record<string, unknown>
    const skip = new Set(['id', 'user_id', 'created_at', 'updated_at', 'linked_target_goal_id'])
    const profileLines = Object.entries(profile)
      .filter(([k, v]) => !skip.has(k) && v != null && v !== '')
      .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
      .join('\n')
    if (profileLines) dataSections.push(`HEALTH PROFILE:\n${profileLines}`)
  }

  if (supplementLogData.data?.length) {
    const formatted = formatSupplementLogs(supplementLogData.data as unknown as SupplementLogRow[])
    if (formatted) dataSections.push(`SUPPLEMENT LOGS (last 7 days):\n${formatted}`)
  }

  const userContent = dataSections.length > 0
    ? `${message}\n\n---\nDATA CONTEXT:\n${dataSections.join('\n\n')}`
    : message

  // Build messages array including prior history
  const priorMessages: Array<{ role: 'user' | 'assistant'; content: string }> = (history ?? []).slice(-10)
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    ...priorMessages,
    { role: 'user', content: userContent },
  ]

  // Step 6 — stream
  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 600,
    system: systemPrompt,
    messages,
  })

  let fullText = ''

  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            fullText += event.delta.text
            controller.enqueue(new TextEncoder().encode(event.delta.text))
          }
        }
      } finally {
        controller.close()
      }

      // Step 7 — background processing (no await before returning)
      if (fullText.length > 150) {
        // Operation A — memory summary
        Promise.resolve().then(async () => {
          try {
            const summaryRes = await anthropic.messages.create({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 200,
              messages: [{
                role: 'user',
                content: `Summarize this mentor conversation in 2-3 sentences. Focus on: what Luka asked about, what Atlas told him, any goals or intentions Luka expressed, and any notable patterns or insights. Be specific — include actual numbers or facts if they appeared. This will be used as long-term memory.\n\nUSER: ${message}\nATLAS: ${fullText}`,
              }],
            })
            const summary = summaryRes.content[0].type === 'text' ? summaryRes.content[0].text : ''
            if (summary) {
              await db.from('mentor_memories').insert({ user_id: user.id, summary })
              // Cap at 20
              const { data: allMemories } = await db.from('mentor_memories').select('id').eq('user_id', user.id).order('created_at', { ascending: false })
              if (allMemories && allMemories.length > 20) {
                const idsToDelete = allMemories.slice(20).map(m => m.id)
                await db.from('mentor_memories').delete().in('id', idsToDelete)
              }
            }
          } catch (e) { console.error('memory op failed', e) }
        })

        // Operation B — update living profile
        Promise.resolve().then(async () => {
          try {
            const currentProfile = mentorCtx?.about_me || 'No profile yet — this is the first session.'
            const profileRes = await anthropic.messages.create({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 600,
              messages: [{
                role: 'user',
                content: `You are updating a living profile document about Luka. Below is the current profile and a conversation that just happened. Rewrite the profile to incorporate anything new you learned — new goals, new patterns, new context, new struggles, new wins. Keep everything that's still accurate. Make it richer and more specific. The profile should read like a well-informed advisor's notes about someone they know well. Aim for 10-18 sentences. Write in third person.\n\nCURRENT PROFILE:\n${currentProfile}\n\nCONVERSATION:\nUSER: ${message}\nATLAS: ${fullText}\n\nWrite the updated profile now:`,
              }],
            })
            const newProfile = profileRes.content[0].type === 'text' ? profileRes.content[0].text.trim() : ''
            if (newProfile) {
              // Check for goal statement
              const lowerMsg = message.toLowerCase()
              const hasGoalStatement = /my goal is|i want to|i'm trying to|i'm aiming for|i am trying to|i am aiming for/.test(lowerMsg)

              // Check if goal progress was discussed
              const lowerReply = fullText.toLowerCase()
              const hasGoalProgress = mentorCtx?.primary_goal != null && (lowerReply.includes('goal') || lowerReply.includes('progress') || lowerReply.includes('track'))

              const goalLastComment = hasGoalProgress
                ? (() => {
                    const sentences = fullText.split(/[.!?]+/).filter(s => s.trim().length > 20)
                    const goalSentence = sentences.find(s => /goal|progress|track|aim|target/i.test(s))
                    return goalSentence?.trim() ?? null
                  })()
                : null

              let newGoal: string | null = null
              if (hasGoalStatement) {
                const goalExtract = await anthropic.messages.create({
                  model: 'claude-haiku-4-5-20251001',
                  max_tokens: 60,
                  messages: [{
                    role: 'user',
                    content: `Extract Luka's goal from this message in 3-8 words. Return ONLY the goal phrase, nothing else.\n\n"${message}"`,
                  }],
                })
                newGoal = goalExtract.content[0].type === 'text' ? goalExtract.content[0].text.trim() : null
              }

              await db.from('mentor_context').upsert({
                user_id: user.id,
                about_me: newProfile,
                ...(newGoal ? { primary_goal: newGoal } : {}),
                ...(goalLastComment ? { goal_last_comment: goalLastComment } : {}),
                updated_at: new Date().toISOString(),
              }, { onConflict: 'user_id' })
            }
          } catch (e) { console.error('profile op failed', e) }
        })
      }
    },
  })

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  })
}
