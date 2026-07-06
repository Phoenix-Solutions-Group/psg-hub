// PSG-587 Move 1 — role→Pipedrive-user assignee map (env config source).
//
// Onboarding tasks are created with the accountable ROLE (AS / Ads / Analytics / Web /
// CRO) in the title. This loader turns the operator-confirmed "who fills each role"
// into a `roleUserMap` that `provisionOnboardingBoard()` uses to set each task's
// `assignee_id`, so tasks land on real people instead of being unassigned.
//
// Design (mirrors the board/phase-id "discover once, set in env" pattern already used
// by this module, and the env-config style of ../crm/pipedrive/config.ts):
//   • One env var per role, each holding that role owner's Pipedrive USER ID.
//   • A role is mapped ONLY when its var is present AND parses to a positive integer.
//     Every other role is omitted, so its tasks stay UNASSIGNED (role in the title).
//   • NEVER throws: a missing or malformed value is simply skipped. This is a hard
//     requirement (PSG-587) — partial rollout (map only the roles PSG has confirmed)
//     must work, and a bad env value must never break deal-won provisioning.
//
// Discovering the numeric user IDs (the "PSG team records" step): call the Projects
// client's `listUsers()` once — it returns each Pipedrive user's id/name/email so the
// operator can match a role owner to their id — then set the vars below in Vercel.

import type { OnboardingRole } from "./onboarding-template";

/** Read-only env source. `process.env` satisfies this structurally. */
export type RoleUserEnv = Record<string, string | undefined>;

/** Canonical per-role env var names. Each holds that role's Pipedrive user id. */
export const ROLE_USER_ENV: Record<OnboardingRole, string> = {
  AS: "PIPEDRIVE_ROLE_USER_AS",
  Ads: "PIPEDRIVE_ROLE_USER_ADS",
  Analytics: "PIPEDRIVE_ROLE_USER_ANALYTICS",
  Web: "PIPEDRIVE_ROLE_USER_WEB",
  CRO: "PIPEDRIVE_ROLE_USER_CRO",
};

/**
 * Build the role→Pipedrive-user-id map from the environment. Pure (env injectable for
 * tests). A role appears in the result only when its env var holds a positive integer;
 * missing/blank/malformed values are skipped so those roles stay unassigned. Never
 * throws — safe to call unconditionally on every deal-won provision.
 */
export function loadRoleUserMap(
  env: RoleUserEnv = process.env,
): Partial<Record<OnboardingRole, number>> {
  const map: Partial<Record<OnboardingRole, number>> = {};
  for (const [role, name] of Object.entries(ROLE_USER_ENV) as [
    OnboardingRole,
    string,
  ][]) {
    const raw = env[name];
    if (typeof raw !== "string" || raw.trim() === "") continue;
    const id = Number(raw.trim());
    // Only a real, positive integer user id counts; anything else → leave unmapped.
    if (!Number.isInteger(id) || id <= 0) continue;
    map[role] = id;
  }
  return map;
}
