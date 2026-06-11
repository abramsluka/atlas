import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'
import { subDays } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import { getUserTimezone } from '@/lib/getUserTimezone'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function GET() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient()
  const { data } = await db
    .from('jot_syntheses')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return NextResponse.json(data ?? null)
}

export async function POST() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient()
  const TZ = await getUserTimezone(user.id)
  const fourteenDaysAgo = formatInTimeZone(subDays(new Date(), 14), TZ, 'yyyy-MM-dd')

  const { data: jots } = await db
    .from('jots')
    .select('content, created_at')
    .eq('user_id', user.id)
    .gte('created_at', new Date(fourteenDaysAgo).toISOString())
    .order('created_at', { ascending: false })

  if (!jots || jots.length < 5) {
    return NextResponse.json({ skipped: true, reason: 'not enough jots' })
  }

  const jotList = jots
    .map(j => `[${new Date(j.created_at).toDateString()}] ${j.content}`)
    .join('\n')

  const res = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    messages: [{
      role: 'user',
      content: `You are Atlas. Luka has been capturing thoughts in "The Void" over the past two weeks. Read them all and find the real patterns — not just surface themes, but what they reveal about where his head is at, what he keeps coming back to, what might be worth exploring. Be specific and honest. Write 3-5 sentences, conversational tone, no bullet points. Start directly — no preamble.

JOTS:
${jotList}`,
    }],
  })

  const synthesisText = res.content[0].type === 'text' ? res.content[0].text.trim() : ''

  const { data: synthesis } = await db
    .from('jot_syntheses')
    .insert({ user_id: user.id, synthesis_text: synthesisText, jot_count: jots.length })
    .select()
    .single()

  await db
    .from('mentor_context')
    .upsert({ user_id: user.id, last_synthesized_at: new Date().toISOString() }, { onConflict: 'user_id' })

  return NextResponse.json(synthesis)
}
