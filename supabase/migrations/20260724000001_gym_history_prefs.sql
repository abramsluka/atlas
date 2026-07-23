-- Exercise History add-on (specs/gym/EXERCISE_HISTORY_SPEC.md)
-- 1. Per-user toggles for the New Best celebration + next-target card.
alter table gym_config add column if not exists celebrate_pr boolean not null default true;
alter table gym_config add column if not exists show_next_target boolean not null default true;

-- 2. Today-only swap metadata: the movement actually performed for a set.
--    NULL = the slot's own exercise. Swapped sets are excluded from the
--    original exercise's progression math (chart/best/deltas) client-side.
alter table gym_logs add column if not exists performed_exercise text;
alter table gym_logs add column if not exists performed_library_id text;
