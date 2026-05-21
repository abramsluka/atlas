import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import WorkoutDetail from './WorkoutDetail'

interface Props {
  params: Promise<{ id: string }>
}

export default async function WorkoutDetailPage({ params }: Props) {
  const { id } = await params
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

  return (
    <WorkoutDetail
      workout={workout}
      initialCoachResponse={coachResponse?.response_text ?? null}
    />
  )
}
