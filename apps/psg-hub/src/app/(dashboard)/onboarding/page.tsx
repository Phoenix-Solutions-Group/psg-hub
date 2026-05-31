import { OnboardingWizard } from "@/components/dashboard/onboarding-wizard";

export default function OnboardingPage() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight">
            Welcome to BSM
          </h1>
          <p className="mt-1 text-muted-foreground">
            Set up your shop to get started with AI-powered marketing.
          </p>
        </div>
        <OnboardingWizard />
      </div>
    </div>
  );
}
