export function isMissingReviewView(
  error: { code?: string | null; message?: string | null } | null,
  view: string,
): boolean {
  return (
    error?.code === "PGRST205" &&
    Boolean(error.message?.includes(`'public.${view}'`))
  );
}
