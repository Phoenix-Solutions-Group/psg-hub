export function isDemoAuthEnabled() {
  return process.env.PSG_ALLOW_DEMO_AUTH === '1' || process.env.NODE_ENV !== 'production'
}

export function hasDemoAuthCookie(value: string | undefined) {
  return isDemoAuthEnabled() && value === '1'
}
