// Shared contract between the gym chat API route and the GymChatbot client.
// The route turns Claude tool calls into these proposals; the client renders
// them as confirm cards and only mutates on confirm.

export type GymCoachAction =
  | {
      kind: 'log_set'
      exercise_id: string
      exercise_name: string
      weight: number
      reps: number
    }
  | {
      kind: 'adjust_exercise'
      exercise_id: string
      exercise_name: string
      rep_min: number | null
      rep_max: number | null
      step: number | null
    }
  | {
      kind: 'add_exercise'
      name: string
      gym_id: string
      day_ids: string[]
      day_label: string
      rep_min: number
      rep_max: number
      step: number
      bodyweight: boolean
    }
  | {
      kind: 'remove_exercise'
      exercise_id: string
      exercise_name: string
    }
  | {
      kind: 'swap_exercise'
      out_exercise_id: string
      out_name: string
      in_name: string
      gym_id: string
      day_ids: string[]
      day_label: string
      rep_min: number
      rep_max: number
      step: number
      bodyweight: boolean
    }
  | {
      kind: 'propose_workout'
      day_name: string            // label shown to the user
      existing_day_id: string | null  // null = create a new day
      gym_id: string
      exercises: Array<{
        name: string
        rep_min: number
        rep_max: number
        step: number
        bodyweight: boolean
      }>
    }

// NDJSON stream events (one JSON object per line) from /api/gym/chat.
export type CoachStreamEvent =
  | { t: 'text'; v: string }
  | { t: 'action'; action: GymCoachAction }
  | { t: 'error'; v: string }
