-- Exercises can live at any subset of the user's gyms, not just "one or both".
-- Mirrors day_ids. Empty array = available at every gym (so anything created
-- without a gym pick, including AI-proposed exercises, shows up everywhere and
-- follows new gyms added later). gym_id stays as a legacy column for old rows
-- and the demo seed; readers use gym_ids only.
alter table gym_exercises
  add column if not exists gym_ids text[] not null default '{}';

-- 'both' → everywhere ('{}'); a specific gym → that one gym.
update gym_exercises
set gym_ids = array[gym_id]
where gym_ids = '{}' and gym_id <> 'both' and gym_id <> '';
