import path from 'node:path'
import { spawn } from 'node:child_process'
import {
  buildStandaloneServerEnv,
  prepareStandaloneAssets,
} from './standalone-runtime.mjs'

const cwd = process.cwd()
prepareStandaloneAssets(cwd)

const { env, resolution } = buildStandaloneServerEnv({ cwd })
const serverPath = path.join(cwd, '.next', 'standalone', 'server.js')

if (resolution) {
  console.log(`[start-standalone] using database config from ${resolution.source}`)
} else {
  console.warn('[start-standalone] no local database config resolved; relying on server runtime env only')
}

if (env.PSG_ALLOW_DEMO_AUTH === '1') {
  console.log('[start-standalone] local demo auth enabled for standalone parity testing')
}

const child = spawn(process.execPath, [serverPath], {
  cwd,
  env,
  stdio: 'inherit',
})

const terminateChild = (signal) => {
  if (!child.killed) {
    child.kill(signal)
  }
}

process.on('SIGINT', () => terminateChild('SIGINT'))
process.on('SIGTERM', () => terminateChild('SIGTERM'))

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})
