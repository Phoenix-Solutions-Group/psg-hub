export type InsurerNameOption = { label: string; value: string };

export function includeFocusedAlias<
  T extends { source_label_normalized: string },
>(candidates: T[], focused: T | null) {
  if (
    !focused ||
    candidates.some(
      (candidate) =>
        candidate.source_label_normalized === focused.source_label_normalized,
    )
  )
    return candidates;

  return [focused, ...candidates];
}

function searchKey(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
}

export function findInsurerNameMatches(
  options: InsurerNameOption[],
  query: string,
  limit = 8,
) {
  const needle = searchKey(query);
  if (!needle) return [];

  return options
    .filter(({ label }) => {
      const candidate = searchKey(label);
      return candidate.includes(needle) || needle.includes(candidate);
    })
    .sort((left, right) => {
      const leftKey = searchKey(left.label);
      const rightKey = searchKey(right.label);
      return (
        Number(rightKey === needle) - Number(leftKey === needle) ||
        Number(rightKey.startsWith(needle)) -
          Number(leftKey.startsWith(needle)) ||
        left.label.localeCompare(right.label)
      );
    })
    .slice(0, limit);
}
