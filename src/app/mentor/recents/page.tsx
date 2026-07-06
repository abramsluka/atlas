import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import RecentsClient from './RecentsClient'

export default async function MentorRecentsPage() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) redirect('/login')

  return <RecentsClient />
}
