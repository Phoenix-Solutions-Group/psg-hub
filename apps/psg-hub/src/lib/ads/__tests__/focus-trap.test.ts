import { describe, it, expect } from "vitest";
import { handleTabTrap } from "@/lib/ads/focus-trap";

describe("handleTabTrap", () => {
  it("non-Tab key → no-op", () => {
    expect(
      handleTabTrap({ key: "Enter", shiftKey: false }, { activeIndex: 0, count: 3 })
    ).toEqual({ prevent: false, focusIndex: null });
  });
  it("Tab at last → wraps to 0", () => {
    expect(
      handleTabTrap({ key: "Tab", shiftKey: false }, { activeIndex: 2, count: 3 })
    ).toEqual({ prevent: true, focusIndex: 0 });
  });
  it("Shift+Tab at 0 → wraps to last", () => {
    expect(
      handleTabTrap({ key: "Tab", shiftKey: true }, { activeIndex: 0, count: 3 })
    ).toEqual({ prevent: true, focusIndex: 2 });
  });
  it("Tab in middle → no-op (browser default)", () => {
    expect(
      handleTabTrap({ key: "Tab", shiftKey: false }, { activeIndex: 1, count: 3 })
    ).toEqual({ prevent: false, focusIndex: null });
  });
  it("count=1 → always wraps to 0", () => {
    expect(
      handleTabTrap({ key: "Tab", shiftKey: false }, { activeIndex: 0, count: 1 })
    ).toEqual({ prevent: true, focusIndex: 0 });
  });
  it("count=0 → no-op", () => {
    expect(
      handleTabTrap({ key: "Tab", shiftKey: false }, { activeIndex: 0, count: 0 })
    ).toEqual({ prevent: false, focusIndex: null });
  });
});
