-- Per-entry food emoji. Null means "auto" — the app resolves an emoji from the
-- item name via the keyword table in src/features/food/foodEmoji.ts. A non-null
-- value is the user's explicit override and always wins.
alter table food_logs  add column if not exists emoji text;
alter table food_items add column if not exists emoji text;
