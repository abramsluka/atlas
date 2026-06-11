-- Photo meal refinement: fat tracking, refine flow, user descriptions

-- fat_g on food_logs
alter table food_logs add column if not exists fat_g numeric(6,1);

-- Refinement state machine ('open' = pending follow-up questions)
alter table food_logs add column if not exists refine_status text default 'done'
  check (refine_status in ('open', 'done'));

-- Optional user note saved after refinement
alter table food_logs add column if not exists user_description text;

-- Existing rows are already fully logged (no refine flow needed)
update food_logs set refine_status = 'done' where refine_status is null;

-- fat_g on food_items (for favorited photo meals + future manual entry)
alter table food_items add column if not exists fat_g numeric(6,1);

-- Allow 'photo' as food_items source so favorited photo meals can be saved
alter table food_items drop constraint if exists food_items_source_check;
alter table food_items add constraint food_items_source_check
  check (source in ('text','drink','barcode','photo'));
