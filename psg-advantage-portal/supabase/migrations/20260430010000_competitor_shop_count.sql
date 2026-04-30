ALTER TABLE public.customer_zip_report_monthly
  ADD COLUMN IF NOT EXISTS competitor_shop_count INT;
