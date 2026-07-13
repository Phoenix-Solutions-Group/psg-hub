import "server-only";

export function getGoogleAdsOAuthCredentials(): {
  clientId: string;
  clientSecret: string;
} {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Server missing Google Ads OAuth client credentials");
  }

  return { clientId, clientSecret };
}
