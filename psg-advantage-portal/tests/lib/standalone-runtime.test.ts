import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const runtimeModule = import('../../scripts/standalone-runtime.mjs')
const tempRoots: string[] = []

function makePortalFixture() {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'psg-portal-'))
  const portalDir = path.join(baseDir, 'psg-advantage-portal')
  const lakeDir = path.join(baseDir, 'psg-data-lake')
  fs.mkdirSync(portalDir, { recursive: true })
  fs.mkdirSync(lakeDir, { recursive: true })
  tempRoots.push(baseDir)
  return { portalDir, lakeDir }
}

afterEach(() => {
  while (tempRoots.length) {
    fs.rmSync(tempRoots.pop()!, { recursive: true, force: true })
  }
})

describe('standalone runtime env resolution', () => {
  it('prefers process.env.SUPABASE_DB_URL over file fallbacks', async () => {
    const { portalDir, lakeDir } = makePortalFixture()
    fs.writeFileSync(path.join(portalDir, '.env.local'), 'SUPABASE_DB_URL=postgres://portal\n')
    fs.writeFileSync(path.join(lakeDir, '.env.local'), 'SUPABASE_DB_URL=postgres://lake\n')
    const { resolveStandaloneDatabaseUrl } = await runtimeModule

    const resolution = resolveStandaloneDatabaseUrl({
      cwd: portalDir,
      env: { SUPABASE_DB_URL: 'postgres://env-supabase' },
    })

    expect(resolution).toEqual({
      value: 'postgres://env-supabase',
      source: 'process.env.SUPABASE_DB_URL',
      sourceType: 'env',
    })
  })

  it('prefers portal .env.local over sibling psg-data-lake env', async () => {
    const { portalDir, lakeDir } = makePortalFixture()
    fs.writeFileSync(path.join(portalDir, '.env.local'), 'SUPABASE_DB_URL=postgres://portal\n')
    fs.writeFileSync(path.join(lakeDir, '.env.local'), 'SUPABASE_DB_URL=postgres://lake\n')
    const { resolveStandaloneDatabaseUrl } = await runtimeModule

    const resolution = resolveStandaloneDatabaseUrl({
      cwd: portalDir,
      env: {},
    })

    expect(resolution?.value).toBe('postgres://portal')
    expect(resolution?.source).toBe('.env.local#SUPABASE_DB_URL')
    expect(resolution?.sourceType).toBe('file')
  })

  it('falls back to sibling psg-data-lake env when portal env is missing', async () => {
    const { portalDir, lakeDir } = makePortalFixture()
    fs.writeFileSync(path.join(lakeDir, '.env.local'), 'SUPABASE_DB_URL=postgres://lake\n')
    const { resolveStandaloneDatabaseUrl } = await runtimeModule

    const resolution = resolveStandaloneDatabaseUrl({
      cwd: portalDir,
      env: {},
    })

    expect(resolution?.value).toBe('postgres://lake')
    expect(resolution?.source).toBe('../psg-data-lake/.env.local#SUPABASE_DB_URL')
    expect(resolution?.sourceType).toBe('file')
  })

  it('returns null when no env source exists', async () => {
    const { portalDir } = makePortalFixture()
    const { resolveStandaloneDatabaseUrl } = await runtimeModule

    const resolution = resolveStandaloneDatabaseUrl({
      cwd: portalDir,
      env: {},
    })

    expect(resolution).toBeNull()
  })

  it('enables local demo auth when database config comes from a local file', async () => {
    const { portalDir } = makePortalFixture()
    fs.writeFileSync(path.join(portalDir, '.env.local'), 'SUPABASE_DB_URL=postgres://portal\n')
    const { buildStandaloneServerEnv } = await runtimeModule

    const { env, resolution } = buildStandaloneServerEnv({
      cwd: portalDir,
      env: {},
    })

    expect(resolution?.sourceType).toBe('file')
    expect(env.SUPABASE_DB_URL).toBe('postgres://portal')
    expect(env.PSG_ALLOW_DEMO_AUTH).toBe('1')
    expect(env.PORT).toBe('3001')
  })
})
