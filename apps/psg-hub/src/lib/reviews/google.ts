import "server-only";
import {
  AdapterConfigError,
  AdapterFetchError,
  type Review,
  type ReviewAdapter,
  type ReviewSource,
} from "./types";

const PLACES_BASE_URL = "https://maps.googleapis.com/maps/api/place";

type GoogleReview = {
  author_name: string | null;
  author_url: string | null;
  rating: number;
  text: string;
  time: number;
  relative_time_description: string;
};

type PlaceDetailsResponse = {
  result?: {
    reviews?: GoogleReview[];
    url?: string;
  };
  status: string;
  error_message?: string;
};

export const googleAdapter: ReviewAdapter = {
  platform: "google",

  async fetch(source: ReviewSource): Promise<Review[]> {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey)
      throw new AdapterConfigError("google", "GOOGLE_PLACES_API_KEY");

    const params = new URLSearchParams({
      place_id: source.external_account_id,
      fields: "reviews,url",
      key: apiKey,
    });

    const res = await fetch(`${PLACES_BASE_URL}/details/json?${params}`, {
      cache: "no-store",
    });

    if (!res.ok) {
      const body = await res.text();
      throw new AdapterFetchError("google", res.status, body);
    }

    const data = (await res.json()) as PlaceDetailsResponse;

    if (data.status !== "OK") {
      throw new AdapterFetchError(
        "google",
        res.status,
        data.error_message ?? data.status
      );
    }

    const reviews = data.result?.reviews ?? [];
    const placeUrl = data.result?.url ?? null;

    return reviews.map((r) => ({
      platform: "google" as const,
      external_id: `${source.external_account_id}:${r.time}`,
      author: r.author_name,
      rating: r.rating,
      body: r.text,
      posted_at: new Date(r.time * 1000).toISOString(),
      url: placeUrl,
      raw: r,
    }));
  },
};
