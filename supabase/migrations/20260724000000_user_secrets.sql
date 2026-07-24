-- Multi-user prep: per-user encrypted secrets (BYO Anthropic/OpenAI keys).
--
-- Also captures user_settings + allowed_emails idempotently — both were
-- created out-of-band in the Supabase dashboard and were never in migrations.

create table if not exists user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  timezone text,
  updated_at timestamptz default now(),
  sync_token text unique,
  sync_token_created_at timestamptz
);
alter table user_settings enable row level security;

create table if not exists allowed_emails (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  created_at timestamptz default now()
);
alter table allowed_emails enable row level security;

-- Per-user API keys, AES-256-GCM encrypted server-side (SECRETS_ENCRYPTION_KEY).
-- RLS is enabled with NO policies on purpose: no browser/anon/authed client can
-- ever select this table — only the service-role client in API routes.
create table if not exists user_secrets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  anthropic_api_key_enc text,
  openai_api_key_enc text,
  updated_at timestamptz not null default now()
);
alter table user_secrets enable row level security;
