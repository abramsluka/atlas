import type { SupabaseClient } from '@supabase/supabase-js'
import { WEARABLE_PROVIDERS } from '@/features/health/wearableProvider'
import { subDays } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'

// ─── local types ─────────────────────────────────────────────────────────────

type GymLogRow = {
  logged_at: string
  exercise_id: string
  weight: number | null
  reps: number | null
  gym_exercises: { name: string } | null
}

type ExerciseRow = {
  id: string
  name: string
  created_at: string
}

type OuraRow = {
  date: string
  data: {
    sleep?: { score?: number; average_hrv?: number; total_sleep_duration?: number }
    readiness?: { score?: number }
    activity?: { steps?: number; active_calories?: number }
  }
}

type MoodRow = { date: string; mood: number }
type WeightRow = { date_key: string; weight: number }
type FoodRow = { date: string }
type WaterRow = { date: string; amount_oz: number }

// ─── helpers ──────────────────────────────────────────────────────────────────

function localDate(isoString: string, tz: string): string {
  return new Date(isoString).toLocaleDateString('en-CA', { timeZone: tz })
}

function dayOfWeek(dateStr: string): number {
  return new Date(dateStr + 'T12:00:00').getDay()
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(b + 'T12:00:00').getTime() - new Date(a + 'T12:00:00').getTime()) / 86400000,
  )
}

function linearSlope(points: Array<{ x: number; y: number }>): number {
  const n = points.length
  const sumX = points.reduce((s, p) => s + p.x, 0)
  const sumY = points.reduce((s, p) => s + p.y, 0)
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0)
  const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0)
  const denom = n * sumX2 - sumX * sumX
  if (denom === 0) return 0
  return (n * sumXY - sumX * sumY) / denom
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((s, v) => s + v, 0) / values.length
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// ─── main export ─────────────────────────────────────────────────────────────

export async function computePatterns(
  db: SupabaseClient,
  userId: string,
  tz: string,
  today: string,
): Promise<string> {
  try {
    const ninetyDaysAgo = formatInTimeZone(subDays(new Date(), 90), tz, 'yyyy-MM-dd')
    const sixtyDaysAgo = formatInTimeZone(subDays(new Date(), 60), tz, 'yyyy-MM-dd')
    const thirtyDaysAgo = formatInTimeZone(subDays(new Date(), 30), tz, 'yyyy-MM-dd')

    const [gymLogsRes, exercisesRes, wearableRes, moodsRes, weightsRes, foodRes, waterRes] =
      await Promise.all([
        db
          .from('gym_logs')
          .select('logged_at, exercise_id, weight, reps, gym_exercises(name)')
          .eq('user_id', userId)
          .gte('logged_at', new Date(Date.now() - 90 * 86400000).toISOString())
          .order('logged_at', { ascending: true }),

        db.from('gym_exercises').select('id, name, created_at').eq('user_id', userId),

        db
          .from('wearable_data')
          .select('date, provider, data')
          .eq('user_id', userId)
          .in('provider', WEARABLE_PROVIDERS)
          .gte('date', sixtyDaysAgo)
          .order('date', { ascending: true }),

        db
          .from('journal_entries')
          .select('date, mood')
          .eq('user_id', userId)
          .not('mood', 'is', null)
          .gte('date', sixtyDaysAgo)
          .order('date', { ascending: true }),

        db
          .from('body_weights')
          .select('date_key, weight')
          .eq('user_id', userId)
          .gte('date_key', sixtyDaysAgo)
          .order('date_key', { ascending: true }),

        db.from('food_logs').select('date').eq('user_id', userId).gte('date', thirtyDaysAgo),

        db
          .from('water_logs')
          .select('date, amount_oz')
          .eq('user_id', userId)
          .gte('date', thirtyDaysAgo),
      ])

    const gymLogs = (gymLogsRes.data ?? []) as unknown as GymLogRow[]
    const exercises = (exercisesRes.data ?? []) as ExerciseRow[]
    const wearable = (wearableRes.data ?? []) as OuraRow[]
    const moods = (moodsRes.data ?? []) as MoodRow[]
    const weights = (weightsRes.data ?? []) as WeightRow[]
    const foodDates = (foodRes.data ?? []) as FoodRow[]
    const waterLogs = (waterRes.data ?? []) as WaterRow[]

    const findings: string[] = []

    // ── 1. Training Consistency by Day of Week ───────────────────────────────

    const trainingDaySet90 = new Set<string>()
    for (const log of gymLogs) {
      trainingDaySet90.add(localDate(log.logged_at, tz))
    }

    const allDays90: string[] = []
    for (let i = 89; i >= 0; i--) {
      allDays90.push(formatInTimeZone(subDays(new Date(), i), tz, 'yyyy-MM-dd'))
    }

    const weeksWithData = new Set<string>()
    for (const d of trainingDaySet90) {
      const dt = new Date(d + 'T12:00:00')
      const weekKey = `${dt.getFullYear()}-W${Math.floor(
        (dt.getTime() - new Date(dt.getFullYear(), 0, 1).getTime()) / (7 * 86400000),
      )}`
      weeksWithData.add(weekKey)
    }

    if (weeksWithData.size >= 4) {
      const dowTotal = new Array(7).fill(0)
      const dowTrained = new Array(7).fill(0)

      for (const d of allDays90) {
        const dow = dayOfWeek(d)
        dowTotal[dow]++
        if (trainingDaySet90.has(d)) dowTrained[dow]++
      }

      let bestDow = -1
      let bestPct = -1
      let worstDow = -1
      let worstPct = 101

      for (let dow = 0; dow < 7; dow++) {
        if (dowTotal[dow] < 4) continue
        const pct = (dowTrained[dow] / dowTotal[dow]) * 100
        if (pct > bestPct) { bestPct = pct; bestDow = dow }
        if (pct < worstPct) { worstPct = pct; worstDow = dow }
      }

      const parts: string[] = []
      if (bestDow >= 0 && bestPct >= 75) {
        parts.push(`Your most consistent training day is ${DAY_NAMES[bestDow]} (${Math.round(bestPct)}% of ${DAY_NAMES[bestDow]}s).`)
      }
      if (worstDow >= 0 && worstPct <= 40 && worstDow !== bestDow) {
        parts.push(`You skip ${DAY_NAMES[worstDow]}s most often — only ${Math.round(worstPct)}% consistency over 12 weeks.`)
      }
      if (parts.length > 0) findings.push(parts.join(' '))
    }

    // ── 2. Training Frequency Trend ──────────────────────────────────────────

    // group training days into ISO-style week buckets (days since epoch / 7)
    const trainingDaysSorted = Array.from(trainingDaySet90).sort()

    const weekBuckets: Map<number, Set<string>> = new Map()
    for (const d of trainingDaysSorted) {
      const msFromEpoch = new Date(d + 'T12:00:00').getTime()
      const weekNum = Math.floor(msFromEpoch / (7 * 86400000))
      if (!weekBuckets.has(weekNum)) weekBuckets.set(weekNum, new Set())
      weekBuckets.get(weekNum)!.add(d)
    }

    // also need to include weeks with zero sessions — get the current week and 11 prior
    const nowMs = new Date().getTime()
    const currentWeekNum = Math.floor(nowMs / (7 * 86400000))
    // last 12 complete weeks (exclude current partial week)
    const recentWeeks: number[] = []
    for (let i = 12; i >= 1; i--) {
      recentWeeks.push(currentWeekNum - i)
    }

    if (recentWeeks.length >= 12) {
      // check if we have enough gym log history (at least 6 weeks)
      const weeksWithAnyTraining = recentWeeks.filter(w => (weekBuckets.get(w)?.size ?? 0) > 0)
      if (weeksWithAnyTraining.length >= 6) {
        const first6 = recentWeeks.slice(0, 6)
        const last6 = recentWeeks.slice(6, 12)

        const avg = (weeks: number[]) =>
          weeks.reduce((s, w) => s + (weekBuckets.get(w)?.size ?? 0), 0) / weeks.length

        const first6Avg = avg(first6)
        const last6Avg = avg(last6)
        const diff = last6Avg - first6Avg

        const last2 = recentWeeks.slice(10, 12)
        const last2Sessions = last2.reduce((s, w) => s + (weekBuckets.get(w)?.size ?? 0), 0)

        if (last2Sessions === 0) {
          findings.push(
            `You haven't trained in the past 2 weeks — that's a complete gap.`,
          )
        } else if (Math.abs(diff) >= 1) {
          if (diff < 0) {
            findings.push(
              `Your training frequency has dropped: ${first6Avg.toFixed(1)} sessions/week 6 weeks ago vs ${last6Avg.toFixed(1)} sessions/week recently.`,
            )
          } else {
            findings.push(
              `Your training consistency is improving: up from ${first6Avg.toFixed(1)} to ${last6Avg.toFixed(1)} sessions/week over the past 6 weeks.`,
            )
          }
        }
      }
    }

    // ── 3. Most Skipped Exercises ─────────────────────────────────────────────

    if (exercises.length >= 3 && trainingDaySet90.size > 0 && gymLogs.length > 0) {
      // only check if we have 28+ days of history
      const firstLog = gymLogs[0]?.logged_at
      if (firstLog) {
        const daysSinceFirst = daysBetween(localDate(firstLog, tz), today)
        if (daysSinceFirst >= 28) {
          // last logged_at per exercise_id
          const lastLogged: Map<string, string> = new Map()
          for (const log of gymLogs) {
            const existing = lastLogged.get(log.exercise_id)
            if (!existing || log.logged_at > existing) {
              lastLogged.set(log.exercise_id, log.logged_at)
            }
          }

          const skipped: Array<{ name: string; days: number }> = []
          for (const ex of exercises) {
            const lastIso = lastLogged.get(ex.id)
            let daysSince: number
            if (!lastIso) {
              daysSince = 91
            } else {
              daysSince = daysBetween(localDate(lastIso, tz), today)
            }
            if (daysSince >= 21) {
              skipped.push({ name: ex.name, days: daysSince > 90 ? 90 : daysSince })
            }
          }

          skipped.sort((a, b) => b.days - a.days)
          for (const s of skipped.slice(0, 2)) {
            const daysStr = s.days >= 90 ? '90+' : `${s.days}`
            findings.push(`You haven't logged ${s.name} in ${daysStr} days. It's still in your program.`)
          }
        }
      }
    }

    // ── 4. HRV: Training Days vs Rest Days ───────────────────────────────────

    const trainingDaySet60 = new Set<string>()
    for (const log of gymLogs) {
      const d = localDate(log.logged_at, tz)
      if (d >= sixtyDaysAgo) trainingDaySet60.add(d)
    }

    if (wearable.length >= 14 && trainingDaySet60.size >= 8) {
      const trainingHRV: number[] = []
      const restHRV: number[] = []

      for (const row of wearable) {
        const hrv = row.data?.sleep?.average_hrv
        if (hrv == null) continue
        if (trainingDaySet60.has(row.date)) {
          trainingHRV.push(hrv)
        } else {
          restHRV.push(hrv)
        }
      }

      if (trainingHRV.length >= 5 && restHRV.length >= 5) {
        const trainMean = trainingHRV.reduce((s, v) => s + v, 0) / trainingHRV.length
        const restMean = restHRV.reduce((s, v) => s + v, 0) / restHRV.length
        const diff = restMean - trainMean

        if (Math.abs(diff) >= 4) {
          findings.push(
            `Your HRV averages ${Math.round(restMean)}ms on rest days vs ${Math.round(trainMean)}ms on training days — ${Math.round(Math.abs(diff))}ms suppression after hard sessions.`,
          )
        } else {
          findings.push(
            `Your HRV holds steady between training and rest days (${Math.round(trainMean)}ms vs ${Math.round(restMean)}ms) — good recovery.`,
          )
        }
      }
    }

    // ── 5. Sleep Score Variance ───────────────────────────────────────────────

    const sleepScores = wearable
      .map(r => r.data?.sleep?.score)
      .filter((v): v is number => v != null)

    if (sleepScores.length >= 21) {
      const σ = stdDev(sleepScores)
      const min = Math.min(...sleepScores)
      const max = Math.max(...sleepScores)

      let varianceLabel: string
      if (σ < 5) varianceLabel = 'very consistent'
      else if (σ < 10) varianceLabel = 'moderate variance'
      else varianceLabel = 'high variance'

      // 14-day trend: first 7 vs last 7
      const sorted = [...wearable]
        .filter(r => r.data?.sleep?.score != null)
        .map(r => r.data.sleep!.score as number)

      const trendParts: string[] = []
      if (sorted.length >= 14) {
        const first7Avg = sorted.slice(0, 7).reduce((s, v) => s + v, 0) / 7
        const last7Avg = sorted.slice(-7).reduce((s, v) => s + v, 0) / 7
        const trendDiff = last7Avg - first7Avg
        if (Math.abs(trendDiff) >= 5) {
          const dir = trendDiff > 0 ? 'trending up' : 'trending down'
          trendParts.push(
            `Sleep score ${dir}: ${Math.round(first7Avg)} avg early vs ${Math.round(last7Avg)} avg this week.`,
          )
        }
      }

      if (σ >= 10) {
        findings.push(
          `Your sleep score has ${varianceLabel} (σ=${Math.round(σ)}, range ${min}–${max}). Inconsistent sleep is probably your biggest recovery variable.${trendParts.length ? ' ' + trendParts[0] : ''}`,
        )
      } else if (trendParts.length) {
        findings.push(trendParts[0])
      }
    }

    // ── 6. Mood vs Training Correlation ──────────────────────────────────────

    if (moods.length >= 10 && trainingDaySet60.size >= 10) {
      const trainingMoods: number[] = []
      const restMoods: number[] = []

      for (const m of moods) {
        if (trainingDaySet60.has(m.date)) {
          trainingMoods.push(m.mood)
        } else {
          restMoods.push(m.mood)
        }
      }

      if (trainingMoods.length >= 5 && restMoods.length >= 5) {
        const trainMean = trainingMoods.reduce((s, v) => s + v, 0) / trainingMoods.length
        const restMean = restMoods.reduce((s, v) => s + v, 0) / restMoods.length
        const diff = trainMean - restMean

        if (Math.abs(diff) >= 0.5) {
          findings.push(
            `Your mood scores average ${trainMean.toFixed(1)} on days you train vs ${restMean.toFixed(1)} on rest days — training is ${diff > 0 ? 'clearly lifting your baseline' : 'correlated with lower mood on those days'}.`,
          )
        } else {
          findings.push(
            `Your mood doesn't correlate strongly with training days (${trainMean.toFixed(1)} vs ${restMean.toFixed(1)}).`,
          )
        }
      }
    }

    // ── 7. Body Weight Trend ─────────────────────────────────────────────────

    if (weights.length >= 8) {
      const sorted = [...weights].sort((a, b) => a.date_key.localeCompare(b.date_key))
      const firstDate = sorted[0].date_key
      const lastDate = sorted[sorted.length - 1].date_key
      const spanDays = daysBetween(firstDate, lastDate)

      if (spanDays >= 14) {
        const points = sorted.map(w => ({
          x: daysBetween(firstDate, w.date_key),
          y: w.weight,
        }))
        const slopePerDay = linearSlope(points)
        const slopePerWeek = slopePerDay * 7

        const firstWeight = sorted[0].weight
        const lastWeight = sorted[sorted.length - 1].weight
        const weeksSpan = Math.round(spanDays / 7)

        if (Math.abs(slopePerWeek) >= 0.1) {
          const dir = slopePerWeek > 0 ? 'up' : 'declining'
          const sign = slopePerWeek > 0 ? '+' : ''
          findings.push(
            `Your weight is trending ${dir} at ${sign}${slopePerWeek.toFixed(1)} lbs/week over the past ${weeksSpan} weeks (${firstWeight} → ${lastWeight} lbs).`,
          )
        }
      }
    }

    // ── 8. Calorie Tracking Consistency ──────────────────────────────────────

    const loggedFoodDates = new Set(foodDates.map(r => r.date))
    const totalWindowDays = Math.min(30, daysBetween(thirtyDaysAgo, today) + 1)
    const trackingRate = totalWindowDays > 0 ? (loggedFoodDates.size / totalWindowDays) * 100 : 0

    if (totalWindowDays >= 14) {
      if (trackingRate < 60) {
        findings.push(
          `You've been tracking food on only ${loggedFoodDates.size} of the last ${totalWindowDays} days (${Math.round(trackingRate)}%). Gaps in tracking mean Atlas is working with incomplete nutrition data.`,
        )
      } else if (trackingRate >= 85) {
        findings.push(
          `Strong food tracking: ${loggedFoodDates.size}/${totalWindowDays} days logged this month.`,
        )
      }
    }

    // ── 9. Hydration Pattern ──────────────────────────────────────────────────

    if (waterLogs.length >= 7) {
      const ozByDate: Map<string, number> = new Map()
      for (const r of waterLogs) {
        ozByDate.set(r.date, (ozByDate.get(r.date) ?? 0) + r.amount_oz)
      }

      const distinctDays = ozByDate.size
      const totalOz = Array.from(ozByDate.values()).reduce((s, v) => s + v, 0)
      const avgOz = totalOz / distinctDays
      const windowDays = Math.min(30, daysBetween(thirtyDaysAgo, today) + 1)
      const logRate = windowDays > 0 ? (distinctDays / windowDays) * 100 : 0

      if (logRate < 50) {
        findings.push(
          `Water tracking is sporadic: only ${distinctDays} of the past ${windowDays} days have any logs.`,
        )
      } else if (avgOz < 48) {
        findings.push(
          `You average ${Math.round(avgOz)} oz/day of water — below the typical 64 oz target.`,
        )
      }
    }

    // ── assemble ──────────────────────────────────────────────────────────────

    if (findings.length < 3) return ''

    return `COMPUTED PATTERNS (statistical facts, not summaries):\n${findings.map(f => `• ${f}`).join('\n')}`
  } catch (err) {
    console.error('[computePatterns] error:', err)
    return ''
  }
}
