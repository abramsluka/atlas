export interface HabitDay {
  date: string       // YYYY-MM-DD (local)
  done: boolean
  today: boolean
  future: boolean
}

export interface HabitView {
  id: string
  name: string
  emoji: string
  kind: 'auto' | 'manual'
  source: string | null
  perWeek: number
  order: number
  week: HabitDay[]     // current week, Monday → Sunday
  weeklyDone: number
  streakWeeks: number
}

export interface ToggleInput {
  id: string
  date: string
  completed: boolean
}

export interface HabitHistoryWeek {
  weekOffset: number
  startDate: string
  endDate: string
  dates: string[]
  habits: Array<{
    id: string
    name: string
    emoji: string
    perWeek: number
    done: boolean[]
    count: number
    hit: boolean
  }>
}
