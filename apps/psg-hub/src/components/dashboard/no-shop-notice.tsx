import { Logo } from "@/components/brand/logo";

/**
 * Shown when an authenticated non-staff user has no shop membership.
 * Renders instead of the dashboard shell (no redirect loop).
 */
export function NoShopNotice({ email }: { email?: string | null }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-8 text-center shadow-sm">
        <div className="mb-6 flex justify-center">
          <Logo variant="primary" className="h-7 w-auto" />
        </div>
        <h1 className="font-heading text-xl font-bold tracking-tight text-foreground">
          No shop assigned yet
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Your account{email ? ` (${email})` : ""} isn&rsquo;t linked to a shop
          yet. Contact Phoenix Solutions Group to get access to your hub.
        </p>
        <form action="/api/auth/signout" method="post" className="mt-6">
          <button
            type="submit"
            className="font-heading text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
