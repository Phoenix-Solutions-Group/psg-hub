import { createBrowserClient } from '@supabase/ssr'
import { getSupabasePublicKey, getSupabaseUrl } from './config'

export function createClient() {
  return createBrowserClient(getSupabaseUrl(), getSupabasePublicKey())
}
