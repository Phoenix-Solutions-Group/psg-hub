import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: [
      "src/**/__tests__/**/*.test.{ts,tsx}",
      "src/**/*.test.{ts,tsx}",
    ],
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text"],
      // ── v0.2 quality gate (Phase 8 / 08-04, S5) ──────────────────────────
      // The denominator is the v0.2 NEW-CODE surface (Phases 6/7/8 authored
      // logic), NOT all of src/. A whole-src threshold would dilute the gate
      // against inherited/v0.1 + v0.3-gated code (google-ads, ads, mail, sms,
      // resilience, ui, billing) and make the 70% number meaningless.
      // The threshold is enforced per-file at >=70% lines (PROJECT metric).
      include: [
        "src/lib/tier/gate.ts", // 07-02 tier-gate helper
        "src/lib/shop/context.ts", // 07-03 active-shop context
        "src/lib/auth/shop-access.ts", // 06-03 dashboard gate
        "src/lib/reviews/prompts.ts", // 06-04 reviews reconcile
        "src/lib/reviews/safety.ts",
        "src/lib/reviews/responder.ts",
        "src/lib/reviews/rate-limit.ts",
        "src/lib/logging/llm-call.ts", // 06-05 llm_call_log logger
        "src/app/api/onboarding/route.ts", // 07-01 onboarding bootstrap
        "src/app/api/shop/switch/route.ts", // 07-03 shop switch
        "src/app/api/reviews/[id]/draft-response/route.ts", // 06-04 reviews API
        "src/app/api/reviews/[id]/approve-response/route.ts",
        "src/lib/analytics/snapshots.ts", // 09-01 analytics snapshot helpers (v0.3)
        "src/lib/analytics/aggregate.ts", // 09-02 MSO aggregate + series shaping (v0.3)
        "src/lib/semrush/client.ts", // 09-03 SEMrush HTTP client (v0.3)
        "src/lib/semrush/sync.ts", // 09-03 ingest orchestrator (v0.3)
        "src/app/api/cron/semrush-sync/route.ts", // 09-03 cron route (v0.3)
        "src/types/content-brief.ts", // PSG-160 ContentBrief DTO + schema
        "src/lib/bsm/content-briefs.ts", // PSG-160 brief writer + loader
        "src/app/api/shops/[shopId]/content-briefs/route.ts", // PSG-160 brief read API
        "src/app/api/content/[id]/publish/route.ts", // PSG-194 approved->published gate
        "src/app/api/content/[id]/reject/route.ts", // PSG-194 reject-bug regression
        "src/lib/bsm/content-drafts.ts", // PSG-194 idempotent draft persistence
        "src/lib/ops/mail/parse-production-batch.ts", // PSG-223 W0 send-batch parser
        "src/lib/ops/mail/send-history-import.ts", // PSG-223 W0 importer + reconciliation
        "src/lib/ccc/connection-state.ts", // PSG-266 CCC Phase 3 connection-state contract (pure)
        // PSG-248 / Wave 2 (G-c) — proactive review solicitation (SMS + email).
        "src/lib/ops/solicitation/contact.ts", // PII-min contact normalization + hashing
        "src/lib/ops/solicitation/optout.ts", // STOP/START/HELP classification + status fold
        "src/lib/ops/solicitation/token.ts", // signed unsubscribe token
        "src/lib/ops/solicitation/draft.ts", // copy builder + CAN-SPAM/TCPA validator
        "src/lib/ops/solicitation/plan.ts", // per-channel send-plan gate
        "src/lib/ops/solicitation/enqueue.ts", // draft + govern: build, validate, queue
        "src/lib/ops/solicitation/publisher.ts", // approval-queue publisher (send on approve)
        "src/app/api/sms/webhook/route.ts", // Twilio inbound STOP/START/HELP
        "src/app/api/unsubscribe/route.ts", // CAN-SPAM unsubscribe
        "src/lib/leads/first-touch.ts", // PSG-500 first-touch UTM capture (pure core)
      ],
      // Excluded v0.2-adjacent surfaces (covered elsewhere / not unit-gateable
      // in env=node), with rationale:
      // - mobile-nav.tsx: the pure MobileNavPanel render branches ARE unit-tested
      //   (mobile-nav.test.tsx), but the stateful MobileNav disclosure (useState
      //   toggle + open panel) needs a DOM/click -> covered by 08-04b Playwright
      //   E2E. Not in the include set (env=node has no jsdom).
      // - reviews/list + reviews/ingest routes: guarded/deferred surfaces
      //   (ingest returns 501; list is read-only) -> their owning milestone.
      // - shop-switcher.tsx / onboarding components: client useRouter hooks,
      //   covered by 08-04b Playwright E2E (no jsdom in this node env).
      // - analytics/charts.tsx (09-01): Recharts 3 renders NO SVG geometry in
      //   node SSR (geometry computes in effects/Redux) -> chart content can't be
      //   unit-tested. The wrapper chrome (caption/role/aria/empty-state) IS
      //   smoke-tested with recharts mocked (charts.test.tsx); real render + axe
      //   AA -> 09-02 Playwright. Excluded like mobile-nav.tsx.
      // - analytics/types.ts: pure type declarations, no executable lines.
      thresholds: {
        perFile: true,
        lines: 70,
      },
    },
  },
});
