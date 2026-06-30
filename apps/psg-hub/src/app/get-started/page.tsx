import type { Metadata } from "next";
import { Logo } from "@/components/brand/logo";
import { Card, CardContent } from "@/components/ui/card";
import { InboundLeadForm } from "@/components/leads/inbound-lead-form";

// PSG-500 — Public, UNAUTHENTICATED inbound lead-capture page (parent PSG-493).
// Excluded from the Supabase auth middleware matcher (see src/middleware.ts) so
// it is reachable on production without a login. Interim capture surface: it will
// be reused/restyled when a fuller marketing site lands.

export const metadata: Metadata = {
  title: "Get a demo — Phoenix Solutions Group",
  description:
    "See how Phoenix Solutions Group helps body shops win more local repair business. Request a demo.",
};

const VALUE_PROPS = [
  "More repair leads from local search & ads",
  "Reviews, reputation, and follow-up on autopilot",
  "One dashboard for your shop's marketing & ops",
];

export default function GetStartedPage() {
  return (
    <main className="flex min-h-screen flex-col bg-background lg:flex-row">
      {/* Brand / value panel */}
      <section className="flex flex-col justify-center bg-primary px-6 py-12 text-primary-foreground lg:w-[45%] lg:px-12">
        <div className="mx-auto w-full max-w-md">
          <Logo variant="reverse" className="h-11 w-auto" />
          <p className="mt-8 font-heading text-xs font-medium uppercase tracking-[0.18em] text-ember">
            Phoenix Solutions Group
          </p>
          <h1 className="mt-3 font-heading text-3xl font-bold tracking-tight sm:text-4xl">
            Grow your body shop&rsquo;s repair business.
          </h1>
          <p className="mt-4 text-base text-primary-foreground/80">
            Tell us about your shop and we&rsquo;ll show you how PSG brings in
            more local repair customers — and keeps them coming back.
          </p>
          <ul className="mt-8 space-y-3">
            {VALUE_PROPS.map((prop) => (
              <li key={prop} className="flex items-start gap-3 text-sm">
                <span
                  aria-hidden="true"
                  className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-ember"
                />
                <span className="text-primary-foreground/90">{prop}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Form panel */}
      <section className="flex flex-1 items-center justify-center px-6 py-12 lg:px-12">
        <div className="w-full max-w-md">
          <div className="mb-6">
            <h2 className="font-heading text-2xl font-bold tracking-tight text-foreground">
              Request a demo
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Takes under a minute. No obligation.
            </p>
          </div>
          <Card>
            <CardContent className="pt-6">
              <InboundLeadForm />
            </CardContent>
          </Card>
          <p className="mt-6 text-center text-xs text-muted-foreground">
            By submitting, you agree to be contacted by Phoenix Solutions Group
            about your request.
          </p>
        </div>
      </section>
    </main>
  );
}
