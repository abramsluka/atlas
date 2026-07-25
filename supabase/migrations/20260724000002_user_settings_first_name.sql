-- Per-user first name for the dashboard title ("<First>'s Dashboard").
-- Read server-side via the service client so it never lags a stale session.
alter table user_settings add column if not exists first_name text;
