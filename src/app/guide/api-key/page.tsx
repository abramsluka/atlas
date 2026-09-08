import type { Metadata } from 'next'

// Public page (in the proxy.ts bypass list) so it can be opened from an invite,
// from onboarding, or from a text message before the reader has an account.
//
// Written in-house on purpose: a linked third-party walkthrough goes stale,
// shows a console UI that no longer matches, and — the part that actually
// matters — never mentions setting a spend cap.
export const metadata: Metadata = {
  title: 'Getting an API key · Atlas',
  description: 'How to create an API key for Atlas and cap what it can ever cost you.',
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="relative pl-9">
      <span
        className="absolute left-0 top-0 flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold text-[#05130a]"
        style={{ background: 'radial-gradient(circle at 50% 0%, #5df08e, #3ecb74)' }}
      >
        {n}
      </span>
      <p className="text-[13.5px] font-semibold text-white">{title}</p>
      <div className="mt-1 space-y-1.5 text-[12.5px] leading-relaxed text-zinc-400">{children}</div>
    </li>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="cosmic-card p-4">{children}</div>
}

export default function ApiKeyGuidePage() {
  return (
    <main className="mx-auto max-w-lg px-5 pb-24 pt-8">
      <h1 className="text-[22px] font-bold tracking-tight text-white">Getting your API key</h1>
      <p className="mt-2 text-[13px] leading-relaxed text-zinc-400">
        Atlas runs its AI on <span className="text-white">your</span> key, billed to your own
        account. That means your data is never pooled with anyone else&apos;s, nobody else can see
        it, and you are never dependent on someone else&apos;s budget. It also means there is one
        setup step, and this page is it. Ten minutes, once.
      </p>

      {/* ── Pick a provider ─────────────────────────────────────────────── */}
      <h2 className="mt-8 mb-2 font-mono text-[9.5px] font-extrabold uppercase tracking-[0.16em] text-zinc-500">
        First, pick one
      </h2>
      <div className="space-y-3">
        <Card>
          <p className="text-[13px] font-semibold text-white">
            Google Gemini <span className="text-green-400">— free, start here</span>
          </p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-zinc-400">
            Google gives away a genuinely usable free tier with no credit card. If you have never
            bought API credits before, use this. Everything in Atlas works on it, and you can
            switch to Claude later from Settings without redoing anything.
          </p>
        </Card>
        <Card>
          <p className="text-[13px] font-semibold text-white">Anthropic (Claude) — paid, best quality</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-zinc-400">
            Claude is what Atlas was built and tuned against, and it is the better coach. It is
            pay-as-you-go: typical daily use runs a few dollars a month. $5 of credit lasts most
            people a long time.
          </p>
        </Card>
        <Card>
          <p className="text-[13px] font-semibold text-white">OpenAI — optional add-on</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-zinc-400">
            Only needed for two things: parsing a photo of your food, and transcribing voice notes.
            Skip it unless you want those. It does not replace the one above.
          </p>
        </Card>
      </div>

      {/* ── Gemini ──────────────────────────────────────────────────────── */}
      <h2 className="mt-8 mb-3 font-mono text-[9.5px] font-extrabold uppercase tracking-[0.16em] text-zinc-500">
        Google Gemini (free)
      </h2>
      <ol className="space-y-4">
        <Step n={1} title="Open Google AI Studio">
          <p>
            Go to{' '}
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noreferrer"
              className="text-green-400 underline"
            >
              aistudio.google.com/app/apikey
            </a>{' '}
            and sign in with any Google account.
          </p>
        </Step>
        <Step n={2} title="Create API key">
          <p>
            Click <span className="text-zinc-200">Create API key</span>. Accept the terms if asked.
            You do not need to create a billing account or enter a card to use the free tier.
          </p>
        </Step>
        <Step n={3} title="Copy it and paste it into Atlas">
          <p>
            The key starts with <span className="font-mono text-zinc-300">AIza</span>. Copy it now —
            paste it into Atlas during setup, or later under Settings → API keys.
          </p>
        </Step>
      </ol>
      <p className="mt-3 text-[11.5px] leading-relaxed text-zinc-600">
        The free tier has a daily request limit rather than a bill. If you hit it, Atlas tells you
        the limit was reached and everything keeps working again the next day.
      </p>

      {/* ── Anthropic ───────────────────────────────────────────────────── */}
      <h2 className="mt-8 mb-3 font-mono text-[9.5px] font-extrabold uppercase tracking-[0.16em] text-zinc-500">
        Anthropic / Claude (paid)
      </h2>
      <ol className="space-y-4">
        <Step n={1} title="Create an account">
          <p>
            Sign up at{' '}
            <a
              href="https://console.anthropic.com"
              target="_blank"
              rel="noreferrer"
              className="text-green-400 underline"
            >
              console.anthropic.com
            </a>
            . This is the developer console, which is separate from a Claude.ai chat subscription —
            paying for Claude Pro does <span className="text-zinc-200">not</span> give you API
            credit.
          </p>
        </Step>
        <Step n={2} title="Add credits">
          <p>
            <span className="text-zinc-200">Billing → Add credits.</span> $5 is plenty to start.
            Credits are spent as you use them and do not auto-renew unless you switch auto-reload
            on, so leave that off.
          </p>
        </Step>
        <Step n={3} title="Create a Workspace">
          <p>
            <span className="text-zinc-200">Settings → Workspaces → Create Workspace.</span> Name it
            &ldquo;Atlas&rdquo;. A workspace is just a box you can put a spending limit around.
          </p>
        </Step>
        <Step n={4} title="Set a monthly spend limit on it — do not skip this">
          <p>
            Open the workspace, find <span className="text-zinc-200">Spend limit</span>, and set a
            monthly cap. $10 is a sensible number for one person using Atlas daily.
          </p>
          <p className="text-zinc-500">
            This is the step that makes everything else safe. Once a cap is set, a bug, a runaway
            loop, or a leaked key cannot cost you more than that number, ever. Set it before you
            create the key, not after.
          </p>
        </Step>
        <Step n={5} title="Create the key inside that workspace">
          <p>
            <span className="text-zinc-200">API keys → Create key</span>, and make sure the
            workspace selected is the one you just capped, not the default. A key created outside
            the workspace is not covered by the limit.
          </p>
        </Step>
        <Step n={6} title="Copy it and paste it into Atlas">
          <p>
            The key starts with <span className="font-mono text-zinc-300">sk-ant-</span>. Anthropic
            shows it exactly once, so copy it before closing the dialog. If you lose it, delete that
            key and make another — no harm done.
          </p>
        </Step>
      </ol>

      {/* ── OpenAI ──────────────────────────────────────────────────────── */}
      <h2 className="mt-8 mb-3 font-mono text-[9.5px] font-extrabold uppercase tracking-[0.16em] text-zinc-500">
        OpenAI (optional — food photos and voice)
      </h2>
      <ol className="space-y-4">
        <Step n={1} title="Create a project">
          <p>
            At{' '}
            <a
              href="https://platform.openai.com/api-keys"
              target="_blank"
              rel="noreferrer"
              className="text-green-400 underline"
            >
              platform.openai.com
            </a>
            , sign in and create a project called &ldquo;Atlas&rdquo;. Add a small amount of credit
            under Billing.
          </p>
        </Step>
        <Step n={2} title="Set a project spend limit">
          <p>
            <span className="text-zinc-200">Settings → Limits</span> for that project. Same reasoning
            as above: cap it first, at $5 or $10, so it can never surprise you.
          </p>
        </Step>
        <Step n={3} title="Create the key in that project">
          <p>
            <span className="text-zinc-200">API keys → Create new secret key</span>, scoped to the
            Atlas project. It starts with <span className="font-mono text-zinc-300">sk-</span>.
          </p>
        </Step>
      </ol>

      {/* ── Safety ──────────────────────────────────────────────────────── */}
      <h2 className="mt-8 mb-2 font-mono text-[9.5px] font-extrabold uppercase tracking-[0.16em] text-zinc-500">
        What Atlas does with the key
      </h2>
      <div className="cosmic-card space-y-2 p-4 text-[12.5px] leading-relaxed text-zinc-400">
        <p>
          It is encrypted before it is stored, and it is never sent to your browser again. Once
          saved, the only thing Atlas will ever show you is the last four characters, so you can
          tell which key is in there without exposing it.
        </p>
        <p>
          It is used solely to make AI calls for your own account. It is never shared with other
          Atlas users, and no other user&apos;s data is ever sent through it.
        </p>
        <p>
          You can replace or delete it at any time from{' '}
          <span className="text-zinc-200">Settings → API keys</span>. Deleting it in Atlas does not
          revoke it at the provider — do that in the provider&apos;s console if you need to kill a
          key for good.
        </p>
      </div>

      <p className="mt-6 text-[11.5px] leading-relaxed text-zinc-600">
        Stuck on any step? Anthropic&apos;s official docs are at{' '}
        <a
          href="https://docs.anthropic.com/en/api/getting-started"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          docs.anthropic.com
        </a>
        , but the steps above are the ones that matter for Atlas.
      </p>
    </main>
  )
}
