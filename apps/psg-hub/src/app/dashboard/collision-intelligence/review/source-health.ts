export function isMissingReviewView(
  error: { code?: string | null; message?: string | null } | null,
  view: string,
): boolean {
  return (
    error?.code === "PGRST205" &&
    Boolean(error.message?.includes(`'public.${view}'`))
  );
}

export function isForecastArrivalFresh(
  latestArrivalDate: string | null,
  today = new Date(),
): boolean {
  if (!latestArrivalDate) return false;
  const cutoff = new Date(today);
  cutoff.setUTCDate(cutoff.getUTCDate() - 14);
  return latestArrivalDate >= cutoff.toISOString().slice(0, 10);
}
