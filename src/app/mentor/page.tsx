import { Suspense } from 'react'
import { getPageUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import MentorClient from './MentorClient'

export default async function MentorPage() {
  const user = await getPageUser()
  if (!user) redirect('/login')

  // MentorClient reads the ?c= search param → needs a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <MentorClient />
    </Suspense>
  )
}
