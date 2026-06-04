import "server-only";
import { googleAdapter } from "./google";
import { yelpAdapter } from "./yelp";
import type { ReviewAdapter, ReviewPlatform } from "./types";

const adapters: Partial<Record<ReviewPlatform, ReviewAdapter>> = {
  google: googleAdapter,
  yelp: yelpAdapter,
};

export function getAdapter(platform: ReviewPlatform): ReviewAdapter {
  const adapter = adapters[platform];
  if (!adapter) throw new Error(`No adapter registered for platform: ${platform}`);
  return adapter;
}

export function hasAdapter(platform: ReviewPlatform): boolean {
  return platform in adapters;
}

export * from "./types";
