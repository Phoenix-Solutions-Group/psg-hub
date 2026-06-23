import { describe, it, expect } from "vitest";
import {
  DEFAULT_SEED_ADDRESS,
  LiveLobKeyError,
  SEED_FROM_ADDRESS,
  assertLobTestMode,
  isLobTestKey,
} from "../seed-test";

describe("isLobTestKey", () => {
  it("is true only for test_ keys", () => {
    expect(isLobTestKey("test_abc123")).toBe(true);
    expect(isLobTestKey("live_abc123")).toBe(false);
    expect(isLobTestKey(undefined)).toBe(false);
    expect(isLobTestKey(null)).toBe(false);
    expect(isLobTestKey("")).toBe(false);
  });
});

describe("assertLobTestMode", () => {
  it("passes for a test key", () => {
    expect(() => assertLobTestMode("test_xyz")).not.toThrow();
  });

  it("refuses a live key (G4 safety)", () => {
    expect(() => assertLobTestMode("live_xyz")).toThrow(LiveLobKeyError);
  });

  it("refuses a missing key (never falls open)", () => {
    expect(() => assertLobTestMode(undefined)).toThrow(LiveLobKeyError);
  });
});

describe("seed addresses", () => {
  it("are well-formed MailAddresses", () => {
    for (const addr of [DEFAULT_SEED_ADDRESS, SEED_FROM_ADDRESS]) {
      expect(addr.name).toBeTruthy();
      expect(addr.addressLine1).toBeTruthy();
      expect(addr.state).toHaveLength(2);
      expect(addr.zip.length).toBeGreaterThanOrEqual(5);
    }
  });
});
