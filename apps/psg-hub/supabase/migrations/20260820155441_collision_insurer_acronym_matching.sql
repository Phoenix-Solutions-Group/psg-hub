-- Rollback: restore the prior collision_insurer_match_key(text) and
-- collision_insurer_registry_matches(text[], integer) bodies from
-- 20260820132237_collision_insurer_registry.sql, then recompute match_key.
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

create or replace function public.collision_insurer_registry_matches(
  source_labels text[],
  match_limit integer default 3
)
returns table (
  source_label text,
  source text,
  record_type text,
  registry_id text,
  display_name text,
  group_code text,
  company_code text,
  state_of_domicile text,
  match_score integer,
  source_release date
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    labels.source_label,
    candidate.source,
    candidate.record_type,
    candidate.registry_id,
    candidate.display_name,
    candidate.group_code,
    candidate.company_code,
    candidate.state_of_domicile,
    pg_catalog.round(candidate.score * 100)::integer as match_score,
    candidate.source_release
  from pg_catalog.unnest(source_labels) as labels(source_label)
  cross join lateral (
    select ranked.*
    from (
      select
        registry.source,
        registry.record_type,
        registry.registry_id,
        registry.display_name,
        registry.group_code,
        registry.company_code,
        registry.state_of_domicile,
        registry.source_release,
        greatest(
          public.similarity(
            public.collision_insurer_match_key(labels.source_label),
            registry.match_key
          ),
          public.word_similarity(
            public.collision_insurer_match_key(labels.source_label),
            registry.match_key
          ),
          case
            when pg_catalog.length(
              public.collision_insurer_match_key(labels.source_label)
            ) between 2 and 8
              and public.collision_insurer_match_key(labels.source_label) =
                pg_catalog.regexp_replace(
                  pg_catalog.regexp_replace(
                    registry.match_key,
                    '\m([a-z0-9])[a-z0-9]*\M',
                    '\1',
                    'g'
                  ),
                  '[^a-z0-9]+',
                  '',
                  'g'
                )
              then 1
            else 0
          end
        ) as score
      from public.collision_insurer_registry registry
      where registry.is_current
    ) ranked
    where ranked.score >= 0.35
    order by
      ranked.score desc,
      case ranked.record_type when 'group' then 0 else 1 end,
      ranked.display_name
    limit least(greatest(match_limit, 1), 5)
  ) candidate;
$$;

revoke all on function public.collision_insurer_registry_matches(text[], integer)
  from public, anon, authenticated;
grant execute on function public.collision_insurer_registry_matches(text[], integer)
  to service_role;

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
