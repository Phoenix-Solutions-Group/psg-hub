import { spawn } from 'node:child_process'

const port = process.env.PORT || '3201'
const baseUrl = `http://127.0.0.1:${port}`
const child = spawn(process.execPath, ['scripts/start-standalone.mjs'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: port,
    PSG_ALLOW_DEMO_AUTH: '1',
  },
  stdio: 'inherit',
})

const shutdown = () => {
  if (!child.killed) {
    child.kill('SIGTERM')
  }
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForReady(url, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Cookie: 'psg_demo_auth=1' },
      })
      if (response.ok) return response
    } catch {}
    await wait(500)
  }
  throw new Error(`Timed out waiting for ${url}`)
}

async function assertOk(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options)
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Request failed for ${pathname}: ${response.status} ${body}`)
  }
  return response
}

try {
  const loginResponse = await waitForReady(`${baseUrl}/login`)
  const loginHtml = await loginResponse.text()
  const cssMatch = loginHtml.match(/\/_next\/static\/css\/[^"]+\.css/g)
  if (!cssMatch?.length) {
    throw new Error('No CSS asset reference found on /login')
  }

  await assertOk(cssMatch[0])
  await assertOk('/customer-geography', {
    headers: { Cookie: 'psg_demo_auth=1' },
  })

  const params = new URLSearchParams({
    startDate: '2024-01-01',
    endDate: new Date().toISOString().slice(0, 10),
    preset: 'nyc_nassau_suffolk',
    limit: '2000',
  })

  for (const route of ['shops', 'pins', 'zip-income']) {
    await assertOk(`/api/customer-geography/${route}?${params.toString()}`, {
      headers: { Cookie: 'psg_demo_auth=1' },
    })
  }

  console.log('[verify-customer-geography-parity] standalone parity checks passed')
} finally {
  shutdown()
}
