import { NextResponse } from 'next/server'
import { getCached, setCached } from '@/lib/cache'
import { healthCheck } from '@/lib/supabase/data'

export async function GET() {
  const checks: Record<string, string> = {}

  try {
    checks.supabase = await healthCheck() ? 'ok' : 'error'
  } catch (e) {
    checks.supabase = `error: ${(e as Error).message}`
  }

  try {
    await setCached('health:check', { ts: Date.now() }, 60)
    const cached = await getCached<{ ts: number }>('health:check')
    checks.redis = cached ? 'ok' : 'error'
  } catch (e) {
    checks.redis = `error: ${(e as Error).message}`
  }

  const allOk = Object.values(checks).every((v) => v === 'ok')
  return NextResponse.json(
    { status: allOk ? 'healthy' : 'degraded', checks },
    { status: 200 }
  )
}
