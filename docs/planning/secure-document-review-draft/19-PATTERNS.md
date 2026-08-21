# Phase 19: Secure Document Review - Pattern Map

**Mapped:** 2026-07-28
**Scope:** Build-local only; no production Supabase, Storage, SendGrid, Vercel, or git mutation
**Files analyzed:** 42 likely new/modified files, grouped below by shared implementation pattern
**Analogs found:** 36 / 42; six hostile-input/viewer/SQL-test surfaces are genuinely new

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `supabase/migrations/<generated>_document_reviews.sql` | migration/model/security | CRUD, event-driven | `20260610000000_monthly_reports.sql`; `20260602163210_rbac_helpers.sql`; `20260613000000_monthly_reports_claim.sql` | composite |
| `supabase/tests/document_reviews.sql` | SQL security test | CRUD/state transitions | No current `supabase/tests/` analog | none |
| `src/lib/document-review/schemas.ts` | validation/model | transform | `src/lib/report/schema.ts` | role-match |
| `src/lib/document-review/tokens.ts` | security utility | request-response | `src/lib/google-oauth/state.ts`; `src/app/api/shop/switch/route.ts` | partial |
| `src/lib/document-review/auth.ts` | authorization DAL | request-response | `src/lib/auth/shop-access.ts`; report download route | exact shape |
| `src/lib/document-review/artifact.ts` | model/utility | file-I/O, transform | `src/lib/report/schema.ts`; `src/lib/report/storage.ts` | role-match |
| `src/lib/document-review/converter.ts` | external adapter | file-I/O, request-response | `src/lib/report/render-client.ts` | seam-only |
| `src/lib/document-review/storage.ts` | storage adapter | file-I/O | `src/lib/report/storage.ts` | exact shape |
| `src/lib/document-review/upload.ts` | service/orchestrator | file-I/O, batch | `src/lib/report/monthly.ts`; onboarding compensation | role-match |
| `src/lib/document-review/comments.ts` | service/DTO | CRUD, transform | `src/lib/ads/view-state.ts`; report readers | partial |
| `src/lib/document-review/notifications.ts` | service/adapter | event-driven | `src/lib/report/email.ts`; `src/lib/report/monthly.ts` | exact shape |
| `src/lib/document-review/geometry.ts` | client utility | transform | No coordinate analog | none |
| `workers/document-converter/{Dockerfile,package.json,convert.mjs}` | isolated worker | file-I/O, batch | `workers/report-renderer/*` | packaging only |
| `src/app/api/document-reviews/route.ts` | route/controller | request-response, file-I/O | onboarding route; analytics select route | partial |
| `src/app/api/document-reviews/[reviewId]/versions/route.ts` | route/controller | request-response, file-I/O | onboarding route | partial |
| `src/app/api/document-reviews/guest/exchange/route.ts` | route/controller | request-response | shop switch route; OAuth state consume | partial |
| `src/app/api/document-reviews/[reviewId]/artifacts/**/route.ts` | route/controller | request-response, file-I/O | report download route | exact |
| `src/app/api/document-reviews/[reviewId]/original/route.ts` | route/controller | request-response, file-I/O | report download route | exact |
| `src/app/api/document-reviews/[reviewId]/comments/**/route.ts` | route/controller | CRUD, request-response | reviews draft/approve route tests | role-match |
| `src/app/api/document-reviews/[reviewId]/{submit,reopen}/route.ts` | route/controller | event-driven, request-response | monthly-report RPC binding | role-match |
| `src/app/api/document-reviews/[reviewId]/recipients/**/route.ts` | route/controller | CRUD, event-driven | onboarding compensation; mail pipeline | role-match |
| `src/app/dashboard/document-reviews/page.tsx` | page/component | request-response | `src/app/dashboard/page.tsx` | role-match |
| `src/app/dashboard/document-reviews/new/page.tsx` | page/form | request-response, file-I/O | login/onboarding form family | partial |
| `src/app/dashboard/document-reviews/[reviewId]/page.tsx` | page/component | request-response | dashboard pages + tables/cards | role-match |
| `src/app/dashboard/document-reviews/[reviewId]/versions/new/page.tsx` | page/form | request-response, file-I/O | create-review page | same-phase reuse |
| `src/app/dashboard/document-reviews/[reviewId]/review/page.tsx` | page/component | request-response | no viewer analog | partial |
| `src/app/dashboard/document-reviews/[reviewId]/submissions/[submissionId]/page.tsx` | page/component | request-response | no viewer analog | partial |
| `src/app/review/guest/page.tsx` | guest entry page | request-response | login page visual shell | role-match |
| `src/app/review/guest/[recipientId]/page.tsx` | guest page | request-response | login shell + same-phase viewer | partial |
| `src/components/document-review/review-table.tsx` | component | transform | `campaigns-table.tsx`; UI `Table` | exact |
| `src/components/document-review/review-form.tsx` | component/form | request-response, file-I/O | login form; create-campaign modal | role-match |
| `src/components/document-review/{dialog,comment-panel}.tsx` | component/modal | event-driven | create-campaign modal; `focus-trap.ts` | exact |
| `src/components/document-review/{viewer,page,pin,toolbar}.tsx` | component | event-driven, transform | no document viewer analog | none |
| `src/components/document-review/{comment-rail,comment-card,composer}.tsx` | component/form | CRUD, event-driven | modal/form/table primitives | role-match |
| `src/components/document-review/{loading,error,empty,status}.tsx` | component | state transform | analytics `loading.tsx` / `error.tsx`; `Badge` | exact |
| `src/components/document-review/guest-shell.tsx` | component/layout | request-response | login page + `Logo` | exact |
| `src/app/dashboard/layout.tsx` | shell/nav | request-response | existing file itself | extend |
| `src/components/dashboard/mobile-nav.tsx` and test | shell/nav/test | event-driven | existing file itself | extend |
| `src/lib/document-review/__tests__/*.test.ts` | unit tests | all above | report/auth/mail/ads Vitest tests | exact |
| `src/app/api/document-reviews/**/__tests__/route.test.ts` | route tests | request-response | report download and onboarding route tests | exact |
| `e2e/document-review.spec.ts` | browser/a11y test | event-driven | `e2e/auth.spec.ts`; `e2e/analytics.spec.ts` | exact harness |
| `e2e/global.setup.ts`, `e2e/fixtures.ts` | local fixture/config | batch | current local-only deterministic seed | exact |
| `vitest.config.ts` | test config | config | current coverage include list | extend |
| `package.json`, `pnpm-lock.yaml` | dependency config | config | existing package conventions | extend only for approved sandbox SDK |

## Pattern Assignments

### Database migration, RLS, capability, audit, and state RPCs

**Use these analogs together:**

- `supabase/migrations/20260602163208_app_user_roles_security_profiles.sql:19-25` establishes `security_profiles.functions_jsonb` and RLS.
- `supabase/migrations/20260602163210_rbac_helpers.sql:19-51` is the capability helper pattern.
- `supabase/migrations/20260610000000_monthly_reports.sql:17-43` is the additive table/check/RLS/policy pattern.
- `supabase/migrations/20260613000000_monthly_reports_claim.sql:22-62` is the atomic conditional-mutation RPC pattern.

```sql
create or replace function private.current_user_has_fn(fn text)
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select exists (
    select 1
    from public.app_user_roles r
    where r.profile_id = (select auth.uid())
      and (
        r.role = 'psg_superadmin'
        or (
          r.role = 'psg_internal'
          and coalesce(
            (select sp.functions_jsonb
             from public.security_profiles sp
             where sp.profile_id = (select auth.uid())) ? fn,
            false
          )
        )
      )
  )
$$;
```

Copy the fixed `search_path`, fully-qualified names, explicit revoke/grant, `drop policy if exists` before `create policy`, named checks, foreign-key indexes, and RLS-on posture. Extend the capability vocabulary with one stable key such as `document_reviews`.

The Phase 19 migration should create the seven research tables in one generated migration: reviews, immutable versions, recipients, mutable draft comments, immutable submission generations, append-only audit events, and notification ledger. Use checks for recipient kind/state, exactly-one authenticated-profile-or-guest identity, normalized ratios in `[0,1]`, positive page/version/submission numbers, and unique `(review_id, version_number)`, `(recipient_id, submission_number)`, token digest, and notification dedupe key.

For submit/reopen/version/invite/revoke, copy the atomicity principle from `claim_monthly_report`, not a read-then-write route sequence:

```sql
update public.monthly_reports
set claimed_at = now()
where shop_id = p_shop_id
  and period_month = p_period_month
  and (claimed_at is null or claimed_at < now() - make_interval(mins => p_stale_minutes))
returning true;
```

Phase 19 needs a new service-only transaction/RPC that locks the recipient, validates editable state, orders comments by page/Y/X/creation time, inserts the immutable snapshot, locks the recipient, appends audit, and inserts the notification ledger record. Keep it non-`SECURITY DEFINER` when called only with the service role; the protocol forbids public `SECURITY DEFINER` helpers.

**Local SQL verification:** no `supabase/tests/` suite exists. Create the smallest SQL fixture that proves the auth matrix, ratio/state checks, immutable version/submission protections, token expiry/revocation, comment lock after submit, reopen generation behavior, and notification dedupe. Run only after local `supabase db reset`. Preserve the hard local-only guard demonstrated by `e2e/global.setup.ts:19-29`; Phase 19 does not apply anything to project `gylkkzmcmbdftxieyabw`.

### Authenticated and guest authorization

**Analog:** `src/lib/auth/shop-access.ts:1-30`

```ts
import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

export async function getDashboardAccess(userId: string) {
  const service = createServiceClient();
  const [{ data: roleRow }, { data: memberships }] = await Promise.all([
    service.from("app_user_roles").select("role").eq("profile_id", userId).maybeSingle(),
    service.from("shop_users").select("shop_id").eq("user_id", userId),
  ]);
  // Return a typed decision input; keep the decision pure and unit-testable.
}
```

**Object-route analog:** `src/app/api/reports/[shopId]/[period]/download/route.ts:26-55`

```ts
const supabase = await createClient();
const { data: { user } } = await supabase.auth.getUser();
if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

// Explicit authorization BEFORE service-role object access.
const service = createServiceClient();
const { data, error } = await service.storage
  .from(REPORTS_BUCKET)
  .download(serverDerivedPath);
if (error || !data) {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
```

Create one `authorizeDocumentReview()` DAL returning a typed actor (`admin`, assigned authenticated recipient, or active guest recipient). Every page, manifest, page image/text, comment mutation, submit, download, revoke, reopen, and version route must call it. Derive every storage key from the authorized version row; never accept an object path from the client.

For guest access, borrow the active-shop cookie rule from `src/lib/shop/context.ts:35-62`: a cookie selects a candidate but never authorizes; revalidate it against current database state on every request. Borrow cookie setting from `src/app/api/shop/switch/route.ts:30-43`, but use `sameSite: "strict"`, a guest-route `path`, `httpOnly`, `secure`, and bounded `maxAge`.

Use a uniform unavailable/not-found result for missing, expired, revoked, or mismatched guest access. The authenticated branch must bind `auth.getUser().id` to the exact assigned recipient; dashboard membership or knowledge of a review UUID is insufficient.

### Guest token creation and fragment exchange

**Partial analog:** `src/lib/google-oauth/state.ts:48-80,98-116,139-171` supplies `randomBytes`, expiry, and atomic-consume testing ideas. It is not a storage model to copy.

Phase 19 should instead generate `randomBytes(32).toString("base64url")`, persist only `createHash("sha256").update(raw).digest(...)`, and compare the incoming token by digest lookup. The raw token exists only long enough to build the invitation fragment URL.

The guest entry client is new:

1. Read `location.hash` once.
2. Immediately call `history.replaceState` to remove it.
3. POST the raw token in the body.
4. On success use `router.replace` to the cookie-scoped workspace.
5. Never log, render, announce, query-string, or browser-store the token.

Do **not** copy OAuth state persistence: `google_oauth_pending_states.state_token` stores the signed state token itself (`20260609183452_google_oauth_pending_states.sql:24-40`), which conflicts with Phase 19's raw-token prohibition.

### Upload route, validation, artifact schema, and orchestration

**Envelope parsing analog only:** `src/app/api/analytics/google/select/route.ts:47-70`

```ts
const form = await request.formData();
const value = form.get("field");
```

There is no existing file-upload or magic-signature validator. Build this as a new pure boundary in `upload.ts`/`schemas.ts`: hard request/body ceiling, one `File`, allowed extension, byte length, coarse PDF/DOCX/HTML signature, then isolated conversion. Browser `accept` and `File.type` are hints only.

**Compensation analog:** `src/app/api/onboarding/route.ts:62-96` deletes only objects created by the failed orchestration step. Phase 19 should follow:

```text
authorize admin
-> parse small multipart body
-> validate envelope and bytes
-> convert in isolated sandbox
-> validate returned manifest with Zod
-> upload original + artifact objects under a generated version prefix
-> commit version/recipients/audit in one DB operation
-> on DB failure, delete only that generated prefix
```

**Zod analog:** `src/lib/report/schema.ts:8-41`

```ts
import { z } from "zod";

export const reportNarrativeSchema = z.object({
  headline: z.string(),
  recommendations: z.array(z.string()),
});
export type ReportNarrative = z.infer<typeof reportNarrativeSchema>;
```

Use the same schema-plus-inferred-type pattern for route inputs and the converter manifest. The artifact manifest must validate schema version, source digest, bounded page count, dimensions, image/text keys, and checksums before any persistent write.

### Conversion adapter and isolated worker

**Copy only the adapter/testing seam:** `src/lib/report/render-client.ts:18-30,51-78`

```ts
export type RenderDeps = {
  httpPost?: RenderHttpPost;
  breaker?: CircuitBreaker;
  retry?: RetryOptions;
};

export async function renderReportPdf(slug: string, deps: RenderDeps = {}) {
  const post = deps.httpPost ?? fetchPost;
  return breaker.execute(() =>
    withRetry(async () => {
      const res = await post(renderUrl, request);
      if (!res.ok) throw new Error(`render worker responded ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    }, deps.retry)
  );
}
```

`converter.ts` should similarly inject sandbox creation/command/file-read operations so Vitest uses no microVM or network. Validate the returned manifest and always destroy the sandbox in `finally`.

The worker packaging may copy the separate package/Dockerfile ownership of `workers/report-renderer/`, but Phase 19's converter is a pinned custom image, a fresh ephemeral sandbox per input, deny-all network, no application/Storage/SendGrid secrets, bounded CPU/time/output/archive expansion/pages, and explicit non-zero failure.

### Private Storage upload and download

**Analog:** `src/lib/report/storage.ts:16-35,51-66,98-114`

```ts
export type ReportStorage = {
  from(bucket: string): {
    upload(path: string, body: Uint8Array, options?: {
      upsert?: boolean; contentType?: string
    }): Promise<{ data: unknown; error: { message: string } | null }>;
    download(path: string): Promise<{
      data: Blob | null; error: { message: string } | null
    }>;
  };
};

function resolveStorage(deps: StorageDeps): ReportStorage {
  return deps.storage ?? (createServiceClient().storage as unknown as ReportStorage);
}
```

Copy dependency injection, explicit content type, error propagation, and service-only default binding. Change the semantics:

- Generated immutable keys under a server-created review/version prefix.
- `upsert: false`, never the report module's `upsert: true`.
- Private bucket with no direct authenticated/anon object `SELECT` policy.
- All page image/text/original reads proxy through `authorizeDocumentReview()`.
- Originals return `Content-Disposition: attachment`; page images may be inline, both with `Cache-Control: private, no-store`.

Do not copy `monthly_reports_objects_select` (`20260610000000_monthly_reports.sql:45-58`): direct authenticated Storage access cannot enforce guest revocation or exact recipient assignment.

### Comments, ordered snapshots, and geometry

No in-repo annotation geometry analog exists. Keep `geometry.ts` pure:

```ts
ratio = clamp((clientCoordinate - pageRectStart) / pageRectSize, 0, 1)
cssPosition = `${ratio * 100}%`
```

Persist only `page_number`, `x_ratio`, and `y_ratio`. Calculate against the displayed image content box, not viewport, wrapper border, label, transform, or scroll offsets. Zoom by changing rendered width, not `transform: scale()`.

The closest state-pattern analog is `src/lib/ads/view-state.ts:10-35`: a pure decision function with direct branch tests. Use that style for comment ordering, editability decisions, zoom steps, pointer conversion, arrow movement (1%, Shift 5%), clamp behavior, and active pin/comment state. Do not build a generic annotation framework.

Database ordering for snapshot/admin inspection is exactly:

```text
page_number ASC, y_ratio ASC, x_ratio ASC, created_at ASC
```

UI disablement is feedback only. Comment insert/update/delete must re-check draft/reopened state in the database; submit must snapshot and lock atomically.

### SendGrid notifications and idempotency

**Mail adapter:** `src/lib/mail/sendgrid.ts:83-115,117-162`

```ts
export interface MailSender {
  send(message: MailMessage): Promise<MailResult>;
}

export function createMailSender(options: MailSenderOptions = {}): MailSender {
  // CircuitBreaker + withRetry, injectable retry/breaker.
}
```

**Pure payload builder:** `src/lib/report/email.ts:36-58`

```ts
export function buildReportEmail(...): MailMessage {
  return {
    to,
    templateId,
    dynamicTemplateData,
    clickTracking: false,
  };
}
```

**Exactly-once external effect:** `src/lib/report/monthly.ts:108-127` and `20260613000000_monthly_reports_claim.sql:43-58`

```ts
const claimed = await deps.claimForSend(id, kind);
if (!claimed) return "skipped";
await deps.sendEmail(message);
await deps.markSent(id);
```

Submission and invitation transactions should insert a notification row with a unique dedupe key; an atomic claim must win before calling SendGrid. Record sent/failed attempts and provider message ID. Submission state must remain committed if email fails. Never place a raw guest token in the notification ledger, audit JSON, or error logs; a failed guest invitation is recovered by “Send new invitation,” which rotates the token.

### Dashboard navigation and guest shell

**Authenticated shell:** `src/app/dashboard/layout.tsx:10-18,25-43,45-95`

Compute the conditional `Document Reviews` item server-side from one extended access result: admin capability **or** at least one assigned review. Pass the same filtered `NAV` array to the desktop map and `MobileNav` (`layout.tsx:57-79`). Do not scope the module to `activeShopId`.

**Guest shell:** `src/app/(auth)/login/page.tsx:1-29`

```tsx
<div className="flex min-h-screen items-center justify-center bg-background px-4">
  <div className="w-full max-w-sm">
    <Logo variant="primary" className="h-12 w-auto" />
    <h1>...</h1>
  </div>
</div>
```

Reuse the paper background, PSG logo, centered single-purpose layout, and typography. Omit dashboard navigation, shop switcher, sign-out, signup, recipient lists, audit history, and administrator details.

### Forms, dialogs, tables, badges, and route states

Reuse installed primitives:

- `src/components/ui/input.tsx:6-17` and `label.tsx:7-17` for visible labels and native file/email inputs.
- `src/components/ui/table.tsx:7-19,68-91` for semantic tables plus horizontal overflow.
- `src/components/ui/badge.tsx:7-29` for text-bearing status variants.
- `src/components/ui/card.tsx:5-20,72-92` for empty/error/status cards.
- `src/components/ui/button.tsx:6-40` for primary/outline/destructive variants.

**Modal/focus analog:** `src/app/dashboard/ads/create-campaign-modal.tsx:44-83,152-184`

```tsx
<div
  role="dialog"
  aria-modal="true"
  aria-labelledby="dialog-title"
  onKeyDown={onKeyDown}
>
```

Copy initial focus, Escape handling, tab containment via `src/lib/ads/focus-trap.ts:3-18`, and opener focus restoration. Keep comment text on recoverable failures and disable duplicate saves/submits.

**Loading/error analogs:** `src/app/dashboard/analytics/loading.tsx:3-27` reserves final dimensions and supplies a real status; `error.tsx:7-39` keeps the shell and provides a recoverable Try again action. Create route-level `loading.tsx`/`error.tsx` or small shared components using those patterns.

### Viewer and accessibility rules

The viewer/page/pin/toolbar components are new. Required implementation patterns:

- Native `<button>` pins positioned by percentages inside `position: relative` page wrappers.
- A 28px visible pin inside a 44px hit target.
- Stable pin/comment IDs, accessible names containing comment/page/text, and `aria-describedby` relationships.
- Explicit placement mode; incidental page clicks do nothing.
- Arrow/Shift+Arrow/Enter/Escape keyboard placement.
- Focus-moving bidirectional “Go to pin” / “Back to comment” controls.
- Plain extracted text associated with each inert page image; scanned pages explicitly identified as having no extracted text.
- Lazy page images with reserved aspect ratio; one failed page does not blank the viewer.
- Immediate/reduced-motion scroll when the user prefers reduced motion.

Existing primitives require deliberate overrides:

- `Button` defaults to 32px (`button.tsx:23-35`), so viewer actions need `min-h-11 min-w-11`.
- `TableCell` defaults to `whitespace-nowrap` (`table.tsx:81-89`), so filenames/emails/comments need `whitespace-normal break-words`.
- Analytics skeletons use unqualified `animate-pulse` (`loading.tsx:5-23`); add `motion-reduce:animate-none`.
- Do not copy the clickable `TableRow tabIndex=0` from `campaigns-table.tsx:59-70`; use explicit named links/buttons in the action column.

### Vitest, local Supabase, Playwright, and axe

**Vitest:** `vitest.config.ts:4-16` supplies `@` alias, node environment, and `__tests__` discovery. Follow the existing injected-dependency tests:

- Storage mock factory: `src/lib/report/__tests__/storage.test.ts:21-34`.
- Authorization denies before object access: `src/lib/report/__tests__/download.test.ts:42-55`.
- Converter transport retry/failure seam: `src/lib/report/__tests__/render-client.test.ts:28-78`.
- Mail retry/circuit behavior: `src/lib/mail/__tests__/sendgrid.test.ts:42-155`.
- Pure branch matrices: `src/lib/ads/__tests__/view-state.test.ts:8-97`.

Add Phase 19 executable files to `vitest.config.ts` coverage intentionally. DOM geometry, focus, resize, fragment exchange, and real modal behavior belong in Playwright because the current Vitest environment is `node`.

**Playwright:** `playwright.config.ts:22-62` forces local environment, one worker, setup dependency, production build, and no existing-server reuse. Extend `e2e/global.setup.ts` with deterministic local-only admin/auth-reviewer/guest-review fixtures; retain its `localhost` refusal guard (`global.setup.ts:19-29`).

**Axe:** reuse `e2e/_helpers.ts:10-41`.

```ts
const results = await new AxeBuilder({ page })
  .withTags(["wcag2a", "wcag2aa"])
  .analyze();
const blocking = results.violations.filter(
  (v) => v.impact === "serious" || v.impact === "critical"
);
expect(blocking).toEqual([]);
```

`e2e/document-review.spec.ts` should cover admin list/create/detail/submission, authenticated reviewer, guest exchange/workspace/unavailable, keyboard-only placement/edit/delete/submit, pin-comment focus jumps, modal focus return, 375px and 1280px, resize with selected pin, 200% zoom, and corner-pin stability at Fit/75/100/125/150. Axe-scan every UI-SPEC state named in the acceptance contract.

## Shared Patterns

### Server authority

Apply to every route/page/data function:

1. Validate request identifiers/payload.
2. Resolve Supabase user and/or guest cookie.
3. Authorize the exact review/version/recipient and action.
4. Derive object/database keys from the authorized row.
5. Only then create a service client or external adapter.
6. Return generic safe errors; log no token, object path, parser detail, or protected content.

### Dependency injection

Apply to Storage, converter, clock/token generation, and mail claims. Production defaults bind real services; unit tests inject deterministic fakes. This is the common pattern in report storage, render client, monthly orchestration, and SendGrid.

### Immutable history

Versions and submissions are insert-only. Reopen changes recipient workflow state but never edits a prior snapshot. New version creates a new object prefix and recipient set; no anchors migrate.

### Error and partial-failure handling

- Conversion failure persists nothing.
- DB failure after object upload compensates only the newly generated version prefix.
- Invitation failure leaves the prepared version and exposes a safe resend action.
- Submission notification failure never rolls back or unlocks the submitted snapshot.
- Access revocation replaces the UI with the generic terminal state and stops returning protected content.

### Production boundary

The migration protocol is binding, but Phase 19 decision D-22 is stricter: author and verify migrations locally only. Do not create the production bucket, apply a production migration, send live invitations, or touch project data in this phase without a later operator gate.

## Patterns That Must Not Be Reused

### Trusted report renderer is not an untrusted converter

`workers/report-renderer/render.mjs:42-64` keeps one long-lived browser, launches with:

```js
args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
```

and calls:

```js
await page.goto(url, { waitUntil: "networkidle0", timeout: 60_000 });
```

That worker is correct for PSG-generated, origin-allowlisted report HTML. It is the wrong hostile-input boundary for uploaded HTML/DOCX/PDF. Do not send uploads to it, copy its browser reuse, disable the sandbox, permit navigation/subresource requests, forward privileged bearers, or expose its raw errors. Reuse only its isolated package ownership and the app-side injected adapter idea.

### Other prohibited copies

- No uploaded HTML, PDF, or DOCX in `iframe`, `object`, `embed`, browser PDF renderer, or `dangerouslySetInnerHTML`.
- No signed/public Storage URLs; revocation must take effect on the next proxied request.
- No `monthly-reports` authenticated object policy for reviewer artifacts.
- No report-style `upsert: true` for immutable document objects.
- No OAuth-style raw/signed token persistence.
- No UI-only comment lock or read-then-write submission sequence.
- No pixel coordinates, required drag gesture, generic canvas/editor/annotation dependency, OCR, realtime, or anchor migration.

## No Analog Found

| File/Concern | Reason | Planner Direction |
|---|---|---|
| `supabase/tests/document_reviews.sql` | No SQL test directory exists | Create one minimal local auth/state matrix; keep all execution local |
| `src/lib/document-review/geometry.ts` | No coordinate utility exists | Pure ratio/clamp/arrow/order functions with Vitest |
| Viewer/page/pin/toolbar components | No document viewer exists | Native image/button implementation from UI-SPEC; no library |
| Hostile file signature/structure validation | No upload validator exists | New pure envelope gate plus malicious fixture corpus |
| Deny-all conversion worker | Report renderer has a different trust model | New ephemeral Vercel Sandbox image and adapter |
| Fragment-to-cookie guest entry | No fragment exchange flow exists | Implement the locked token-removal/cookie-scoping contract directly |

## Metadata

**Search scope:** `src/app`, `src/components`, `src/lib`, `supabase/migrations`, `workers`, `e2e`, project configs, Phase 6 migration protocol
**Primary analogs:** auth/shop access, monthly reports Storage/download/claim, report render-client seam, SendGrid adapter, dashboard shell/mobile nav, installed UI primitives, analytics states, Playwright/axe harness
**Pattern extraction date:** 2026-07-28
**Concurrent work preserved:** existing ROADMAP and untracked Phase 19 files were not modified

## PATTERN MAPPING COMPLETE
