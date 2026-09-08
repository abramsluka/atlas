import type { Metadata } from 'next'

// Public page (in the proxy.ts bypass list). Required by Google's OAuth consent
// screen and by their User Data Policy for the restricted Google Health scopes,
// but it exists mainly because an app that reads someone's sleep and heart rate
// owes them a plain statement of what happens to it.
export const metadata: Metadata = {
  title: 'Privacy · Atlas',
  description: 'What Atlas collects, where it is stored, and how to delete it.',
}

const UPDATED = 'September 8, 2026'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-7">
      <h2 className="text-[15px] font-bold text-white">{title}</h2>
      <div className="mt-2 space-y-2.5 text-[13px] leading-relaxed text-zinc-400">{children}</div>
    </section>
  )
}

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-lg px-5 pb-24 pt-8">
      <h1 className="text-[22px] font-bold tracking-tight text-white">Privacy</h1>
      <p className="mt-1 text-[11.5px] text-zinc-600">Last updated {UPDATED}</p>

      <p className="mt-4 text-[13px] leading-relaxed text-zinc-400">
        Atlas is a personal health and training dashboard, run by one person and shared with a
        handful of family and friends by invitation. It is not a company and not a product for
        sale. This page says exactly what it collects, where that data lives, and how to get rid
        of it.
      </p>

      <Section title="What Atlas stores">
        <p>Only what you put in it, or what you explicitly connect:</p>
        <ul className="ml-4 list-disc space-y-1.5">
          <li>Your email address and first name, for signing in and labelling your dashboard.</li>
          <li>
            What you log yourself: workouts, food, water, body weight, supplements, caffeine,
            habits, journal entries and check-ins.
          </li>
          <li>
            If you connect a wearable (Oura, WHOOP, or Fitbit through the Google Health API):
            sleep sessions and stages, resting heart rate, heart rate variability, skin
            temperature, steps and calories. Nothing else from those accounts.
          </li>
          <li>
            An encrypted copy of the AI provider key you add, and the access tokens for any
            wearable you connect.
          </li>
        </ul>
        <p>
          Atlas does not collect location, contacts, advertising identifiers, or anything from
          your device beyond the timezone your browser reports.
        </p>
      </Section>

      <Section title="How it is used">
        <p>
          To show you your own data, and to let the AI coach comment on it when you ask. That is
          the whole list. It is never used to train any model, is never sold, and is never shared
          with advertisers or data brokers, because none are involved.
        </p>
        <p>
          Every user&apos;s data is scoped to their own account. No user of Atlas can see another
          user&apos;s data.
        </p>
      </Section>

      <Section title="The AI features run on your own key">
        <p>
          Atlas has no shared AI account. You supply your own API key from Anthropic, OpenAI or
          Google, and it is billed to you. When you use a coaching feature, the relevant slice of
          your data is sent to that provider under your key, and their privacy terms apply to that
          request. If you never add a key, no data ever leaves Atlas for an AI provider.
        </p>
        <p>
          Your key is encrypted (AES-256-GCM) before storage and is never sent to the browser
          again. The only part of it Atlas will ever show you is the last four characters.
        </p>
      </Section>

      <Section title="Where it lives">
        <p>
          In a private Postgres database hosted by Supabase, and served by an application hosted
          on Vercel, both in the United States. Access is restricted to the person who runs Atlas.
          Traffic is encrypted in transit.
        </p>
        <p>
          Honest limitation: this is a small personal project, not an audited platform. It is
          built carefully, with per-user access enforced on every request, but you should weigh
          that when deciding what to connect.
        </p>
      </Section>

      <Section title="Google Health / Fitbit data specifically">
        <p>
          Connecting Fitbit uses the Google Health API and requests read-only access to sleep,
          health metrics and measurements, and activity and fitness. Atlas reads those daily
          summaries to fill in your Health page and to give the coach context. It never writes
          anything back to your Google or Fitbit account.
        </p>
        <p>
          Atlas&apos;s use of information received from Google APIs adheres to the{' '}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            target="_blank"
            rel="noreferrer"
            className="text-green-400 underline"
          >
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements. That data is not transferred to anyone else,
          is not used for advertising, and is not read by any human other than you.
        </p>
        <p>
          You can revoke that access at any time at{' '}
          <a
            href="https://myaccount.google.com/permissions"
            target="_blank"
            rel="noreferrer"
            className="text-green-400 underline"
          >
            myaccount.google.com/permissions
          </a>
          , which immediately stops any further syncing.
        </p>
      </Section>

      <Section title="Deleting your data">
        <p>
          Disconnecting a wearable in Atlas (Health → Settings → Wearables) deletes its access
          tokens straight away. Deleting your API key in Settings removes it immediately.
        </p>
        <p>
          To delete everything, ask the person who invited you. Removing your account deletes
          every row associated with it, in every table, permanently. There is no separate backup
          copy kept.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Atlas is run by Luka Abrams. For anything on this page, including a deletion request,
          email{' '}
          <a href="mailto:abramsluka@gmail.com" className="text-green-400 underline">
            abramsluka@gmail.com
          </a>
          .
        </p>
      </Section>
    </main>
  )
}
