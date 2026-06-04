import "server-only";
import {
  AdapterConfigError,
  AdapterFetchError,
  type Review,
  type ReviewAdapter,
  type ReviewSource,
} from "./types";

const YELP_BASE_URL = "https://api.yelp.com/v3";

type YelpReview = {
  id: string;
  rating: number;
  text: string;
  time_created: string;
  url: string;
  user: { name: string | null };
};

type YelpReviewsResponse = {
  reviews: YelpReview[];
  total: number;
  possible_languages: string[];
};

export const yelpAdapter: ReviewAdapter = {
  platform: "yelp",

  async fetch(source: ReviewSource): Promise<Review[]> {
    const apiKey = process.env.YELP_API_KEY;
    if (!apiKey) throw new AdapterConfigError("yelp", "YELP_API_KEY");

    const url = `${YELP_BASE_URL}/businesses/${encodeURIComponent(
      source.external_account_id
    )}/reviews?limit=3&sort_by=yelp_sort`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!res.ok) {
      const body = await res.text();
      throw new AdapterFetchError("yelp", res.status, body);
    }

    const data = (await res.json()) as YelpReviewsResponse;

    return data.reviews.map((r) => ({
      platform: "yelp" as const,
      external_id: r.id,
      author: r.user?.name ?? null,
      rating: r.rating,
      body: r.text,
      posted_at: r.time_created,
      url: r.url,
      raw: r,
    }));
  },
};
