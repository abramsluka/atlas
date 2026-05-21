import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { format } from 'date-fns'
import HomeClient from './HomeClient'

export default async function HomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const today = format(new Date(), 'yyyy-MM-dd')

  const { data: checkin } = await supabase
    .from('daily_checkins')
    .select('*')
    .eq('date', today)
    .maybeSingle()

  return <HomeClient today={today} initialCheckin={checkin} />
}
