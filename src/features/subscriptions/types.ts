export interface Subscription {
  id: string
  user_id: string
  name: string
  amount: number
  currency: string
  billing_period: 'weekly' | 'monthly' | 'yearly'
  next_renewal: string | null   // ISO date YYYY-MM-DD
  auto_renews: boolean
  category: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface CreateSubscriptionPayload {
  name: string
  amount: number
  currency: string
  billing_period: 'weekly' | 'monthly' | 'yearly'
  next_renewal: string | null
  auto_renews: boolean
  category?: string | null
  notes?: string | null
}

export interface UpdateSubscriptionPayload {
  name?: string
  amount?: number
  currency?: string
  billing_period?: 'weekly' | 'monthly' | 'yearly'
  next_renewal?: string | null
  auto_renews?: boolean
  category?: string | null
  notes?: string | null
}

// Derived — computed on the client for display
export interface SubscriptionWithMeta extends Subscription {
  monthlyEquivalent: number   // amount normalized to per-month cost
  daysUntilRenewal: number | null
  isUrgent: boolean           // daysUntilRenewal !== null && daysUntilRenewal <= 5
}

export const BILLING_PERIODS = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly',  label: 'Yearly'  },
  { value: 'weekly',  label: 'Weekly'  },
] as const

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'CHF', 'CAD', 'AUD'] as const

export const CATEGORIES = [
  'Entertainment',
  'Productivity',
  'Health & Fitness',
  'Music',
  'News & Media',
  'Software / Dev',
  'Cloud Storage',
  'AI Tools',
  'Gaming',
  'Other',
] as const
