export type TrapPlan = { prevent: boolean; focusIndex: number | null };

export function handleTabTrap(
  event: { key: string; shiftKey: boolean },
  focusables: { activeIndex: number; count: number }
): TrapPlan {
  if (event.key !== "Tab") return { prevent: false, focusIndex: null };
  if (focusables.count <= 0) return { prevent: false, focusIndex: null };
  if (focusables.count === 1) {
    return { prevent: true, focusIndex: 0 };
  }
  if (!event.shiftKey && focusables.activeIndex === focusables.count - 1) {
    return { prevent: true, focusIndex: 0 };
  }
  if (event.shiftKey && focusables.activeIndex === 0) {
    return { prevent: true, focusIndex: focusables.count - 1 };
  }
  return { prevent: false, focusIndex: null };
}
