import fs from 'node:fs'
import path from 'node:path'

export function readEnvVarFromFile(filePath, key) {
  if (!fs.existsSync(filePath)) return null
  const content = fs.readFileSync(filePath, 'utf8')
  const line = content
    .split(/\r?\n/)
    .find((item) => item.trim().startsWith(`${key}=`))
  if (!line) return null
  const raw = line.slice(line.indexOf('=') + 1).trim()
  if (!raw) return null
  return raw.replace(/^['"]|['"]$/g, '')
}

export function getStandaloneEnvCandidates(cwd = process.cwd()) {
  return [
    path.resolve(cwd, '.env.local'),
    path.resolve(cwd, '../psg-data-lake/.env.local'),
  ]
}

export function resolveStandaloneDatabaseUrl({
  cwd = process.cwd(),
  env = process.env,
} = {}) {
  if (env.SUPABASE_DB_URL) {
    return {
      value: env.SUPABASE_DB_URL,
      source: 'process.env.SUPABASE_DB_URL',
      sourceType: 'env',
    }
  }

  if (env.DATABASE_URL) {
    return {
      value: env.DATABASE_URL,
      source: 'process.env.DATABASE_URL',
      sourceType: 'env',
    }
  }

  for (const candidate of getStandaloneEnvCandidates(cwd)) {
    const supabaseDbUrl = readEnvVarFromFile(candidate, 'SUPABASE_DB_URL')
    if (supabaseDbUrl) {
      return {
        value: supabaseDbUrl,
        source: `${path.relative(cwd, candidate) || '.env.local'}#SUPABASE_DB_URL`,
        sourceType: 'file',
      }
    }

    const databaseUrl = readEnvVarFromFile(candidate, 'DATABASE_URL')
    if (databaseUrl) {
      return {
        value: databaseUrl,
        source: `${path.relative(cwd, candidate) || '.env.local'}#DATABASE_URL`,
        sourceType: 'file',
      }
    }
  }

  return null
}

export function ensureBuildArtifacts(cwd = process.cwd()) {
  const standaloneRoot = path.join(cwd, '.next', 'standalone')
  const standaloneNext = path.join(standaloneRoot, '.next')
  const sourceStatic = path.join(cwd, '.next', 'static')
  const targetStatic = path.join(standaloneNext, 'static')
  const sourcePublic = path.join(cwd, 'public')
  const targetPublic = path.join(standaloneRoot, 'public')

  if (!fs.existsSync(standaloneRoot)) {
    throw new Error('Missing .next/standalone. Run `npm run build` first.')
  }

  if (!fs.existsSync(sourceStatic)) {
    throw new Error('Missing .next/static. Run `npm run build` first.')
  }

  return {
    standaloneRoot,
    sourceStatic,
    targetStatic,
    sourcePublic,
    targetPublic,
  }
}

function copyDir(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.cpSync(source, target, { recursive: true, force: true })
}

export function prepareStandaloneAssets(cwd = process.cwd()) {
  const paths = ensureBuildArtifacts(cwd)
  copyDir(paths.sourceStatic, paths.targetStatic)
  if (fs.existsSync(paths.sourcePublic)) {
    copyDir(paths.sourcePublic, paths.targetPublic)
  }
  return paths
}

export function buildStandaloneServerEnv({
  cwd = process.cwd(),
  env = process.env,
} = {}) {
  const nextEnv = { ...env }
  const resolution = resolveStandaloneDatabaseUrl({ cwd, env })

  if (resolution && !nextEnv.SUPABASE_DB_URL) {
    nextEnv.SUPABASE_DB_URL = resolution.value
  }

  if (!nextEnv.PORT) {
    nextEnv.PORT = '3001'
  }

  if (resolution?.sourceType === 'file' && nextEnv.PSG_ALLOW_DEMO_AUTH == null) {
    nextEnv.PSG_ALLOW_DEMO_AUTH = '1'
  }

  return {
    env: nextEnv,
    resolution,
  }
}
