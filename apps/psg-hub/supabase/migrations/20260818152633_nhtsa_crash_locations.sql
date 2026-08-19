alter table public.nhtsa_crashes
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists location geography(point, 4326)
    generated always as (
      case
        when latitude is not null and longitude is not null
          then st_setsrid(st_makepoint(longitude, latitude), 4326)::geography
      end
    ) stored;

alter table public.nhtsa_crashes
  add constraint nhtsa_crashes_latitude_check
    check (latitude is null or latitude between -90 and 90),
  add constraint nhtsa_crashes_longitude_check
    check (longitude is null or longitude between -180 and 180);

create index if not exists nhtsa_crashes_location_idx
  on public.nhtsa_crashes using gist (location);
