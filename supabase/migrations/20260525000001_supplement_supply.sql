alter table supplements
  add column supply_days_remaining integer,
  add column notes text,
  add column order_index integer not null default 0;
