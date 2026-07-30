import { getPageUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import RecentsClient from './RecentsClient'

export default async function MentorRecentsPage() {
  const user = await getPageUser()
  if (!user) redirect('/login')

  return <RecentsClient />
}
