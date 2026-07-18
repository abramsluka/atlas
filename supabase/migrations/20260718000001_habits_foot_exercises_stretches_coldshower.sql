-- Habit edits (per-user, idempotent — safe to re-run):
--   1. Rename "Foot stretches" -> "Foot exercises"
--   2. Insert a new manual "Stretches" habit right after Foot exercises
--   3. Insert a new manual "Cold shower" habit right after Cardio
--   4. Re-normalize order_index so the list reads:
--        Make bed, Pushups, Morning sunlight, Electrolytes, Foot exercises,
--        Stretches, Cardio, Cold shower, Morning Brush, Read, Water,
--        Speaking Exercises, Retainer, Hang, Mouth Tape

-- 1. Rename
update habits
set name = 'Foot exercises'
where lower(name) = 'foot stretches';

-- 2. New "Stretches" habit (only if this user doesn't already have one)
insert into habits (user_id, name, emoji, kind, cadence, order_index, active)
select h.user_id, 'Stretches', '🧘‍♂️', 'manual', '{"per_week": 7}'::jsonb, 0, true
from habits h
where lower(h.name) = 'foot exercises'
  and not exists (
    select 1 from habits x
    where x.user_id = h.user_id and lower(x.name) = 'stretches'
  );

-- 3. New "Cold shower" habit (only if this user doesn't already have one)
insert into habits (user_id, name, emoji, kind, cadence, order_index, active)
select h.user_id, 'Cold shower', '🚿', 'manual', '{"per_week": 7}'::jsonb, 0, true
from habits h
where lower(h.name) = 'cardio'
  and not exists (
    select 1 from habits x
    where x.user_id = h.user_id and lower(x.name) = 'cold shower'
  );

-- 4. Deterministic re-ordering for every user's habit set
update habits
set order_index = case lower(name)
  when 'make bed'           then 1
  when 'pushups'            then 2
  when 'morning sunlight'   then 3
  when 'electrolytes'       then 4
  when 'foot exercises'     then 5
  when 'stretches'          then 6
  when 'cardio'             then 7
  when 'cold shower'        then 8
  when 'morning brush'      then 9
  when 'read'               then 10
  when 'water'              then 11
  when 'speaking exercises' then 12
  when 'retainer'           then 13
  when 'hang'               then 14
  when 'mouth tape'         then 15
  else order_index
end;
