-- PSG-1079 — Local Falcon visibility snapshots for BSM reporting.
--
-- First-batch connection path: manual Local Falcon CSV export -> service-role import.
-- This avoids new production secrets while preserving the future API/scheduled-export
-- seam. Customer reads stay shop-scoped by RLS; customer sessions cannot write.

create table if not exists public.local_falcon_visibility_snapshots (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  captured_at timestamptz not null,
  source_file_name text not null,
  campaign_name text,
  grid_size text,
  share_of_local_voice numeric,
  average_rank numeric,
  priority_notes text[] not null default '{}',
  keyword_summaries jsonb not null default '[]'::jsonb,
  raw_rows jsonb not null default '[]'::jsonb,
  imported_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint local_falcon_visibility_snapshots_solv_pct
    check (share_of_local_voice is null or (share_of_local_voice >= 0 and share_of_local_voice <= 100)),
  constraint local_falcon_visibility_snapshots_avg_rank_positive
    check (average_rank is null or average_rank >= 0)
);

create unique index if not exists local_falcon_visibility_snapshots_idempotency_key
  on public.local_falcon_visibility_snapshots (shop_id, captured_at, source_file_name);

create index if not exists local_falcon_visibility_snapshots_shop_captured_idx
  on public.local_falcon_visibility_snapshots (shop_id, captured_at desc);

alter table public.local_falcon_visibility_snapshots enable row level security;

drop policy if exists local_falcon_visibility_snapshots_select on public.local_falcon_visibility_snapshots;
create policy local_falcon_visibility_snapshots_select
  on public.local_falcon_visibility_snapshots
  for select
  using (shop_id in (select public.user_shop_ids()));

-- No authenticated INSERT/UPDATE/DELETE policies on purpose. Imports use the
-- service role and idempotent upsert; customer sessions only read their shops.

grant all on table public.local_falcon_visibility_snapshots to anon;
grant all on table public.local_falcon_visibility_snapshots to authenticated;
grant all on table public.local_falcon_visibility_snapshots to service_role;
