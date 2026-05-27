import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import WorkoutDetail from './WorkoutDetail'

interface Props {
  params: Promise<{ id: string }>
  searchParams: Promise<{ from?: string }>
}

export default async function WorkoutDetailPage({ params, searchParams }: Props) {
  const { id } = await params
  const { from } = await searchParams

  const supabase = await createClient()

  const { data: workout } = await supabase
    .from('workouts')
    .select(`
      *,
      exercises (
        *,
        sets (*)
      )
    `)
    .eq('id', id)
    .maybeSingle()

  if (!workout) notFound()

  const { data: coachResponse } = await supabase
    .from('workout_coach_responses')
    .select('*')
    .eq('workout_id', id)
    .maybeSingle()

  const backHref = from === 'gym' ? '/workouts' : '/workouts/history'

  return (
    <WorkoutDetail
      workout={workout}
      initialCoachResponse={coachResponse?.response_text ?? null}
      backHref={backHref}
    />
  )
}
