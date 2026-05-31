export type ShopRole = "owner" | "manager" | "viewer";
export type AdsView =
  | "tier-gate"
  | "empty-link"
  | "table"
  | "upgrade-processing";

const UPGRADE_GRACE_MS = 60_000;

export function selectAdsView(input: {
  tiered: boolean;
  accountsCount: number;
  role: ShopRole;
  justReturnedFromStripe: boolean;
  elapsedMsSinceReturn: number;
}): AdsView {
  if (!input.tiered) {
    if (
      input.justReturnedFromStripe &&
      input.elapsedMsSinceReturn < UPGRADE_GRACE_MS
    ) {
      return "upgrade-processing";
    }
    return "tier-gate";
  }
  if (input.accountsCount === 0) return "empty-link";
  return "table";
}

export function canLinkAccount(role: ShopRole): boolean {
  return role === "owner";
}

export function canDisconnect(role: ShopRole): boolean {
  return role === "owner";
}
