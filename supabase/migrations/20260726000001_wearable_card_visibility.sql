-- Per-user visibility toggles for the wearable cards on the Health page.
-- Both default TRUE so existing users see no change; a user can hide a card
-- (e.g. an Apple Watch card left over from testing) in Health → Settings.
alter table health_profile
  add column if not exists show_oura boolean not null default true,
  add column if not exists show_apple_watch boolean not null default true;
