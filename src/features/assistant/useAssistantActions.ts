'use client'

// Maps a confirmed AssistantAction to the same TanStack mutation the manual UI
// uses — no new write paths. Day keys follow each host page's convention:
// rolledDate() (6am rollover) for supplements/water, local calendar date for
// caffeine, weight, journal, and check-ins.

import { useCallback } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { rolledDate } from '@/features/food/date'
import { toLocalDate } from '@/lib/date'
import { useGymConfig, useGymExercises } from '@/features/gym/queries'
import {
  useLogSet, useCreateExercise, useUpdateExercise, useDeleteExercise, useSaveGymConfig, useLogBodyWeight,
} from '@/features/gym/mutations'
import { useLogSupplementDose, useLogWater, useLogCaffeine } from '@/features/health/mutations'
import { useLogManualFood } from '@/features/food/mutations'
import { useCreateEntry } from '@/features/journal/mutations'
import { useSaveMorningCheckin, useSaveEveningCheckin } from '@/features/checkins/mutations'
import type { GymExercise } from '@/features/gym/types'
import type { AssistantAction } from './actions'
import type { GeneratorPrefill } from '@/app/gym/ProgramGenerator'

export const GENERATOR_PREFILL_KEY = 'atlas-generator-prefill'
export const GENERATOR_PREFILL_EVENT = 'atlas:generate-program'

const browserTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone

export function useAssistantActions() {
  const router = useRouter()
  const pathname = usePathname()

  const { data: config } = useGymConfig()
  const { data: exercises = [] } = useGymExercises()
  const units = config?.units ?? 'lbs'

  const rolledToday = rolledDate()
  const localToday = toLocalDate(browserTz())

  const logSet = useLogSet()
  const createEx = useCreateExercise()
  const updateEx = useUpdateExercise()
  const deleteEx = useDeleteExercise()
  const saveConfig = useSaveGymConfig()
  const logWeight = useLogBodyWeight()
  const logDose = useLogSupplementDose(rolledToday)
  const logWater = useLogWater(rolledToday)
  const logCaffeine = useLogCaffeine(localToday)
  const logFood = useLogManualFood()
  const createEntry = useCreateEntry()
  const saveMorning = useSaveMorningCheckin(localToday)
  const saveEvening = useSaveEveningCheckin(localToday)

  const nextOrder = useCallback(
    () => (exercises.length ? Math.max(...exercises.map(e => e.order_index)) + 1 : 0),
    [exercises],
  )

  // Throws on failure — callers flip the card to its error state.
  const executeAction = useCallback(async (a: AssistantAction): Promise<void> => {
    switch (a.kind) {
      case 'log_set':
        await logSet.mutateAsync({ exercise_id: a.exercise_id, weight: a.weight, reps: a.reps })
        return
      case 'log_supplement_dose':
        await logDose.mutateAsync({ supplement_id: a.supplement_id, time_slot: a.time_slot })
        return
      case 'log_weight':
        await logWeight.mutateAsync({ date_key: localToday, weight: a.weight })
        return
      case 'log_water':
        await logWater.mutateAsync(a.amount_oz)
        return
      case 'log_caffeine':
        await logCaffeine.mutateAsync({ source: a.source, amount_mg: a.amount_mg })
        return
      case 'log_food':
        // /api/health/food/log sets the date (rolledDate), fires the hydrating
        // → water side-effect, and upserts the frequents library.
        await logFood.mutateAsync({
          source: a.is_hydrating ? 'drink' : 'text',
          item_name: a.item_name,
          calories: a.calories,
          protein_g: a.protein_g,
          carbs_g: a.carbs_g,
          portion_desc: a.portion_desc,
          is_hydrating: a.is_hydrating,
          volume_oz: a.volume_oz,
          confidence: a.confidence,
          notes: a.notes,
        })
        return
      case 'add_journal_note':
        await createEntry.mutateAsync({ date: localToday, body: a.body, mood: a.mood ?? undefined })
        return
      case 'checkin_note':
        if (a.slot === 'morning') await saveMorning.mutateAsync({ planned: a.trained, intent: a.text ?? undefined })
        else await saveEvening.mutateAsync({ trained: a.trained, reflection: a.text ?? undefined })
        return
      case 'adjust_exercise': {
        const upd: Partial<GymExercise> & { id: string } = { id: a.exercise_id }
        if (a.rep_min != null) upd.rep_min = a.rep_min
        if (a.rep_max != null) upd.rep_max = a.rep_max
        if (a.step != null) upd.step = a.step
        await updateEx.mutateAsync(upd)
        return
      }
      case 'add_exercise':
        await createEx.mutateAsync({
          name: a.name, gym_id: a.gym_id, day_ids: a.day_ids, bodyweight: a.bodyweight,
          start_weight: 0, rep_min: a.rep_min, rep_max: a.rep_max, step: a.step, order_index: nextOrder(),
        })
        return
      case 'remove_exercise':
        await deleteEx.mutateAsync(a.exercise_id)
        return
      case 'swap_exercise':
        await deleteEx.mutateAsync(a.out_exercise_id)
        await createEx.mutateAsync({
          name: a.in_name, gym_id: a.gym_id, day_ids: a.day_ids, bodyweight: a.bodyweight,
          start_weight: 0, rep_min: a.rep_min, rep_max: a.rep_max, step: a.step, order_index: nextOrder(),
        })
        return
      case 'propose_workout': {
        let dayId = a.existing_day_id
        if (!dayId && config) {
          const newDay = { id: `d_${Date.now()}`, name: a.day_name }
          await saveConfig.mutateAsync({ ...config, days: [...config.days, newDay] })
          dayId = newDay.id
        }
        if (!dayId) throw new Error('no day')
        let order = nextOrder()
        for (const ex of a.exercises) {
          await createEx.mutateAsync({
            name: ex.name, gym_id: a.gym_id, day_ids: [dayId], bodyweight: ex.bodyweight,
            start_weight: 0, rep_min: ex.rep_min, rep_max: ex.rep_max, step: ex.step, order_index: order++,
          })
        }
        return
      }
      case 'generate_program': {
        // Doesn't mutate — hands the prefill to GymClient's Program Generator.
        const prefill: GeneratorPrefill = { goal: a.goal, duration_weeks: a.duration_weeks, days_per_week: a.days_per_week, structure: a.structure, auto: true }
        if (pathname.startsWith('/gym')) {
          window.dispatchEvent(new CustomEvent(GENERATOR_PREFILL_EVENT, { detail: prefill }))
        } else {
          try { sessionStorage.setItem(GENERATOR_PREFILL_KEY, JSON.stringify(prefill)) } catch {}
          router.push('/gym')
        }
        return
      }
    }
  }, [logSet, logDose, logWeight, logWater, logCaffeine, logFood, createEntry, saveMorning, saveEvening, updateEx, createEx, deleteEx, saveConfig, config, nextOrder, localToday, pathname, router])

  return { executeAction, units }
}
