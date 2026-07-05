import { NextRequest } from 'next/server'
import { handleTranscribeRequest } from '@/lib/transcribe'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  return handleTranscribeRequest(req)
}
