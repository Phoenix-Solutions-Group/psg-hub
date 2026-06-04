import { Logo } from "@/components/brand/logo";
import { OnboardingWizard } from "@/components/dashboard/onboarding-wizard";

/**
 * Shown when an authenticated non-staff user has no shop yet (self-serve onboarding).
 * Renders instead of the dashboard shell — focused, no nav, with a sign-out escape.
 */
export function OnboardingScreen({ email }: { email?: string | null }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6">
      <div className="w-full max-w-lg space-y-6">
        <div className="flex justify-center">
          <Logo variant="primary" className="h-7 w-auto" />
        </div>
        <div className="text-center">
          <p className="font-heading text-xs font-medium uppercase tracking-[0.18em] text-ember">
            Phoenix Solutions Group
          </p>
          <h1 className="mt-2 font-heading text-2xl font-bold tracking-tight">
            Welcome to your hub
          </h1>
          <p className="mt-1 text-muted-foreground">
            Set up your shop to get started with AI-powered marketing.
          </p>
        </div>
        <OnboardingWizard />
        <form action="/api/auth/signout" method="post" className="text-center">
          <button
            type="submit"
            className="font-heading text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Sign out{email ? ` (${email})` : ""}
          </button>
        </form>
      </div>
    </div>
  );
}
