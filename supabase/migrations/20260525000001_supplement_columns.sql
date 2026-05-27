-- Add missing columns to supplements table
alter table supplements add column if not exists notes text;
alter table supplements add column if not exists order_index integer not null default 0;
alter table supplements add column if not exists supply_days_remaining integer;
