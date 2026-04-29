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
})
