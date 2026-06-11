import { createClient, createServiceClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'
import { NextRequest } from 'next/server'
import { subDays, subWeeks } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import { getUserTimezone } from '@/lib/getUserTimezone'
import { toLocalDate } from '@/lib/date'
import { getOuraContextRange, summarizeOuraForCoach } from '@/features/health/ouraContext'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: workoutId } = await params

  const authClient = await createClient()
  const {
    data: { user },
  } = await authClient.auth.getUser()

  if (!user) {
    return new Response('Unauthorized', { status: 401 })
  }

  const supabase = createServiceClient()
  const TZ = await getUserTimezone(user.id)

  function logDateTZ(utcStr: string): string {
    return formatInTimeZone(new Date(utcStr), TZ, 'yyyy-MM-dd')
  }

  const { data: workout, error: workoutError } = await supabase
    .from('workouts')
    .select(`
      *,
      exercises (
        *,
        sets (*)
      )
    `)
    .eq('id', workoutId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (workoutError || !workout) {
    return new Response('Workout not found', { status: 404 })
  }

  if (!workout.completed_at) {
    return new Response('Workout not completed', { status: 400 })
  }

  const fourWeeksAgo = subWeeks(new Date(), 4).toISOString()
  const today = toLocalDate(TZ)
  const thirtyDaysAgo = formatInTimeZone(subDays(new Date(), 30), TZ, 'yyyy-MM-dd')

  const [{ data: recentWorkouts }, { data: poLogs }, ouraRows] = await Promise.all([
    supabase
      .from('workouts')
      .select(`*, exercises (*, sets (*))`)
      .eq('user_id', user.id)
      .neq('id', workoutId)
      .not('completed_at', 'is', null)
      .gte('completed_at', fourWeeksAgo)
      .order('completed_at', { ascending: false }),
    supabase
      .from('po_logs')
      .select('*, po_exercises(name, bodyweight)')
      .eq('user_id', user.id)
      .gte('logged_at', fourWeeksAgo)
      .order('logged_at', { ascending: true }),
    getOuraContextRange(supabase, user.id, thirtyDaysAgo, today),
  ])

  function formatWorkout(w: typeof workout) {
    const exercises = (w.exercises ?? [])
      .slice()
      .sort((a: { order_index: number }, b: { order_index: number }) => a.order_index - b.order_index)
      .map((ex: { name: string; sets: Array<{ reps: number | null; weight_lbs: number | null; rpe: number | null; completed: boolean }> }) => {
        const sets = (ex.sets ?? [])
          .filter((s: { completed: boolean }) => s.completed)
          .map((s: { reps: number | null; weight_lbs: number | null; rpe: number | null }) =>
            `${s.reps ?? '?'} reps @ ${s.weight_lbs ?? '?'} lbs${s.rpe != null ? ` RPE ${s.rpe}` : ''}`
          )
          .join(', ')
        return `  ${ex.name || 'Unnamed'}: ${sets || 'no completed sets'}`
      })
      .join('\n')
    return `${w.name || 'Workout'} (${w.completed_at ? new Date(w.completed_at).toDateString() : 'in progress'})\n${exercises}`
  }

  const todaySection = formatWorkout(workout)
  const historySection = (recentWorkouts ?? [])
    .map(formatWorkout)
    .join('\n\n')

  // Build PO log history grouped by PST date
  type PoLog = { logged_at: string; weight: number; reps: number; po_exercises: { name: string; bodyweight: boolean }[] | null }
  const poByDate = new Map<string, PoLog[]>()
  for (const log of (poLogs ?? []) as unknown as PoLog[]) {
    const dk = logDateTZ(log.logged_at)
    const arr = poByDate.get(dk) ?? []
    arr.push(log)
    poByDate.set(dk, arr)
  }
  const poLines: string[] = []
  for (const [date, logs] of [...poByDate.entries()].sort()) {
    const byExercise = new Map<string, string[]>()
    for (const log of logs) {
      const ex = Array.isArray(log.po_exercises) ? log.po_exercises[0] : log.po_exercises
      const name = ex?.name ?? 'Unknown'
      const setStr = ex?.bodyweight
        ? `${log.reps} reps (bodyweight)`
        : `${log.reps} reps @ ${log.weight} lbs`
      const arr = byExercise.get(name) ?? []
      arr.push(setStr)
      byExercise.set(name, arr)
    }
    const exerciseLines = [...byExercise.entries()]
      .map(([name, sets]) => `  ${name}: ${sets.join(', ')}`)
      .join('\n')
    poLines.push(`${date}:\n${exerciseLines}`)
  }

  const recoverySummary = summarizeOuraForCoach(ouraRows)

  const userMessage = [
    `Today's workout:\n${todaySection}`,
    historySection ? `Recent history (last 4 weeks):\n${historySection}` : '',
    poLines.length > 0 ? `Progressive overload history (last 4 weeks):\n${poLines.join('\n\n')}` : '',
    recoverySummary ? `Recovery context (Oura, 30-day window):\n${recoverySummary}` : '',
  ].filter(Boolean).join('\n\n')

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const stream = anthropic.messages.stream({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    system: `You are a direct, no-nonsense strength training coach. Give honest, specific feedback on the user's workout in 3-5 sentences. Call out personal records if you spot them. Flag concerning patterns like missed sessions or volume drops. Note meaningful trends. If progressive overload history is provided, look for exercises stuck at the same weight, missed reps, or steady progress — factor that into your read. If recovery context (sleep, HRV, readiness) is provided and is notably low or short, or if the HRV is below baseline, factor it into your read on the session — but don't make excuses, just calibrate. Be direct — no cheerleading, no filler.`,
    messages: [{ role: 'user', content: userMessage }],
  })

  let fullText = ''

  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            const chunk = event.delta.text
            fullText += chunk
            controller.enqueue(new TextEncoder().encode(chunk))
          }
        }
      } finally {
        controller.close()
      }

      if (fullText) {
        await supabase.from('workout_coach_responses').upsert(
          { workout_id: workoutId, response_text: fullText },
          { onConflict: 'workout_id' }
        )
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
