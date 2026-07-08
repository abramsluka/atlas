-- Morning planner: journal entries get a kind (morning = plan, night = reflection)
-- and a plan checklist (jsonb array of { id, text, done }).
alter table journal_entries
  add column if not exists kind text not null default 'night'
    check (kind in ('morning', 'night')),
  add column if not exists plan jsonb not null default '[]'::jsonb;

-- Home reads "today's morning entry" on every load; index the lookup.
create index if not exists journal_entries_user_date_kind
  on journal_entries (user_id, date desc, kind);
