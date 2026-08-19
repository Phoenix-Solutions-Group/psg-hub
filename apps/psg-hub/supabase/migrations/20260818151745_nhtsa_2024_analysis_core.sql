create table if not exists public.nhtsa_dataset_sources (
  dataset_key text not null,
  source_year integer not null,
  source_url text not null,
  system_type text not null,
  analysis_scope text not null,
  sample_design text not null,
  archive_sha256 text not null,
  crash_rows integer not null default 0,
  vehicle_rows integer not null default 0,
  person_rows integer not null default 0,
  imported_at timestamptz not null default now(),
  notes text,
  primary key (dataset_key, source_year)
);

create table if not exists public.nhtsa_crashes (
  dataset_key text not null,
  source_year integer not null,
  case_id text not null,
  sample_weight numeric,
  state text,
  region text,
  urbanicity text,
  month smallint,
  day_of_week text,
  hour smallint,
  vehicle_count integer,
  person_count integer,
  injury_count integer,
  fatalities integer,
  max_severity text,
  collision_type text,
  harmful_event text,
  weather text,
  light_condition text,
  roadway_context text,
  alcohol_involved text,
  details jsonb not null default '{}'::jsonb,
  primary key (dataset_key, source_year, case_id),
  foreign key (dataset_key, source_year)
    references public.nhtsa_dataset_sources (dataset_key, source_year)
    on delete cascade,
  check (month is null or month between 1 and 12),
  check (hour is null or hour between 0 and 23)
);

create table if not exists public.nhtsa_vehicles (
  dataset_key text not null,
  source_year integer not null,
  case_id text not null,
  vehicle_no integer not null,
  sample_weight numeric,
  make text,
  model text,
  model_year integer,
  body_class text,
  occupants integer,
  towed text,
  damage_extent text,
  initial_impact text,
  rollover text,
  fire text,
  speed_related text,
  surface_condition text,
  delta_v numeric,
  injury_severity text,
  injured_occupants integer,
  details jsonb not null default '{}'::jsonb,
  primary key (dataset_key, source_year, case_id, vehicle_no),
  foreign key (dataset_key, source_year, case_id)
    references public.nhtsa_crashes (dataset_key, source_year, case_id)
    on delete cascade
);

create table if not exists public.nhtsa_persons (
  dataset_key text not null,
  source_year integer not null,
  case_id text not null,
  vehicle_no integer not null,
  person_no integer not null,
  sample_weight numeric,
  person_type text,
  injury_severity text,
  restraint_use text,
  air_bag text,
  ejection text,
  hospitalized text,
  fatality boolean,
  details jsonb not null default '{}'::jsonb,
  primary key (dataset_key, source_year, case_id, vehicle_no, person_no),
  foreign key (dataset_key, source_year, case_id)
    references public.nhtsa_crashes (dataset_key, source_year, case_id)
    on delete cascade
);

create index if not exists nhtsa_crashes_dataset_state_idx
  on public.nhtsa_crashes (dataset_key, source_year, state);
create index if not exists nhtsa_crashes_collision_idx
  on public.nhtsa_crashes (dataset_key, source_year, collision_type);
create index if not exists nhtsa_vehicles_make_year_idx
  on public.nhtsa_vehicles (dataset_key, source_year, make, model_year);
create index if not exists nhtsa_persons_injury_idx
  on public.nhtsa_persons (dataset_key, source_year, injury_severity);

alter table public.nhtsa_dataset_sources enable row level security;
alter table public.nhtsa_crashes enable row level security;
alter table public.nhtsa_vehicles enable row level security;
alter table public.nhtsa_persons enable row level security;

comment on table public.nhtsa_dataset_sources is
  'Provenance and sampling metadata for official NHTSA crash-system imports.';
comment on table public.nhtsa_crashes is
  'Analysis-ready crash rows; CRSS and CISS counts require sample_weight.';
comment on table public.nhtsa_vehicles is
  'Analysis-ready vehicle rows linked to NHTSA crash records.';
comment on table public.nhtsa_persons is
  'Analysis-ready, de-identified person-safety rows linked to NHTSA crash records.';
