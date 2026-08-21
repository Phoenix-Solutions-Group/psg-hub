-- Rollback: drop collision_insurer_registry_matches(text[], integer), remove the
-- three canonical_registry_* review columns, then drop collision_insurer_registry
-- and collision_insurer_match_key(text).
begin;

create or replace function public.collision_insurer_match_key(value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
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
  );
$$;

revoke all on function public.collision_insurer_match_key(text)
  from public, anon, authenticated;
grant execute on function public.collision_insurer_match_key(text)
  to service_role;

create table if not exists public.collision_insurer_registry (
  source text not null,
  record_type text not null,
  registry_id text not null,
  registry_name text not null,
  display_name text not null,
  match_key text not null,
  group_code text,
  company_code text,
  state_of_domicile text,
  company_status smallint not null,
  is_current boolean not null default true,
  source_release date not null,
  source_url text not null,
  imported_at timestamptz not null default now(),
  primary key (source, record_type, registry_id),
  check (source = btrim(source) and source <> ''),
  check (record_type in ('group', 'company')),
  check (registry_id ~ '^[0-9]+$'),
  check (registry_name = btrim(registry_name) and registry_name <> ''),
  check (display_name = btrim(display_name) and display_name <> ''),
  check (match_key = public.collision_insurer_match_key(display_name)),
  check (group_code is null or group_code ~ '^[0-9]+$'),
  check (company_code is null or company_code ~ '^[0-9]+$'),
  check (state_of_domicile is null or state_of_domicile ~ '^[A-Z]{2}$'),
  check (company_status in (0, 1, 4, 6)),
  check (source_url ~ '^https://')
);

create index if not exists collision_insurer_registry_current_type_idx
  on public.collision_insurer_registry (record_type, display_name)
  where is_current;

alter table public.collision_insurer_registry enable row level security;
revoke all on public.collision_insurer_registry from public, anon, authenticated;
grant select, insert, update on public.collision_insurer_registry to service_role;

alter table public.collision_insurer_alias_reviews
  add column if not exists canonical_registry_source text,
  add column if not exists canonical_registry_type text,
  add column if not exists canonical_registry_id text;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'collision_insurer_alias_reviews_registry_fields_check'
      and conrelid = 'public.collision_insurer_alias_reviews'::regclass
  ) then
    alter table public.collision_insurer_alias_reviews
      add constraint collision_insurer_alias_reviews_registry_fields_check
      check (
        (
          canonical_registry_source is null
          and canonical_registry_type is null
          and canonical_registry_id is null
        )
        or (
          canonical_registry_source is not null
          and canonical_registry_type is not null
          and canonical_registry_id is not null
        )
      );
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'collision_insurer_alias_reviews_registry_fkey'
      and conrelid = 'public.collision_insurer_alias_reviews'::regclass
  ) then
    alter table public.collision_insurer_alias_reviews
      add constraint collision_insurer_alias_reviews_registry_fkey
      foreign key (
        canonical_registry_source,
        canonical_registry_type,
        canonical_registry_id
      )
      references public.collision_insurer_registry (
        source,
        record_type,
        registry_id
      );
  end if;
end;
$$;

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
          )
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

comment on table public.collision_insurer_registry is
  'Service-only NAIC insurer identity reference used for human-confirmed fuzzy matching. Active registry status is not proof of a state-specific license.';
comment on function public.collision_insurer_registry_matches(text[], integer) is
  'Returns name-similarity suggestions only; operators must confirm the legal insurer or group before saving.';

commit;
