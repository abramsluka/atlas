-- ============================================================
-- USER PROFILE MEMORY
-- Fact-based profile built from journal entries + mentor turns.
-- Replaces the mentor_context.about_me full-document rewrite.
-- ============================================================

create table if not exists user_profile_facts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null,
  tier text not null default 'durable',
  content text not null,
  source_kind text not null,
  source_id uuid,
  status text not null default 'active',
  first_seen_at timestamptz not null default now(),
  last_confirmed_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  constraint user_profile_facts_category_check check (category in (
    'identity','goals','training','nutrition','health',
    'relationships','work','values','preferences','struggles'
  )),
  constraint user_profile_facts_tier_check check (tier in ('durable','state')),
  constraint user_profile_facts_status_check check (status in ('active','archived','pinned')),
  constraint user_profile_facts_source_kind_check check (source_kind in ('journal','mentor','checkin','seed','manual'))
);

create index if not exists user_profile_facts_user_active
  on user_profile_facts (user_id, status, category);
create index if not exists user_profile_facts_user_source
  on user_profile_facts (user_id, source_kind, source_id);

alter table user_profile_facts enable row level security;

drop policy if exists "Users access own profile facts" on user_profile_facts;
create policy "Users access own profile facts" on user_profile_facts
  for all using (auth.uid() = user_id);

-- Idempotent re-ingestion: an entry is ingested when profile_ingested_at is
-- null or updated_at has moved past it (which also covers edits).
alter table journal_entries add column if not exists profile_ingested_at timestamptz;

-- Drives the lazy consolidation trigger in getProfileBlock().
alter table mentor_context add column if not exists last_consolidated_at timestamptz;

-- NOTE: mentor_context.about_me and the mentor_memories table are NOT dropped
-- here. about_me is the seed source for the initial fact set; both go away in
-- a follow-up migration once seeding has been reviewed.
