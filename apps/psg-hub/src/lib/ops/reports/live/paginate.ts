// v1.4 / PSG-28 / PSG-354 — Framework-wide ranged-fetch for live report run()s.
//
// WHY: Supabase/PostgREST caps an unranged `select` at the project `max-rows`
// setting (default 1000). Every live report here "fetches rows then groups in
// JS", so a report whose period + shop scope spans >1000 backing rows would
// SILENTLY TRUNCATE at 1000 — under-counting ROs, dollars, surveys, claims,
// etc. with no error surfaced. That is a correctness/under-reporting bug, not
// just a perf concern. `fetchAllRows` loops `.range(offset, offset+pageSize-1)`
// until a short page, accumulating every row.
//
// USAGE — pass a thunk that builds a FRESH query each call:
//
//   const rows = await fetchAllRows<SurveyRow>(() => {
//     let q = ctx.db!.from("survey_responses").select("a, b, c");
//     if (start) q = q.gte("survey_date", start);
//     return q;
//   });
//
// The thunk MUST return a new builder every invocation: a PostgREST builder is
// single-shot (awaiting it sends the request), so the helper cannot re-`.range()`
// a builder it already consumed. Rebuilding per page also re-applies all the
// filters, which is exactly what we want.

/** PostgREST's default project `max-rows`. A page larger than this can never
 *  come back full, so the loop would stop early and silently truncate; keep the
 *  page size at (or below) the server cap. */
export const POSTGREST_PAGE_SIZE = 1000;

/** Minimal shape the helper needs: a builder exposing a range() that resolves
 *  to PostgREST's `{ data, error }`. Loosely typed so the lib stays decoupled
 *  from the Supabase client and pure unit tests can pass a stub. */
type RangeResult<T> = { data: T[] | null; error: { message: string } | null };
type Rangeable<T> = {
  range: (from: number, to: number) => PromiseLike<RangeResult<T>>;
};

/**
 * Fetch EVERY row of a PostgREST select, paginating past the project `max-rows`
 * cap. Calls `buildQuery()` once per page and ranges it; stops at the first page
 * shorter than `pageSize` (the last/short page, including an empty one). Throws
 * on the first PostgREST error, matching the per-report `if (error) throw`.
 *
 * @param buildQuery returns a fresh, fully-filtered query builder each call.
 * @param pageSize   rows per page; must be > 0 and ≤ the server `max-rows`.
 */
export async function fetchAllRows<T>(
  buildQuery: () => Rangeable<T>,
  pageSize: number = POSTGREST_PAGE_SIZE,
): Promise<T[]> {
  if (!Number.isInteger(pageSize) || pageSize <= 0) {
    throw new Error(`fetchAllRows: pageSize must be a positive integer, got ${pageSize}`);
  }

  const all: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await buildQuery().range(offset, offset + pageSize - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    all.push(...page);
    // A short (or empty) page means we've reached the end. A full page means
    // there may be more, so keep going.
    if (page.length < pageSize) break;
  }
  return all;
}
