-- PSG-1391 — shop-scoped Direct mail result metrics.
--
-- The dashboard must not read program-wide mined priors for a customer view,
-- because that would mix one shop's results with another's. Add nullable scope
-- columns so mined result rows can be tied to the same company/shop identifiers
-- already used by mail_send_history.

alter table public.mail_send_priors
  add column if not exists company_id uuid references public.companies(id) on delete set null,
  add column if not exists shop_name text;

create index if not exists idx_mail_send_priors_company
  on public.mail_send_priors (company_id)
  where company_id is not null;

create index if not exists idx_mail_send_priors_shop_name
  on public.mail_send_priors (shop_name)
  where shop_name is not null;
