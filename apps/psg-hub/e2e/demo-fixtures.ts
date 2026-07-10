import path from "node:path";

export type DemoSessionRole = "operator" | "shop";

export interface DemoSessionFixture {
  label: string;
  role: DemoSessionRole;
  emailEnvVar: string;
  passwordEnvVar: string;
  defaultPath: string;
  statePath: string;
}

export interface DemoCaptureRoute {
  session: DemoSessionRole;
  path: string;
  name: string;
}

export const DEMO_AUTH_DIR = path.join(__dirname, ".auth");
export const DEMO_SHOTS_DIR = path.join(__dirname, "screenshots", "psg-986");

export const DEMO_SESSIONS: Record<DemoSessionRole, DemoSessionFixture> = {
  operator: {
    label: "operator",
    role: "operator",
    emailEnvVar: "DEMO_OPERATOR_EMAIL",
    passwordEnvVar: "DEMO_OPERATOR_PASSWORD",
    defaultPath: "/ops",
    statePath: path.join(DEMO_AUTH_DIR, "demo-operator.json"),
  },
  shop: {
    label: "shop",
    role: "shop",
    emailEnvVar: "DEMO_SHOP_EMAIL",
    passwordEnvVar: "DEMO_SHOP_PASSWORD",
    defaultPath: "/dashboard",
    statePath: path.join(DEMO_AUTH_DIR, "demo-shop.json"),
  },
};

function normalizePath(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/")) return `/${trimmed}`;
  return trimmed;
}

function parseRouteAlias(rawPath: string): string {
  const clean = rawPath.trim().replace(/\/+/g, "/").replace(/^\//, "");
  if (!clean) return "home";
  return clean
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}

function splitRoutes(raw: string): string[] {
  return raw
    .split(/[,\n;]+/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function parseLegacyPlan(session: DemoSessionRole): DemoCaptureRoute[] {
  const envKey =
    session === "operator" ? "DEMO_CAPTURE_OPS_ROUTES" : "DEMO_CAPTURE_SHOP_ROUTES";
  const raw = process.env[envKey];
  const routes = splitRoutes(raw ?? "");

  return routes.map((rawPath, index) => ({
    session,
    path: normalizePath(rawPath),
    name: `${session}-${parseRouteAlias(rawPath)}-${index + 1}`,
  }));
}

export function getDemoSessionCredentials(role: DemoSessionRole): { email: string; password: string } {
  const session = DEMO_SESSIONS[role];
  const email = process.env[session.emailEnvVar];
  const password = process.env[session.passwordEnvVar];

  if (!email || !password) {
    throw new Error(
      `[PSG-986] Missing demo credential env vars for ${session.label}: ` +
        `${session.emailEnvVar} and ${session.passwordEnvVar}`
    );
  }

  return { email, password };
}

function assertDemoCapturePlanEntry(entry: unknown, index: number): DemoCaptureRoute {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`[PSG-986] DEMO_CAPTURE_PLAN must be an array of objects (item ${index + 1}).`);
  }

  const cast = entry as { session?: unknown; path?: unknown; name?: unknown };
  const session = String(cast.session ?? "").trim().toLowerCase();
  if (session !== "operator" && session !== "shop") {
    throw new Error(
      `[PSG-986] DEMO_CAPTURE_PLAN item ${index + 1} has invalid session "${cast.session}".`
    );
  }

  const rawPath = String(cast.path ?? "").trim();
  if (!rawPath) {
    throw new Error(`[PSG-986] DEMO_CAPTURE_PLAN item ${index + 1} is missing "path".`);
  }

  const name =
    typeof cast.name === "string" && cast.name.trim().length > 0
      ? cast.name.trim().replace(/\s+/g, "-")
      : parseRouteAlias(rawPath);

  return {
    session: session as DemoSessionRole,
    path: normalizePath(rawPath),
    name: `${session}-${name}`,
  };
}

export function getDemoCapturePlan(): DemoCaptureRoute[] {
  const explicitPlan = process.env.DEMO_CAPTURE_PLAN;
  if (explicitPlan && explicitPlan.trim().length > 0) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(explicitPlan);
    } catch (error) {
      throw new Error("[PSG-986] DEMO_CAPTURE_PLAN is not valid JSON.");
    }

    if (!Array.isArray(parsed)) {
      throw new Error("[PSG-986] DEMO_CAPTURE_PLAN must be a JSON array.");
    }

    return parsed.map((entry, index) => assertDemoCapturePlanEntry(entry, index + 1));
  }

  return [...parseLegacyPlan("operator"), ...parseLegacyPlan("shop")];
}
