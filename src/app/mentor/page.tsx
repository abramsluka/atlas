import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import MentorClient from './MentorClient'

export default async function MentorPage() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) redirect('/login')

  return <MentorClient />
}
