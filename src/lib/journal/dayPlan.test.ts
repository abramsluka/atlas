import { describe, expect, it } from 'vitest'
import { journalDaysFor, pickDayPlan, type DayPlanRow } from './dayPlan'

const TZ = 'America/Los_Angeles'
// Nov 2026 is PST (UTC-8): local 00:28 on Nov 20 = 08:28Z
const local = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00-08:00`).toISOString()

describe('journalDaysFor', () => {
  it('counts a midnight-to-3am entry for both days', () => {
    expect(journalDaysFor('2026-11-19', local('2026-11-20', '00:28'), TZ)).toEqual(['2026-11-19', '2026-11-20'])
    expect(journalDaysFor('2026-11-19', local('2026-11-20', '02:59'), TZ)).toEqual(['2026-11-19', '2026-11-20'])
  })

  it('counts a normal entry for its own day only', () => {
    expect(journalDaysFor('2026-11-19', local('2026-11-19', '23:30'), TZ)).toEqual(['2026-11-19'])
    expect(journalDaysFor('2026-11-20', local('2026-11-20', '09:00'), TZ)).toEqual(['2026-11-20'])
  })

  it('ignores backfilled entries written days later', () => {
    expect(journalDaysFor('2026-11-15', local('2026-11-20', '01:00'), TZ)).toEqual(['2026-11-15'])
  })
})

describe('pickDayPlan', () => {
  const lateNight: DayPlanRow = { id: 'late', date: '2026-11-19', created_at: local('2026-11-20', '00:28'), plan: [] }
  const morning19: DayPlanRow = { id: 'm19', date: '2026-11-19', created_at: local('2026-11-19', '09:00'), plan: [] }

  it('shows the late-night plan on the ending day and the next day', () => {
    expect(pickDayPlan([lateNight, morning19], '2026-11-19', TZ)?.entryId).toBe('late')
    expect(pickDayPlan([lateNight, morning19], '2026-11-20', TZ)?.entryId).toBe('late')
  })

  it("does not carry a normal morning plan into the next day", () => {
    expect(pickDayPlan([morning19], '2026-11-20', TZ)).toBeNull()
  })

  it('prefers a newer plan written on the day itself', () => {
    const morning20: DayPlanRow = { id: 'm20', date: '2026-11-20', created_at: local('2026-11-20', '08:00'), plan: [] }
    expect(pickDayPlan([morning20, lateNight], '2026-11-20', TZ)?.entryId).toBe('m20')
  })
})
