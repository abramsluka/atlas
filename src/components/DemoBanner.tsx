import { cookies } from 'next/headers'
import { getPageUser } from '@/lib/supabase/server'

// Shown at the top of every page while signed in as the shared demo account.
//
// Two problems this solves. First, nothing otherwise tells a demo viewer they
// are looking at fake data in an account that isn't theirs. Second, someone who
// tapped "see a live demo" from an invite link had no route back to signing up
// — the demo was a dead end escapable only by the back button.
export default async function DemoBanner() {
  const demoEmail = process.env.DEMO_ACCOUNT_EMAIL
  if (!demoEmail) return null

  const user = await getPageUser()
  if (!user?.email || user.email.toLowerCase() !== demoEmail.toLowerCase()) return null

  const invite = (await cookies()).get('atlas-invite-return')?.value
  const backHref = invite && /^[A-Za-z0-9_-]{16,128}$/.test(invite) ? `/join/${invite}` : null

  return (
    <div
      className="flex items-center gap-3 px-4 py-2"
      style={{ background: 'rgba(74,222,128,0.10)', borderBottom: '1px solid rgba(74,222,128,0.22)' }}
    >
      <span className="text-[11.5px] font-semibold text-green-200/90">
        Demo account — sample data, shared by everyone
      </span>
      {backHref && (
        <a
          href={backHref}
          className="ml-auto flex-none rounded-lg px-2.5 py-1 text-[11.5px] font-bold text-[#05130a]"
          style={{ background: 'radial-gradient(circle at 50% 0%, #5df08e, #3ecb74)' }}
        >
          Create your account →
        </a>
      )}
    </div>
  )
}
