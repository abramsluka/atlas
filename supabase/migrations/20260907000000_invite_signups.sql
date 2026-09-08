-- Invite-link signup: audit log + the global signup cap.
--
-- The cap is what actually bounds a leaked/forwarded invite link. Per-IP rate
-- limiting is per-serverless-instance on Vercel and trivially evaded, so it is
-- the soft layer; this counter is the real ceiling.
create table if not exists invite_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
-- RLS on with NO policies: service-role only, never readable from a browser.
alter table invite_signups enable row level security;

create index if not exists idx_invite_signups_created on invite_signups(created_at desc);

-- Onboarding gate (the wizard itself lands later — see ONBOARDING_SPEC.md).
-- Backfilling every EXISTING user as already-onboarded is mandatory: without it
-- Luka and everyone already using Atlas gets ambushed by the wizard on their
-- next visit. New signups leave it null on purpose so they do get onboarding.
alter table user_settings add column if not exists onboarding_completed_at timestamptz;
update user_settings set onboarding_completed_at = now() where onboarding_completed_at is null;
