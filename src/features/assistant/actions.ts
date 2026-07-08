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
  | {
      kind: 'log_food'
      item_name: string
      calories: number
      protein_g: number
      carbs_g: number
      portion_desc: string
      is_hydrating: boolean
      volume_oz: number | null
      confidence: 'low' | 'medium' | 'high'
      notes: string
    }
  | { kind: 'add_journal_note'; body: string; mood: number | null }
  | {
      kind: 'checkin_note'
      slot: 'morning' | 'evening'
      trained: boolean          // morning: training planned today; evening: actually trained
      text: string | null       // morning intent / evening reflection
    }
  | { kind: 'log_habit'; habit_id: string; habit_name: string; already_done: boolean }
  | { kind: 'log_all_habits' }
  // ── Day plan (today's morning journal checklist) ──
  | {
      kind: 'check_plan_item'
      entry_id: string
      item_id: string
      item_text: string
      done: boolean             // true = check off, false = un-check
      already_done: boolean     // true when the item is already in the requested state
    }
  | {
      kind: 'add_plan_item'
      entry_id: string
      text: string
      after_item_id: string | null  // insert after this item; null = append (or start)
      after_text: string | null     // display copy for the card
      at_start: boolean
    }
  | { kind: 'remove_plan_item'; entry_id: string; item_id: string; item_text: string }
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
  | { t: 'suggestions'; options: string[] } // tap-to-send follow-up chips (Orb; Mentor ignores)
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
    case 'log_food': {
      const macros = `${a.calories} cal · ${Math.round(a.protein_g)}g P · ${Math.round(a.carbs_g)}g C`
      const water = a.is_hydrating && a.volume_oz ? ` · +${a.volume_oz}oz water` : ''
      const rough = a.confidence === 'low' ? ' · rough estimate' : ''
      return { title: `Log ${a.item_name}`, detail: `${macros} · ${a.portion_desc}${water}${rough}`, confirmLabel: 'Log it', doneLabel: 'Logged' }
    }
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
    case 'log_habit':
      return { title: `Log ${a.habit_name}`, detail: a.already_done ? 'already done today' : 'mark done today', confirmLabel: 'Log it', doneLabel: 'Logged' }
    case 'log_all_habits':
      return { title: 'Log all habits', detail: 'mark every habit done today', confirmLabel: 'Log all', doneLabel: 'Logged' }
    case 'check_plan_item':
      return a.done
        ? {
            title: `Check off ${a.item_text}`,
            detail: a.already_done ? 'already checked off' : "today's plan",
            confirmLabel: 'Check it', doneLabel: 'Checked',
          }
        : {
            title: `Un-check ${a.item_text}`,
            detail: a.already_done ? 'already unchecked' : "today's plan",
            confirmLabel: 'Un-check', doneLabel: 'Unchecked',
          }
    case 'add_plan_item':
      return {
        title: `Add to plan: ${a.text}`,
        detail: a.at_start ? 'at the top' : a.after_text ? `after "${a.after_text}"` : 'at the end',
        confirmLabel: 'Add it', doneLabel: 'Added',
      }
    case 'remove_plan_item':
      return { title: `Remove ${a.item_text}`, detail: "from today's plan", confirmLabel: 'Remove', doneLabel: 'Removed' }
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
