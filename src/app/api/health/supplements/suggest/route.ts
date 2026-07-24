import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAnthropicForUser } from '@/lib/anthropic'
import { noKeyResponse } from '@/lib/userKeys'

export async function POST(req: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const anthropic = await getAnthropicForUser(user.id)
  if (!anthropic) return noKeyResponse('anthropic')

  const { name } = await req.json()
  if (!name?.trim()) return NextResponse.json({ dose: '', times: ['morning'] })

  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 100,
      messages: [
        {
          role: 'user',
          content: `The user wants to track the supplement '${name.trim()}'. What is the standard recommended dose and the typical time(s) of day to take it? Reply with JSON only, no markdown: {"dose": "5g", "times": ["morning"]} — times values must be one or more of: morning, evening.`,
        },
      ],
    })

    const text = message.content[0].type === 'text' ? message.content[0].text.trim() : ''
    // Extract JSON object even if model wraps it in markdown fences or leading text
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('no json in response')
    const parsed = JSON.parse(match[0])

    return NextResponse.json({
      dose: typeof parsed.dose === 'string' ? parsed.dose : '',
      times: Array.isArray(parsed.times)
        ? parsed.times.filter((t: string) => t === 'morning' || t === 'evening')
        : ['morning'],
    })
  } catch {
    return NextResponse.json({ dose: '', times: ['morning'] })
  }
}
