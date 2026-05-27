-- Numeric goals can be ascending (reps → 100) or descending (weight → 155 lbs).
-- direction defaults to 'ascending' so existing rows behave the same.
-- start_value records where the user began, used for progress math on both directions.

alter table goals add column if not exists direction text
  check (direction in ('ascending', 'descending'))
  default 'ascending';

alter table goals add column if not exists start_value float;

-- Backfill: for existing numeric goals without a start_value, assume they started at 0
-- (matches the previous progress = current/target behavior).
update goals
  set start_value = 0
  where type = 'numeric'
    and start_value is null;
