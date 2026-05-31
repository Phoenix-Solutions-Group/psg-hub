import "server-only";

export type ReviewPlatform = "google" | "yelp" | "facebook" | "carwise";

export type Review = {
  platform: ReviewPlatform;
  external_id: string;
  author: string | null;
  rating: number;
  body: string | null;
  posted_at: string | null;
  url: string | null;
  raw: unknown;
};

export type ReviewSource = {
  id: string;
  shop_id: string;
  platform: ReviewPlatform;
  external_account_id: string;
  credentials: Record<string, unknown> | null;
  active: boolean;
};

export interface ReviewAdapter {
  platform: ReviewPlatform;
  fetch(source: ReviewSource): Promise<Review[]>;
}

export class AdapterConfigError extends Error {
  constructor(platform: ReviewPlatform, missing: string) {
    super(`${platform} adapter missing required env var: ${missing}`);
    this.name = "AdapterConfigError";
  }
}

export class AdapterFetchError extends Error {
  constructor(platform: ReviewPlatform, status: number, body: string) {
    super(`${platform} fetch failed (${status}): ${body}`);
    this.name = "AdapterFetchError";
  }
}
