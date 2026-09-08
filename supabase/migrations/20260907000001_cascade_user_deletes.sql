-- Deleting a user was impossible: 15 tables referenced auth.users with NO
-- ACTION, so Supabase's admin deleteUser() failed with "Database error deleting
-- user" for anyone who had ever used the app (user_settings alone guaranteed
-- it). Most tables already cascaded; these were the stragglers.
--
-- Correct semantics: removing an account removes that account's data. Rewrites
-- every single-column public FK to auth.users as ON DELETE CASCADE.
do $$
declare r record;
begin
  for r in
    select c.conname, c.conrelid::regclass::text as tbl, a.attname as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.contype = 'f'
      and c.confrelid = 'auth.users'::regclass
      and c.connamespace = 'public'::regnamespace
      and c.confdeltype in ('a', 'r')          -- NO ACTION / RESTRICT
      and array_length(c.conkey, 1) = 1        -- single-column FKs only
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    execute format(
      'alter table %s add constraint %I foreign key (%I) references auth.users(id) on delete cascade',
      r.tbl, r.conname, r.col
    );
    raise notice 'now cascades: %.%', r.tbl, r.col;
  end loop;
end $$;
