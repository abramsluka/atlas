import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function GET() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const dates: string[] = []
  for (let i = 13; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    dates.push(d.toISOString().split('T')[0])
  }
  const earliest = dates[0]

  const db = createServiceClient()
  const { data, error } = await db
    .from('water_logs')
    .select('date, amount_oz')
    .eq('user_id', user.id)
    .gte('date', earliest)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const totals: Record<string, number> = {}
  ;(data ?? []).forEach(row => {
    totals[row.date] = (totals[row.date] ?? 0) + row.amount_oz
  })

  // Return newest first
  const result = [...dates].reverse().map(d => ({ date: d, total_oz: totals[d] ?? 0 }))
  return NextResponse.json(result)
}
