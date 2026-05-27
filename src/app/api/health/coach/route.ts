import { NextRequest } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'
import { format, subDays } from 'date-fns'
import { getOuraContextRange } from '@/features/health/ouraContext'
import type { OuraData } from '@/features/health/types'

function fmtSleep(seconds: number | null | undefined): string {
  if (seconds == null) return '?'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${h}h${m}m`
}

function fmtTimeOfDay(iso: string): string {
  const d = new Date(iso)
  let h = d.getHours()
  const m = d.getMinutes()
  const ampm = h >= 12 ? 'pm' : 'am'
  h = h % 12 || 12
  return `${h}:${String(m).padStart(2, '0')}${ampm}`
}

export async function POST(_request: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const db = createServiceClient()
  const today = format(new Date(), 'yyyy-MM-dd')
  const sevenDaysAgo = format(subDays(new Date(), 7), 'yyyy-MM-dd')
  const fourteenDaysAgo = format(subDays(new Date(), 14), 'yyyy-MM-dd')

  const [
    ouraRows,
    supplementsResult,
    supplementLogsResult,
    caffeineResult,
    waterResult,
    profileResult,
  ] = await Promise.all([
    getOuraContextRange(db, user.id, sevenDaysAgo, today),
    db.from('supplements').select('*').eq('user_id', user.id).eq('active', true).order('created_at'),
    db.from('supplement_logs').select('*').eq('user_id', user.id).gte('date', sevenDaysAgo),
    db.from('caffeine_logs').select('*').eq('user_id', user.id).gte('date', sevenDaysAgo).order('logged_at'),
    db.from('water_logs').select('*').eq('user_id', user.id).gte('date', sevenDaysAgo),
    db.from('health_profile').select('*').eq('user_id', user.id).maybeSingle(),
  ])

  const supplements = supplementsResult.data ?? []
  const supplementLogs = supplementLogsResult.data ?? []
  const caffeineLogs = caffeineResult.data ?? []
  const waterLogs = waterResult.data ?? []
  const profile = profileResult.data

  // Build the body / Oura block (per-day)
  const ouraLines: string[] = []
  if (ouraRows.length > 0) {
    for (const row of ouraRows) {
      const d = row.data as OuraData
      ouraLines.push(
        `  ${row.date}: readiness ${d.readiness?.score ?? '?'}, sleep score ${d.sleep?.score ?? '?'}, slept ${fmtSleep(d.sleep?.total_sleep_duration)}, latency ${d.sleep?.latency != null ? Math.round(d.sleep.latency / 60) + 'min' : '?'}, deep ${fmtSleep(d.sleep?.deep_sleep_duration)}, REM ${fmtSleep(d.sleep?.rem_sleep_duration)}, HRV ${d.sleep?.average_hrv != null ? Math.round(d.sleep.average_hrv) + 'ms' : '?'}, RHR ${d.sleep?.resting_heart_rate != null ? Math.round(d.sleep.resting_heart_rate) + 'bpm' : '?'}`,
      )
    }
  }

  // Supplement summary + recent-change detection
  const fourteenAgoDate = new Date(fourteenDaysAgo + 'T00:00:00')
  const recentlyAdded = supplements.filter(s => new Date(s.created_at) >= fourteenAgoDate)
  const supplementLines: string[] = []
  for (const s of supplements) {
    const logCount = supplementLogs.filter(l => l.supplement_id === s.id).length
    const slots = (s.times ?? []).length || 1
    const expected = slots * 7
    const recent = new Date(s.created_at) >= fourteenAgoDate
    supplementLines.push(
      `  - ${s.name}${s.dose ? ' ' + s.dose : ''} (${(s.times ?? []).join('/') || 'anytime'}): logged ${logCount}/${expected} times this week${recent ? ` — ADDED ${Math.round((Date.now() - new Date(s.created_at).getTime()) / (24 * 60 * 60 * 1000))} days ago` : ''}`,
    )
  }

  // Caffeine — flag late-day intake which is the high-signal one
  const caffeineByDay = new Map<string, Array<{ time: string; mg: number; source: string }>>()
  for (const log of caffeineLogs) {
    const arr = caffeineByDay.get(log.date) ?? []
    arr.push({ time: fmtTimeOfDay(log.logged_at), mg: log.amount_mg, source: log.source })
    caffeineByDay.set(log.date, arr)
  }
  const caffeineLines: string[] = []
  for (const [date, entries] of [...caffeineByDay.entries()].sort()) {
    const total = entries.reduce((a, b) => a + b.mg, 0)
    const detail = entries.map(e => `${e.source} ${e.mg}mg @ ${e.time}`).join(', ')
    caffeineLines.push(`  ${date}: ${total}mg total — ${detail}`)
  }

  // Water — total per day vs target
  const target = profile?.daily_water_target_oz ?? null
  const waterByDay = new Map<string, number>()
  for (const log of waterLogs) {
    waterByDay.set(log.date, (waterByDay.get(log.date) ?? 0) + log.amount_oz)
  }
  const waterLines: string[] = []
  for (const [date, total] of [...waterByDay.entries()].sort()) {
    waterLines.push(`  ${date}: ${Math.round(total)}oz${target ? ` / ${target}oz target` : ''}`)
  }

  const userMessage = [
    'Last 7 days of my health data:',
    '',
    ouraLines.length > 0 ? `Body data (Oura, by day):\n${ouraLines.join('\n')}` : 'Body data: not connected or empty',
    '',
    supplementLines.length > 0 ? `Supplement stack:\n${supplementLines.join('\n')}` : 'Supplement stack: empty',
    recentlyAdded.length > 0 ? `\nNote: ${recentlyAdded.map(s => s.name).join(', ')} ${recentlyAdded.length === 1 ? 'was' : 'were'} added in the last 14 days — comment specifically on whether the body data shows any change since the addition.` : '',
    '',
    caffeineLines.length > 0 ? `Caffeine intake:\n${caffeineLines.join('\n')}` : 'Caffeine intake: none logged',
    '',
    waterLines.length > 0 ? `Water intake:\n${waterLines.join('\n')}` : 'Water intake: none logged',
  ].filter(Boolean).join('\n')

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    system: `You are Atlas, a personal health coach. The user is sharing the last 7 days of their wearable, supplement, caffeine, and hydration data. Cross-reference everything and give direct, specific, observation-driven feedback in 4–6 sentences. Priorities:

1. Caffeine timing vs sleep latency and deep sleep. If they had caffeine after 2pm and that night their latency was elevated or deep sleep was short, name it specifically with the numbers.
2. Supplement adherence vs sleep / HRV. If they're consistent on a supplement and HRV is up, say so. If they're missing doses, call it out.
3. Recently added supplements: compare body data before and after the addition. Honest read — is it doing anything visible yet?
4. Hydration only if there's a clear pattern.

Be specific with numbers. Don't list — write a tight paragraph. No bullet points, no headers. Don't cheerlead. If the data is too thin to draw conclusions, say that.`,
    messages: [{ role: 'user', content: userMessage }],
  })

  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            controller.enqueue(new TextEncoder().encode(event.delta.text))
          }
        }
      } finally {
        controller.close()
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
