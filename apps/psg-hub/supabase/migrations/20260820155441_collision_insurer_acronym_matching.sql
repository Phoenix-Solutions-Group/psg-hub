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

create index if not exists collision_insurer_alias_reviews_registry_idx
  on public.collision_insurer_alias_reviews (
    canonical_registry_source,
    canonical_registry_type,
    canonical_registry_id
  );

update public.collision_insurer_registry
set match_key = public.collision_insurer_match_key(display_name)
where match_key is distinct from public.collision_insurer_match_key(display_name);

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_index index
    where index.indexrelid =
      to_regclass('public.collision_insurer_alias_reviews_registry_idx')
      and index.indrelid = 'public.collision_insurer_alias_reviews'::regclass
      and index.indisvalid
      and index.indisready
      and index.indnkeyatts = 3
      and index.indpred is null
      and pg_catalog.pg_get_indexdef(index.indexrelid, 1, true) =
        'canonical_registry_source'
      and pg_catalog.pg_get_indexdef(index.indexrelid, 2, true) =
        'canonical_registry_type'
      and pg_catalog.pg_get_indexdef(index.indexrelid, 3, true) =
        'canonical_registry_id'
  ) then
    raise exception 'insurer registry foreign key requires a valid covering index';
  end if;
end
$$;

commit;
