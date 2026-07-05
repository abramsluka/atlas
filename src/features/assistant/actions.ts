// Shared contract between the assistant chat API routes and the Orb / Mentor
// clients. The routes turn Claude tool calls into these proposals; the clients
// render them as confirm cards and only mutate on confirm. Descends from the
// gym coach's coachActions.ts — the gym kinds are ported unchanged.

import type { ProgramGoal, ProgramStructure } from '@/features/gym/programTypes'
import type { TimeSlot } from '@/features/health/types'

export type AssistantAction =
  // ── Logging (all modules) ──
  | {
      kind: 'log_set'
      exercise_id: string
      exercise_name: string
      weight: number
      reps: number
    }
  | {
      kind: 'log_supplement_dose'
      supplement_id: string
      supplement_name: string
      time_slot: TimeSlot
      already_logged: boolean   // true when today's log for this slot already exists
    }
  | { kind: 'log_weight'; weight: number }
  | { kind: 'log_water'; amount_oz: number }
  | { kind: 'log_caffeine'; source: string; amount_mg: number }
  | { kind: 'add_journal_note'; body: string; mood: number | null }
  | {
      kind: 'checkin_note'
      slot: 'morning' | 'evening'
      trained: boolean          // morning: training planned today; evening: actually trained
      text: string | null       // morning intent / evening reflection
    }
  // ── Gym coach (ported from coachActions.ts) ──
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
      day_name: string
      existing_day_id: string | null
      gym_id: string
      exercises: Array<{
        name: string
        rep_min: number
        rep_max: number
        step: number
        bodyweight: boolean
      }>
    }
  | {
      // Doesn't mutate on confirm — opens the Program Generator prefilled.
      kind: 'generate_program'
      goal: ProgramGoal
      duration_weeks: number
      days_per_week: number
      structure: ProgramStructure
    }

// NDJSON stream events (one JSON object per line) from the assistant routes.
// `meta` is sent first by the mentor route to hand the client its conversation id.
export type AssistantStreamEvent =
  | { t: 'meta'; conversation_id: string }
  | { t: 'text'; v: string }
  | { t: 'action'; action: AssistantAction }
  | { t: 'clarify'; question: string; options: string[] }
  | { t: 'error'; v: string }

export type ActionStatus = 'pending' | 'done' | 'dismissed' | 'error'
export interface ProposedAction { id: string; action: AssistantAction; status: ActionStatus }

// ── Card copy per action kind ─────────────────────────────────────────────────

export function describeAction(a: AssistantAction, units: string): { title: string; detail: string; confirmLabel: string; doneLabel: string } {
  switch (a.kind) {
    case 'log_set':
      return { title: `Log ${a.exercise_name}`, detail: `${a.weight} ${units} × ${a.reps} reps`, confirmLabel: 'Log it', doneLabel: 'Logged' }
    case 'log_supplement_dose':
      return {
        title: `Log ${a.supplement_name}`,
        detail: a.already_logged ? `${a.time_slot} slot — already logged today` : `${a.time_slot} slot`,
        confirmLabel: 'Log it', doneLabel: 'Logged',
      }
    case 'log_weight':
      return { title: 'Log body weight', detail: `${a.weight} ${units} today`, confirmLabel: 'Log it', doneLabel: 'Logged' }
    case 'log_water':
      return { title: 'Log water', detail: `${a.amount_oz} oz`, confirmLabel: 'Log it', doneLabel: 'Logged' }
    case 'log_caffeine':
      return { title: `Log caffeine — ${a.source}`, detail: `${a.amount_mg} mg`, confirmLabel: 'Log it', doneLabel: 'Logged' }
    case 'add_journal_note':
      return {
        title: 'Save journal note',
        detail: a.body.length > 90 ? `${a.body.slice(0, 90)}…` : a.body,
        confirmLabel: 'Save it', doneLabel: 'Saved',
      }
    case 'checkin_note':
      return {
        title: a.slot === 'morning' ? 'Morning check-in' : 'Evening check-in',
        detail: `${a.slot === 'morning' ? (a.trained ? 'Training planned' : 'Rest day') : (a.trained ? 'Trained' : "Didn't train")}${a.text ? ` — ${a.text}` : ''}`,
        confirmLabel: 'Save it', doneLabel: 'Saved',
      }
    case 'adjust_exercise': {
      const bits: string[] = []
      if (a.rep_min != null || a.rep_max != null) bits.push(`reps ${a.rep_min ?? '·'}–${a.rep_max ?? '·'}`)
      if (a.step != null) bits.push(`step +${a.step}`)
      return { title: `Adjust ${a.exercise_name}`, detail: bits.join(' · ') || 'update targets', confirmLabel: 'Apply', doneLabel: 'Updated' }
    }
    case 'add_exercise':
      return { title: `Add ${a.name}`, detail: `to ${a.day_label} · ${a.rep_min}–${a.rep_max} reps`, confirmLabel: 'Add it', doneLabel: 'Added' }
    case 'remove_exercise':
      return { title: `Remove ${a.exercise_name}`, detail: 'from your catalog', confirmLabel: 'Remove', doneLabel: 'Removed' }
    case 'swap_exercise':
      return { title: `Swap ${a.out_name} → ${a.in_name}`, detail: `in ${a.day_label}`, confirmLabel: 'Swap', doneLabel: 'Swapped' }
    case 'propose_workout':
      return {
        title: a.day_name,
        detail: `${a.exercises.length} exercise${a.exercises.length === 1 ? '' : 's'} → ${a.existing_day_id ? 'existing day' : 'new day'}`,
        confirmLabel: 'Add to my days', doneLabel: 'Added to your days',
      }
    case 'generate_program':
      return {
        title: 'Build a program',
        detail: `${a.duration_weeks}-wk ${a.goal} · ${a.days_per_week}/wk · ${a.structure === 'overlay' ? 'overlays your days' : 'standalone'}`,
        confirmLabel: 'Open generator', doneLabel: 'Opened generator',
      }
  }
}
