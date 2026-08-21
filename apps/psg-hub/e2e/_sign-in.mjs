/**
 * Hydration-safe sign-in for the psg-hub login form, plus honest failure
 * diagnosis.
 *
 * Why (PSG-2928): `login-form.tsx` uses controlled inputs (`value={email}`).
 * The old checks did `goto(..., { waitUntil: "domcontentloaded" })` and filled
 * immediately, so React could hydrate *after* the fill, re-render from its empty
 * initial state, and wipe both fields. The click then submitted an empty email,
 * Supabase answered 400 "missing email or phone", and the run was reported as a
 * broken demo account. It was a broken test.
 *
 * So: wait for hydration, fill, prove the values survived, and if sign-in still
 * fails say *which* failure it was.
 */

const AUTH_TOKEN_PATH = "/auth/v1/token";

/** Resolve once React has attached to the form, so a fill can't be undone by hydration. */
async function waitForHydration(page, selector, timeout) {
  await page.waitForSelector(selector, { state: "visible", timeout });
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      return Object.keys(el).some((k) => k.startsWith("__reactProps$") || k.startsWith("__reactFiber$"));
    },
    selector,
    { timeout },
  );
}

/** Fill both fields and confirm they stuck; retry if a late render cleared them. */
async function fillCredentials(page, email, password) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.waitForTimeout(150); // let any pending re-render land
    const [emailValue, passwordValue] = await Promise.all([
      page.inputValue("#email"),
      page.inputValue("#password"),
    ]);
    if (emailValue.length > 0 && passwordValue.length > 0) return { attempts: attempt };
  }
  throw new Error(
    "Login form kept clearing its inputs after fill — the page never became interactive. " +
      "This is a harness/page problem, not a credential problem.",
  );
}

/**
 * Sign in and land on the dashboard.
 *
 * Returns { ok: true, attempts } on success. On failure returns
 * { ok: false, reason, ... } where `reason` distinguishes:
 *   "form-not-interactive" — the app never hydrated; nothing was submitted
 *   "empty-submission"     — a request went out with no email (the PSG-2928 bug)
 *   "credentials-rejected" — the server refused a fully-populated request
 *   "no-redirect"          — sign-in succeeded but the app never reached /dashboard
 */
export async function signIn(page, { baseUrl, email, password, timeout = 30_000 } = {}) {
  const authCalls = [];
  const onRequest = (request) => {
    if (!request.url().includes(AUTH_TOKEN_PATH)) return;
    let emailPresent = null;
    try {
      emailPresent = Boolean(JSON.parse(request.postData() || "{}").email);
    } catch {
      /* non-JSON body — leave unknown */
    }
    authCalls.push({ emailPresent, status: null, message: null });
  };
  const onResponse = async (response) => {
    if (!response.url().includes(AUTH_TOKEN_PATH)) return;
    const call = authCalls[authCalls.length - 1];
    if (!call) return;
    call.status = response.status();
    if (response.status() >= 400) {
      try {
        const body = await response.json();
        call.message = body.error_description ?? body.msg ?? body.message ?? null;
      } catch {
        /* body unavailable */
      }
    }
  };

  page.on("request", onRequest);
  page.on("response", onResponse);

  try {
    await page.goto(`${baseUrl}/login`, { waitUntil: "load", timeout });

    try {
      await waitForHydration(page, "#email", timeout);
      await fillCredentials(page, email, password);
    } catch (error) {
      return { ok: false, reason: "form-not-interactive", detail: error.message, authCalls };
    }

    await page.getByRole("button", { name: /sign in/i }).click();

    try {
      await page.waitForURL(/\/(dashboard|ops)(?:\/|$)/, { timeout });
      return { ok: true, url: page.url(), authCalls };
    } catch {
      const lastCall = authCalls[authCalls.length - 1];
      const formError = await page.locator("p.text-destructive").first().innerText().catch(() => null);

      let reason = "no-redirect";
      if (lastCall && lastCall.emailPresent === false) reason = "empty-submission";
      else if (lastCall && lastCall.status >= 400) reason = "credentials-rejected";

      return {
        ok: false,
        reason,
        url: page.url(),
        formError,
        authCalls,
        detail:
          reason === "empty-submission"
            ? "The sign-in request carried no email — the form was submitted before it held the typed values. Harness bug, not an access problem."
            : reason === "credentials-rejected"
              ? `The server rejected fully-populated credentials: ${lastCall?.message ?? "no message"}. Check the account and the Supabase project it lives in.`
              : "Sign-in did not error but the app never navigated to /dashboard.",
      };
    }
  } finally {
    page.off("request", onRequest);
    page.off("response", onResponse);
  }
}
