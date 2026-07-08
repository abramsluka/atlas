-- Orb command learning (ORB_SUGGESTIONS_SPEC.md §5)
-- orb_commands: one row per message sent through the Orb — the raw material the
-- learned open-chips are distilled from. orb_chip_cache: the distilled chips,
-- one row per user, recomputed lazily by /api/assistant/chips.

create table orb_commands (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  text text not null,
  action_kinds text[] not null default '{}',
  source text not null default 'text' check (source in ('voice','text','chip')),
  hour smallint,
  created_at timestamptz not null default now()
);
create index orb_commands_user_recent on orb_commands (user_id, created_at desc);
alter table orb_commands enable row level security;

create table orb_chip_cache (
  user_id uuid primary key references auth.users(id) on delete cascade,
  chips jsonb not null,
  computed_at timestamptz not null default now()
);
alter table orb_chip_cache enable row level security;

-- No RLS policies: both tables are accessed only via the service-role client
-- from API routes (same posture as the mcp_* tables).
