import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { BarcodeLookup } from '@/features/food/types'

const OFF_FIELDS = 'product_name,brands,nutriments,serving_size,serving_quantity,quantity,product_quantity'

function num(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params

  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const barcode = code.replace(/\D/g, '')
  if (!barcode || barcode.length < 6) {
    return NextResponse.json({ found: false } satisfies BarcodeLookup)
  }

  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${barcode}?fields=${OFF_FIELDS}`,
      {
        headers: { 'User-Agent': 'Atlas - personal nutrition app - lukadev' },
        signal: AbortSignal.timeout(5000),
      }
    )
    if (!res.ok) return NextResponse.json({ found: false } satisfies BarcodeLookup)

    const json = await res.json()
    const product = json?.product
    const n = product?.nutriments
    const kcal100 = num(n?.['energy-kcal_100g'])

    // No name or no usable calories → treat as not found
    if (!product?.product_name || kcal100 == null) {
      return NextResponse.json({ found: false } satisfies BarcodeLookup)
    }

    const kcalServing = num(n?.['energy-kcal_serving'])
    const per_serving = kcalServing != null
      ? {
          calories: kcalServing,
          protein_g: num(n?.proteins_serving) ?? 0,
          carbs_g: num(n?.carbohydrates_serving) ?? 0,
        }
      : null

    // product_quantity is grams/ml of the whole package when parseable
    const packageGrams = num(product?.product_quantity)

    const result: BarcodeLookup = {
      found: true,
      name: String(product.product_name).slice(0, 80),
      brand: product.brands ? String(product.brands).split(',')[0].trim().slice(0, 80) : null,
      per_100g: {
        calories: kcal100,
        protein_g: num(n?.proteins_100g) ?? 0,
        carbs_g: num(n?.carbohydrates_100g) ?? 0,
      },
      per_serving,
      serving_size: product.serving_size ? String(product.serving_size).slice(0, 60) : null,
      serving_grams: num(product?.serving_quantity),
      package_grams: packageGrams,
    }
    return NextResponse.json(result)
  } catch (err) {
    console.error('[food/barcode] OFF lookup failed:', err)
    return NextResponse.json({ found: false } satisfies BarcodeLookup)
  }
}
