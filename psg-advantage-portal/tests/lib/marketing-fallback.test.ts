import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { marketingIntelligenceData } from '@/lib/marketingIntelligenceData'

describe('marketing intelligence fallback dataset source', () => {
  it('uses the canonical 2016-2023 Hugging Face accident source', () => {
    expect(marketingIntelligenceData.metadata.source).toBe('yuvidhepe/us-accidents-updated')
    expect(marketingIntelligenceData.metadata.rowCount).toBe(7_728_394)
    expect(marketingIntelligenceData.metadata.expectedRowCount).toBe(7_728_394)
  })

  it('build script points at all canonical parquet shards', () => {
    const script = readFileSync(
      join(process.cwd(), 'scripts', 'build_marketing_intelligence_data.py'),
      'utf-8'
    )

    expect(script).toContain('HF_DATASET_REPO = "yuvidhepe/us-accidents-updated"')
    expect(script).not.toContain('nateraw/us-accidents')
    for (let shard = 0; shard <= 6; shard += 1) {
      expect(script).toContain(`${String(shard).padStart(4, '0')}.parquet`)
    }
  })

  it('migration adds storm demand tables and optional marketing metadata fields', () => {
    const migration = readFileSync(
      join(process.cwd(), 'supabase', 'migrations', '20260428_psg_data_infrastructure.sql'),
      'utf-8'
    )

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS storm_events')
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS storm_event_sources')
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS storm_zip_monthly')
    expect(migration).toContain('storm_event_count BIGINT')
    expect(migration).toContain('hail_event_count BIGINT')
    expect(migration).toContain('weighted_storm_demand_score')
    expect(migration).toContain('CREATE OR REPLACE VIEW v_storm_demand_examples')
    expect(migration).toContain('CREATE OR REPLACE FUNCTION storm_demand_examples')
    expect(migration).not.toContain('TRUNCATE accidents')
  })
})
