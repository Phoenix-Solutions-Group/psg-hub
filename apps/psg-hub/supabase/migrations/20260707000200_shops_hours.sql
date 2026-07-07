-- PSG-779 (B4 — Editable Settings): add freeform business-hours text to shops.
-- The Settings form lets owners record hours (design shows e.g. "Mon–Fri 8–6").
-- Freeform text on purpose — no structured open/close model yet.
-- Additive + idempotent; RLS on public.shops is unchanged (default-deny, tenant-scoped).
alter table public.shops add column if not exists hours text;
