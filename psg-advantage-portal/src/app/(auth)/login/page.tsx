import LoginPageClient from '@/components/auth/LoginPageClient'
import { isDemoAuthEnabled } from '@/lib/demoAuth'

export default function LoginPage() {
  return <LoginPageClient isLocalDemo={isDemoAuthEnabled()} />
}
