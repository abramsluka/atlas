alter table health_profile
  add column if not exists age integer,
  add column if not exists sex text check (sex in ('m', 'f', 'o')),
  add column if not exists activity_hrs_per_week float not null default 0,
  add column if not exists caffeine_mg_per_day float not null default 200,
  add column if not exists water_unit text not null default 'bottle',
  add column if not exists bottle_ml float not null default 500,
  add column if not exists glass_ml float not null default 250,
  add column if not exists weight_unit text not null default 'lb',
  add column if not exists substances jsonb not null default '[]'::jsonb;
