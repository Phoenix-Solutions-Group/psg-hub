-- Rollback: restore the prior collision_insurer_match_key(text) body from
-- 20260820132237_collision_insurer_registry.sql and recompute match_key.
begin;

create or replace function public.collision_insurer_match_key(value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  with normalized as (
    select btrim(
      pg_catalog.regexp_replace(
        pg_catalog.regexp_replace(
          pg_catalog.regexp_replace(
            pg_catalog.lower(coalesce(value, '')),
            '&',
            ' and ',
            'g'
          ),
          '\m(insurance|insurer|ins|company|co|corporation|corp|group|grp|incorporated|inc|llc|ltd)\M',
          ' ',
          'g'
        ),
        '[^a-z0-9]+',
        ' ',
        'g'
      )
    ) as match_key
  )
  select case
    when normalized.match_key ~ '^[a-z0-9]( [a-z0-9])+$'
      then pg_catalog.replace(normalized.match_key, ' ', '')
    else normalized.match_key
  end
  from normalized;
$$;

revoke all on function public.collision_insurer_match_key(text)
  from public, anon, authenticated;
grant execute on function public.collision_insurer_match_key(text)
  to service_role;

update public.collision_insurer_registry
set match_key = public.collision_insurer_match_key(display_name)
where match_key is distinct from public.collision_insurer_match_key(display_name);

commit;
