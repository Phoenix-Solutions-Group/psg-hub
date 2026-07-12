export type AnalyticsReadWarning = {
  section: string;
  message: string;
};

export async function readAnalyticsSection<T>(
  section: string,
  load: () => Promise<T>,
  fallback: T,
  warnings: AnalyticsReadWarning[]
): Promise<T> {
  try {
    return await load();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    warnings.push({ section, message });
    console.error(`[analytics-page] ${section} read failed: ${message}`);
    return fallback;
  }
}
