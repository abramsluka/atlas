-- Food logging v2: typed entries, drinks, barcode scans, frequent-foods library

-- Typed/barcode entries have no photo
alter table food_logs alter column storage_path drop not null;

-- Provenance + barcode + drink volume
alter table food_logs add column if not exists source text not null default 'photo'
  check (source in ('photo','text','drink','barcode'));
alter table food_logs add column if not exists barcode text;
alter table food_logs add column if not exists volume_oz numeric(6,1); -- drinks only

-- Personal frequent-foods library
create table if not exists food_items (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text not null,
  brand        text,
  barcode      text,
  source       text not null check (source in ('text','drink','barcode')),
  calories     int not null,            -- per logged portion
  protein_g    numeric(6,1) not null,
  carbs_g      numeric(6,1) not null,
  portion_desc text not null,           -- e.g. "1 glass (12 oz)", "1 serving (55g)"
  volume_oz    numeric(6,1),            -- hydrating drinks
  is_hydrating boolean not null default false,
  use_count    int not null default 1,
  last_used_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  unique (user_id, name, portion_desc)
);
alter table food_items enable row level security;
create policy "food_items_own" on food_items for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists food_items_user_recent on food_items (user_id, last_used_at desc);
