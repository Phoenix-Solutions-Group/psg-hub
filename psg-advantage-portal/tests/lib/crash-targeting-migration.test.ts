import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('crash targeting migration', () => {
  it('adds official crash demand tables and targeting examples without accident reloads', () => {
    const migration = readFileSync(
      join(
        process.cwd(),
        'supabase',
        'migrations',
        '20260429120000_crash_event_targeting_chicago.sql'
      ),
      'utf-8'
    )

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS crash_event_sources')
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS crash_events')
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS crash_zip_annual')
    expect(migration).toContain('CREATE OR REPLACE VIEW v_collision_targeting_zip_annual')
    expect(migration).toContain('CREATE OR REPLACE FUNCTION collision_targeting_examples')
    expect(migration).toContain('market_map_points(NULL, 40000)')
    expect(migration).toContain('storm_zip_monthly')
    expect(migration).not.toContain('TRUNCATE accidents')
    expect(migration).not.toContain('DROP TABLE accidents')
  })

  it('adds viewport intelligence for map-driven demand context', () => {
    const migration = readFileSync(
      join(
        process.cwd(),
        'supabase',
        'migrations',
        '20260429133000_market_viewport_intelligence.sql'
      ),
      'utf-8'
    )

    expect(migration).toContain('CREATE OR REPLACE FUNCTION market_viewport_intelligence')
    expect(migration).toContain('ST_MakeEnvelope')
    expect(migration).toContain('crash_zip_annual')
    expect(migration).toContain('storm_zip_monthly')
    expect(migration).toContain('market_map_points(NULL, 40000)')
    expect(migration).not.toContain('TRUNCATE accidents')
    expect(migration).not.toContain('DROP TABLE accidents')
  })

  it('matches PSG branch names to Google Business Profile branch names', () => {
    const migration = readFileSync(
      join(
        process.cwd(),
        'supabase',
        'migrations',
        '20260429170000_google_profile_shop_matching.sql'
      ),
      'utf-8'
    )

    expect(migration).toContain('CREATE OR REPLACE FUNCTION google_profile_shop_name_key')
    expect(migration).toContain("' of '")
    expect(migration).toContain('canonical_shop_name')
    expect(migration).toContain('google_profile_branch_match')
  })

  it('adds private customer geocodes and zip report aggregate tables', () => {
    const migration = readFileSync(
      join(
        process.cwd(),
        'supabase',
        'migrations',
        '20260429193000_customer_geography_locations.sql'
      ),
      'utf-8'
    )

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS sensitive.repair_customer_locations')
    expect(migration).toContain('ALTER TABLE sensitive.repair_customer_locations ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.customer_zip_report_monthly')
    expect(migration).toContain('REVOKE ALL ON sensitive.repair_customer_locations FROM anon')
    expect(migration).not.toContain('TRUNCATE accidents')
    expect(migration).not.toContain('DROP TABLE accidents')
  })

  it('adds annual zcta income table for zip-level household income overlays', () => {
    const migration = readFileSync(
      join(
        process.cwd(),
        'supabase',
        'migrations',
        '20260429195000_zcta_income_annual.sql'
      ),
      'utf-8'
    )

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.zcta_income_annual')
    expect(migration).toContain('mean_household_income')
    expect(migration).toContain('median_household_income')
    expect(migration).toContain('PRIMARY KEY (year, zip)')
  })
})
