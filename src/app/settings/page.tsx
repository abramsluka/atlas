import { redirect } from 'next/navigation'
import { getPageUser } from '@/lib/supabase/server'
import SettingsClient from './SettingsClient'

export default async function SettingsPage() {
  const user = await getPageUser()
  if (!user) redirect('/login')

  return <SettingsClient email={user.email ?? ''} />
}
