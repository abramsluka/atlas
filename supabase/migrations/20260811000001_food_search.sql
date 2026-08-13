-- Food search: full-text search across every food log, including what the
-- vision model actually SAW in the photo (search_text), not just the title.
-- "chicken apple sausage" finds a log named "Breakfast plate".

-- Searchable contents written at log time: photo logs get the vision model's
-- visible-component list, manual logs get portion_desc + brand.
alter table food_logs add column if not exists search_text text;

-- Weighted search vector. A = the name, B = what's in it, C = the surrounding
-- prose. Generated + stored, so it can never drift from the row.
alter table food_logs drop column if exists search_tsv;
alter table food_logs add column search_tsv tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(item_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(search_text, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(user_description, '') || ' ' || coalesce(notes, '')), 'C') ||
    setweight(
      to_tsvector(
        'english',
        coalesce(
          replace(replace(jsonb_path_query_array(ingredients, '$[*].name')::text, '"', ' '), ',', ' '),
          ''
        )
      ),
      'C'
    )
  ) stored;

create index if not exists food_logs_search_tsv on food_logs using gin (search_tsv);

-- One round trip: ranked FTS with prefix matching ("chick" → chicken), falling
-- back to a substring scan when the tsquery finds nothing.
create or replace function search_food_logs(p_user_id uuid, p_query text, p_limit int default 50)
returns setof food_logs
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  cleaned text;
  tsq     tsquery;
  pattern text;
  hits    int;
begin
  cleaned := btrim(regexp_replace(coalesce(p_query, ''), '[^a-zA-Z0-9 ]+', ' ', 'g'));
  cleaned := regexp_replace(cleaned, '\s+', ' ', 'g');
  if cleaned = '' then return; end if;

  -- to_tsquery stems each word before applying :*, so "sausages" still hits "sausag"
  select to_tsquery('english', string_agg(w || ':*', ' & '))
    into tsq
    from unnest(string_to_array(cleaned, ' ')) as w;

  return query
    select f.*
    from food_logs f
    where f.user_id = p_user_id
      and f.search_tsv @@ tsq
    order by ts_rank(f.search_tsv, tsq) desc, f.taken_at desc
    limit p_limit;

  get diagnostics hits = row_count;
  if hits > 0 then return; end if;

  -- Substring fallback: catches "sausage" inside "applesausage" and partial words
  -- the stemmer refuses to match.
  pattern := '%' || cleaned || '%';
  return query
    select f.*
    from food_logs f
    where f.user_id = p_user_id
      and (
        f.item_name ilike pattern
        or coalesce(f.search_text, '') ilike pattern
        or coalesce(f.notes, '') ilike pattern
        or coalesce(f.user_description, '') ilike pattern
      )
    order by f.taken_at desc
    limit p_limit;
end;
$$;

-- Server-side only: API routes call this through the service client. (Supabase
-- default privileges hand anon/authenticated execute at create time; RLS would
-- already return zero rows for them, but they have no business calling it.)
revoke all on function search_food_logs(uuid, text, int) from public;
revoke all on function search_food_logs(uuid, text, int) from anon;
revoke all on function search_food_logs(uuid, text, int) from authenticated;
grant execute on function search_food_logs(uuid, text, int) to service_role;
