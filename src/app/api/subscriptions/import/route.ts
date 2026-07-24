import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAnthropicForUser } from '@/lib/anthropic'
import { noKeyResponse } from '@/lib/userKeys'
import { BILLING_PERIODS, CURRENCIES, CATEGORIES } from '@/features/subscriptions/types'
import type { ImportedSubscription } from '@/features/subscriptions/types'

export const maxDuration = 60

const VALID_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const

function todayISO(): string {
  const t = new Date()
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
}

function sanitizeItem(item: unknown): ImportedSubscription | null {
  if (typeof item !== 'object' || item === null) return null
  const raw = item as Record<string, unknown>
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 80) : ''
  const amount = Number(raw.amount)
  if (!name || !Number.isFinite(amount) || amount < 0) return null

  const billing_period = BILLING_PERIODS.some((p) => p.value === raw.billing_period)
    ? (raw.billing_period as 'weekly' | 'monthly' | 'yearly')
    : 'monthly'
  const currency = (CURRENCIES as readonly string[]).includes(raw.currency as string)
    ? (raw.currency as string)
    : 'USD'
  const next_renewal =
    typeof raw.next_renewal === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.next_renewal)
      ? raw.next_renewal
      : null
  const category = (CATEGORIES as readonly string[]).includes(raw.category as string)
    ? (raw.category as string)
    : null

  return {
    name,
    amount: Math.round(amount * 100) / 100,
    currency,
    billing_period,
    next_renewal,
    category,
  }
}

export async function POST(request: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { imageBase64, mediaType } = body

  if (!imageBase64 || !mediaType) {
    return NextResponse.json({ error: 'Missing image data' }, { status: 400 })
  }
  if (!VALID_IMAGE_TYPES.includes(mediaType)) {
    return NextResponse.json({ error: 'Unsupported image type' }, { status: 400 })
  }

  const anthropic = await getAnthropicForUser(user.id)
  if (!anthropic) return noKeyResponse('anthropic')

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    system: `You extract subscription details from screenshots: receipts, confirmation emails, App Store subscription pages, bank/card statements, or settings pages listing recurring charges. Today's date is ${todayISO()}.

Rules:
- Extract EVERY distinct subscription visible in the image. A statement or list page may contain several.
- name: the service name only (e.g. "Netflix", "iCloud+"), not the full receipt line.
- amount: the recurring price per billing period as a number. If a free trial shows a price after the trial, use that price.
- billing_period: "weekly", "monthly", or "yearly" from context (/mo, per month, /yr, annual...). If genuinely unclear, use "monthly".
- currency: one of ${CURRENCIES.join(', ')}. Infer from the symbol ($ → USD, € → EUR, £ → GBP) unless context says otherwise.
- next_renewal: the next UPCOMING billing date as YYYY-MM-DD, only if it can be determined from the image (an explicit "renews on" date, or a visible charge date plus the billing period). Roll it forward past today if needed. Otherwise null.
- category: the best fit from [${CATEGORIES.join(', ')}], or null.
- Only report what is actually in the image. If the image contains no subscription information, return an empty array.`,
    tools: [
      {
        name: 'record_subscriptions',
        description: 'Record the subscriptions found in the screenshot',
        input_schema: {
          type: 'object' as const,
          properties: {
            subscriptions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  amount: { type: 'number' },
                  currency: { type: 'string', enum: [...CURRENCIES] },
                  billing_period: { type: 'string', enum: ['weekly', 'monthly', 'yearly'] },
                  next_renewal: { type: ['string', 'null'], description: 'YYYY-MM-DD or null' },
                  category: { type: ['string', 'null'], enum: [...CATEGORIES, null] },
                },
                required: ['name', 'amount', 'currency', 'billing_period', 'next_renewal', 'category'],
              },
            },
          },
          required: ['subscriptions'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'record_subscriptions' },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
              data: imageBase64,
            },
          },
          {
            type: 'text',
            text: 'Extract all subscriptions from this screenshot.',
          },
        ],
      },
    ],
  })

  const toolUse = response.content.find((b) => b.type === 'tool_use')
  const rawList =
    toolUse && toolUse.type === 'tool_use' && typeof toolUse.input === 'object' && toolUse.input !== null
      ? (toolUse.input as { subscriptions?: unknown[] }).subscriptions ?? []
      : []

  const subscriptions = (Array.isArray(rawList) ? rawList : [])
    .map(sanitizeItem)
    .filter((s): s is ImportedSubscription => s !== null)

  return NextResponse.json({ subscriptions })
}
