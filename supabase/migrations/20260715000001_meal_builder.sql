-- Meal builder: personal ingredient layer + saved meals + 'meal' food_logs source
-- Bundled ingredient library (common whole foods) ships in app code
-- (src/features/food/ingredientLibrary.ts); these tables hold the user's layer.

-- food_logs: allow 'meal' source + store the ingredient breakdown snapshot
alter table food_logs drop constraint if exists food_logs_source_check;
alter table food_logs add constraint food_logs_source_check
  check (source in ('photo','text','drink','barcode','meal'));
alter table food_logs add column if not exists ingredients jsonb;

-- Custom ingredients (per-100g macros; barcode scans and manual adds land here)
create table if not exists user_ingredients (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  name             text not null,
  brand            text,
  barcode          text,
  cal_per_100      numeric(7,1) not null,
  protein_per_100  numeric(6,1) not null default 0,
  carbs_per_100    numeric(6,1) not null default 0,
  unit_name        text,             -- optional natural unit, e.g. 'scoop'
  unit_grams       numeric(7,1),     -- gram weight of one unit
  liquid           boolean not null default false,  -- measured in ml
  hydrating        boolean not null default false,  -- counts toward water
  caffeine_per_100 numeric(6,1),     -- mg per 100 ml
  use_count        int not null default 0,
  last_used_at     timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  unique (user_id, name)
);
alter table user_ingredients enable row level security;
drop policy if exists "user_ingredients_own" on user_ingredients;
create policy "user_ingredients_own" on user_ingredients for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists user_ingredients_user_recent
  on user_ingredients (user_id, last_used_at desc);

-- Saved meals (reusable recipes; ingredient rows snapshot into jsonb so
-- deleting a library item never breaks a saved meal)
create table if not exists saved_meals (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text not null,
  emoji        text,
  ingredients  jsonb not null,
  calories     int not null,
  protein_g    numeric(7,1) not null,
  carbs_g      numeric(7,1) not null,
  total_grams  numeric(8,1) not null,
  use_count    int not null default 0,
  last_used_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  unique (user_id, name)
);
alter table saved_meals enable row level security;
drop policy if exists "saved_meals_own" on saved_meals;
create policy "saved_meals_own" on saved_meals for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists saved_meals_user_recent
  on saved_meals (user_id, last_used_at desc);
