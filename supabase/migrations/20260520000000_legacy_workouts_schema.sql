-- Captured after the fact: the legacy workout-logger tables (workouts, exercises,
-- sets) were created out-of-band in the Supabase dashboard and never had a
-- migration. This file records their real, live schema (verified against the
-- production DB on 2026-07-23) so the repo can reconstruct them and nobody has
-- to reverse-engineer the shape from deleted TypeScript.
--
-- These tables hold pre-2026-05-27 training history and are still read by home
-- stats and the weekly report. The logger UI and /api/workouts routes were
-- deleted (commit f8ae599); new training logs to gym_logs, never here.
--
-- This is a RECORD of existing state — the live DB already has these tables, so
-- there is no need to run it there. Everything is idempotent (IF NOT EXISTS /
-- guarded policies) so a fresh `supabase db reset` rebuilds the schema cleanly.
-- Dated before 20260523000000_exercises_rls.sql so that migration, which adds
-- the per-workout exercises policies, still applies in order on a fresh reset.

-- ── workouts ────────────────────────────────────────────────────────────────
-- completed_at IS NULL meant "in progress" in the old logger. No started_at
-- column ever existed; created_at was the de facto start time.
create table if not exists workouts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text,
  completed_at timestamptz,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- ── exercises ───────────────────────────────────────────────────────────────
create table if not exists exercises (
  id          uuid primary key default gen_random_uuid(),
  workout_id  uuid not null references workouts(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  order_index integer not null default 0,
  created_at  timestamptz default now()
);

-- ── sets ─────────────────────────────────────────────────────────────────────
-- One row per set. weight in pounds (weight_lbs); reps/rpe nullable.
create table if not exists sets (
  id          uuid primary key default gen_random_uuid(),
  exercise_id uuid not null references exercises(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  reps        integer,
  weight_lbs  numeric,
  rpe         integer,
  completed   boolean default false,
  order_index integer not null default 0,
  created_at  timestamptz default now()
);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table workouts  enable row level security;
alter table exercises enable row level security;
alter table sets      enable row level security;

-- workouts + sets: single owner-scoped ALL policy (matches live state).
drop policy if exists "Users can manage their own workouts" on workouts;
create policy "Users can manage their own workouts"
  on workouts for all using (auth.uid() = user_id);

drop policy if exists "Users can manage their own sets" on sets;
create policy "Users can manage their own sets"
  on sets for all using (auth.uid() = user_id);

-- exercises: policies are owned by 20260523000000_exercises_rls.sql (which runs
-- next). Note: live has since drifted to a single owner-scoped ALL policy plus
-- exercises_insert_own; that RLS migration reflects the original intent, not the
-- current live set. Not reconciled here to avoid rewriting that migration.
