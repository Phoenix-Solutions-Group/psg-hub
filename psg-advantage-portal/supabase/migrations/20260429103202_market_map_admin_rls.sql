DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'portal_users'
      AND policyname = 'portal_users_self_select'
  ) THEN
    CREATE POLICY portal_users_self_select
      ON portal_users
      FOR SELECT
      TO authenticated
      USING (id = auth.uid());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'body_shops'
      AND policyname = 'body_shops_psg_admin_select'
  ) THEN
    CREATE POLICY body_shops_psg_admin_select
      ON body_shops
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM portal_users
          WHERE portal_users.id = auth.uid()
            AND portal_users.role = 'psg_admin'
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'invoiced_customers'
      AND policyname = 'invoiced_customers_psg_admin_select'
  ) THEN
    CREATE POLICY invoiced_customers_psg_admin_select
      ON invoiced_customers
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM portal_users
          WHERE portal_users.id = auth.uid()
            AND portal_users.role = 'psg_admin'
        )
      );
  END IF;
END $$;
