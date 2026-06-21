/**
 * Smart onboarding auto-discovery service (PSG-144).
 *
 * `discoverShopProfile(name+address)` → an EnrichedShopProfile of suggested
 * fields that pre-fill the onboarding wizard. The active provider is chosen by
 * the ONBOARDING_DISCOVERY_PROVIDER env var; it defaults to the offline
 * heuristic provider so the flow works with no paid API keys.
 *
 * Adding a paid provider (Google Places / SEMrush / Yext competitor source)
 * is a single entry in `PROVIDERS` once the board approves the spend (PSG-142).
 * If a provider is selected but unavailable (missing key), we fall back to the
 * heuristic provider rather than failing onboarding.
 */

import { heuristicProvider } from "./heuristic-provider";
import { googlePlacesProvider } from "./google-places-provider";
import type {
  DiscoveryInput,
  DiscoveryProvider,
  EnrichedShopProfile,
} from "./types";

export * from "./types";
export { heuristicProvider } from "./heuristic-provider";
export {
  googlePlacesProvider,
  createGooglePlacesProvider,
  createTtlCache,
} from "./google-places-provider";
export type {
  GooglePlacesProviderDeps,
  CompetitorSource,
  GeoPoint,
  ProfileCache,
  FetchLike,
} from "./google-places-provider";
export {
  normalizePhone,
  normalizeState,
  inferWebsiteCandidate,
  slugify,
  cleanText,
} from "./normalize";

/**
 * Registry of available providers, keyed by ONBOARDING_DISCOVERY_PROVIDER.
 * `google_places` is registered but reports `isConfigured() === false` until the
 * board-gated GOOGLE_PLACES_API_KEY is provisioned (PSG-149 / PSG-142); until
 * then `selectProvider` transparently degrades it to the heuristic provider.
 */
const PROVIDERS: Record<string, DiscoveryProvider> = {
  heuristic: heuristicProvider,
  google_places: googlePlacesProvider,
};

export function selectProvider(
  name: string | undefined = process.env.ONBOARDING_DISCOVERY_PROVIDER
): DiscoveryProvider {
  if (!name) return heuristicProvider;
  const provider = PROVIDERS[name];
  if (!provider) return heuristicProvider;
  // A selected provider that needs credentials it doesn't have degrades to the
  // offline heuristic provider rather than failing onboarding.
  if (provider.isConfigured && !provider.isConfigured()) {
    return heuristicProvider;
  }
  return provider;
}

/**
 * Discover an enriched shop profile from a name (+ optional address).
 * Throws on an empty shop name; otherwise always resolves a profile (the
 * provider degrades gracefully rather than throwing on missing enrichment).
 */
export async function discoverShopProfile(
  input: DiscoveryInput,
  provider: DiscoveryProvider = selectProvider()
): Promise<EnrichedShopProfile> {
  const shopName = input.shopName.trim();
  if (!shopName) {
    throw new Error("shopName required for discovery");
  }
  return provider.discover({ ...input, shopName });
}
