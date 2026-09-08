export const dynamic = 'force-dynamic'

import { timingSafeEqual } from 'crypto'
import JoinClient from './JoinClient'

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const expected = process.env.INVITE_TOKEN
  const valid = !!expected && safeEqual(token, expected)

  // The demo peek lives HERE, before signup, on purpose: the demo link signs the
  // visitor into the shared demo account, so offering it after signup would
  // clobber their own session. Pre-signup there is no session to lose.
  const demoToken = process.env.DEMO_LOGIN_TOKEN
  const demoHref = valid && demoToken ? `/demo/${demoToken}` : null

  return <JoinClient token={token} valid={valid} demoHref={demoHref} />
}
