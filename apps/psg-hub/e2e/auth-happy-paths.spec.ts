import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { PASSWORD } from "./fixtures";

/**
 * BSM B1 sign-up & login happy-paths — live/E2E against the LOCAL Supabase stack
 * (PSG-791, closing out the PSG-766 fix). This is the last verification gate: it
 * actually SUBMITS the forms against a working auth backend and follows the real
 * e-mail links captured by the local test inbox (Inbucket), which unit tests and
 * the code-level open-redirect checks (already green on PSG-782) cannot do.
 *
 * Driven in BOTH e-mail-confirmation modes by the CI matrix. The workflow toggles
 * `enable_confirmations` in supabase/config.toml before `supabase start` and sets
 * E2E_CONFIRM_MODE so each test asserts the branch it belongs to:
 *   - "on"  → sign-up returns NO session → "check your email" screen + link flow
 *   - "off" → sign-up returns a session  → straight into onboarding
 *
 * Flows (from the ticket):
 *   A) confirm ON  — check-email screen → confirmation link → signed in (no /login bounce)
 *   B) confirm OFF — straight into onboarding (no check-email, no /login bounce)
 *   C) forgot/reset — link → /reset-password → new password → signed in (+ non-enumeration)
 *   D) live error copy — wrong password + already-registered e-mail → plain sentences
 */

const CONFIRM = (process.env.E2E_CONFIRM_MODE || "off").toLowerCase(); // "on" | "off"
const RUN = process.env.GITHUB_RUN_ID || String(Date.now());
// Supabase local's bundled mail catcher. Recent CLIs serve Mailpit here (the
// [inbucket] config key is legacy); we target the Mailpit API and fall back to
// the old Inbucket API for older stacks.
const MAILPIT = process.env.MAILPIT_URL || process.env.INBUCKET_URL || "http://127.0.0.1:54354";

// A confirmed account seeded via the service role — used by the error-copy checks
// (D) that need a pre-existing account regardless of the confirmation mode.
const SEEDED_EMAIL = `dupe-${RUN}@e2e-auth.test`;

test.beforeAll(async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("[e2e] Missing local Supabase env (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).");
  }
  const admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await admin.auth.admin.createUser({
    email: SEEDED_EMAIL,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error && !/already.*(registered|exists)/i.test(error.message)) {
    throw new Error(`[e2e] seed createUser failed: ${error.message}`);
  }
});

/**
 * Poll the local mail catcher for the newest message addressed to `address` and
 * return the first actionable auth link (GoTrue verify → our /auth/callback).
 * Tries the Mailpit API first (current Supabase local), then the legacy Inbucket
 * API, so this works regardless of which mailer the CLI bundles.
 */
async function latestEmailLink(address: string): Promise<string> {
  const deadline = Date.now() + 25_000;
  let lastErr = "no messages";
  while (Date.now() < deadline) {
    try {
      const link = (await mailpitLink(address)) ?? (await inbucketLink(address));
      if (link) return link;
    } catch (e) {
      lastErr = String(e);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`[e2e] No auth e-mail link for "${address}" within timeout — ${lastErr}`);
}

/** Mailpit: list messages, filter by recipient, newest first, extract the link. */
async function mailpitLink(address: string): Promise<string | null> {
  const listRes = await fetch(`${MAILPIT}/api/v1/messages?limit=200`);
  if (!listRes.ok) return null; // not Mailpit (or no messages endpoint) — caller falls back
  const data = (await listRes.json()) as {
    messages?: Array<{ ID: string; Created?: string; To?: Array<{ Address?: string }> }>;
  };
  const mine = (data.messages ?? [])
    .filter((m) =>
      (m.To ?? []).some((t) => (t.Address ?? "").toLowerCase() === address.toLowerCase())
    )
    .sort((a, b) => String(b.Created ?? "").localeCompare(String(a.Created ?? "")));
  for (const m of mine) {
    const mres = await fetch(`${MAILPIT}/api/v1/message/${m.ID}`);
    if (!mres.ok) continue;
    const msg = (await mres.json()) as { HTML?: string; Text?: string };
    const link = extractActionLink(msg.HTML ?? "") ?? extractActionLink(msg.Text ?? "");
    if (link) return link;
  }
  return null;
}

/** Legacy Inbucket fallback: mailbox = local part of the address. */
async function inbucketLink(address: string): Promise<string | null> {
  const mailbox = address.split("@")[0];
  const listRes = await fetch(`${MAILPIT}/api/v1/mailbox/${encodeURIComponent(mailbox)}`);
  if (!listRes.ok) return null;
  const msgs = (await listRes.json()) as Array<{ id: string; date?: string }>;
  const sorted = [...msgs].sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
  for (const m of sorted) {
    const mres = await fetch(`${MAILPIT}/api/v1/mailbox/${encodeURIComponent(mailbox)}/${m.id}`);
    if (!mres.ok) continue;
    const msg = (await mres.json()) as { body?: { text?: string; html?: string } };
    const link =
      extractActionLink(msg.body?.html ?? "") ?? extractActionLink(msg.body?.text ?? "");
    if (link) return link;
  }
  return null;
}

function extractActionLink(body: string): string | null {
  if (!body) return null;
  const decoded = body.replace(/&amp;/g, "&"); // keep query strings intact
  const urls = decoded.match(/https?:\/\/[^\s"'<>)]+/g) ?? [];
  return (
    urls.find((u) => u.includes("/auth/v1/verify")) ??
    urls.find((u) => u.includes("/auth/callback")) ??
    urls.find((u) => u.includes("token")) ??
    null
  );
}

// ---------------------------------------------------------------------------
// A) confirm ON — check-email screen, then confirmation link signs the owner in.
// ---------------------------------------------------------------------------
test("A: confirm ON — check-email screen, then confirmation link signs in (no login bounce)", async ({
  page,
}) => {
  test.skip(CONFIRM !== "on", "runs only in the email-confirm-ON matrix leg");
  const email = `confirm-on-${RUN}@e2e-auth.test`;

  await page.goto("/signup");
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();

  // Confirmation-pending screen — NOT a login screen, NOT the dashboard.
  await expect(
    page.getByRole("heading", { name: "Almost there — check your email" })
  ).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  expect(new URL(page.url()).pathname).not.toBe("/login");

  // Resend works and never reveals whether the address is registered.
  await page.getByRole("button", { name: "Resend email" }).click();
  await expect(page.getByText(/Sent again/i)).toBeVisible();

  // Follow the confirmation link from the local test inbox.
  const link = await latestEmailLink(email);
  await page.goto(link);

  // Routed through /auth/callback → signed in. Fresh account = no shop → the
  // onboarding screen renders AT /dashboard (never a bounce to /login).
  await page.waitForURL("**/dashboard");
  await expect(page.getByRole("heading", { name: "Welcome to your hub" })).toBeVisible();
});

// ---------------------------------------------------------------------------
// B) confirm OFF — sign-up goes straight into onboarding.
// ---------------------------------------------------------------------------
test("B: confirm OFF — sign-up goes straight into onboarding (no check-email, no login bounce)", async ({
  page,
}) => {
  test.skip(CONFIRM !== "off", "runs only in the email-confirm-OFF matrix leg");
  const email = `confirm-off-${RUN}@e2e-auth.test`;

  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();

  await page.waitForURL("**/dashboard");
  await expect(page.getByRole("heading", { name: "Welcome to your hub" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /check your email/i })).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// C) forgot / reset password — full recovery loop, then the new password works.
//    Runs in the confirm-OFF leg so the throwaway account is immediately usable.
// ---------------------------------------------------------------------------
test("C: forgot password → reset link → set new password → signed in", async ({ page }) => {
  test.skip(CONFIRM !== "off", "runs once, in the confirm-OFF leg (account must be immediately usable)");
  const email = `reset-${RUN}@e2e-auth.test`;
  const NEWPW = "e2e-New-Password-456";

  // Create + confirm a throwaway account (confirm OFF → session returned).
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/dashboard");

  // Sign out to drive recovery unauthenticated.
  await page.getByRole("button", { name: /Sign out/ }).click();
  await page.waitForURL("**/login");

  // "Forgot password?" → request a reset.
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await page.waitForURL("**/forgot-password");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

  // Recovery link → /auth/callback?next=/reset-password → set-new-password form.
  const link = await latestEmailLink(email);
  await page.goto(link);
  await page.waitForURL("**/reset-password");
  await page.getByLabel("New password", { exact: true }).fill(NEWPW);
  await page.getByLabel("Confirm new password").fill(NEWPW);
  await page.getByRole("button", { name: "Save new password" }).click();
  await page.waitForURL("**/dashboard");

  // Prove the new password actually works: sign out, sign back in with it.
  await page.getByRole("button", { name: /Sign out/ }).click();
  await page.waitForURL("**/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(NEWPW);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
});

test("C2: reset for an unknown email still says 'check your email' (no account-existence leak)", async ({
  page,
}) => {
  test.skip(CONFIRM !== "off", "runs once");
  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill(`nobody-${RUN}@e2e-auth.test`);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
});

// ---------------------------------------------------------------------------
// D) live error copy — plain, recoverable sentences (not raw Supabase strings).
// ---------------------------------------------------------------------------
test("D1: wrong password shows a plain sentence pointing at Forgot password (not 'Invalid login credentials')", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(SEEDED_EMAIL);
  await page.getByLabel("Password", { exact: true }).fill("definitely-wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByText(/don't match\. Double-check them/i)).toBeVisible();
  await expect(page.getByText(/Invalid login credentials/i)).toHaveCount(0);
});

test("D2: signing up with an already-registered email shows a plain 'account already exists' sentence", async ({
  page,
}) => {
  test.skip(CONFIRM !== "off", "GoTrue only surfaces user_already_exists when confirmations are OFF");
  await page.goto("/signup");
  await page.getByLabel("Email").fill(SEEDED_EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByText(/account with this email already exists/i)).toBeVisible();
});
