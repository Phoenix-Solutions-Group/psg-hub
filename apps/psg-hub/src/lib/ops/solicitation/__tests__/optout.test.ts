import { describe, it, expect } from "vitest";
import { classifyInboundSms, currentOptOutState, isOptedOut } from "../optout";
import type { OptOutEvent } from "../types";

describe("classifyInboundSms", () => {
  it("recognizes STOP-family keywords (case/punctuation-insensitive)", () => {
    for (const body of ["STOP", "stop", " Stop. ", "UNSUBSCRIBE", "cancel", "QUIT", "End", "optout"]) {
      expect(classifyInboundSms(body)).toBe("stop");
    }
  });
  it("recognizes START-family keywords", () => {
    for (const body of ["START", "start", "Unstop", "YES"]) {
      expect(classifyInboundSms(body)).toBe("start");
    }
  });
  it("recognizes HELP-family keywords", () => {
    expect(classifyInboundSms("HELP")).toBe("help");
    expect(classifyInboundSms("info")).toBe("help");
  });
  it("does NOT opt out on a multi-word message containing 'stop'", () => {
    expect(classifyInboundSms("please don't stop texting me")).toBeNull();
    expect(classifyInboundSms("stop it")).toBeNull();
  });
  it("returns null for an ordinary reply / empty body", () => {
    expect(classifyInboundSms("thanks!")).toBeNull();
    expect(classifyInboundSms("")).toBeNull();
    expect(classifyInboundSms(null)).toBeNull();
  });
});

function ev(state: "opted_out" | "opted_in", created_at?: string): OptOutEvent {
  return {
    channel: "sms",
    contact_hash: "ph_x",
    state,
    reason: state === "opted_out" ? "sms_stop" : "sms_start",
    source: "test",
    event_ref: `${state}:${created_at ?? "n"}`,
    created_at,
  };
}

describe("currentOptOutState / isOptedOut", () => {
  it("is opted_in with no events", () => {
    expect(currentOptOutState([])).toBe("opted_in");
    expect(isOptedOut([])).toBe(false);
  });
  it("returns the latest event by timestamp", () => {
    const events = [
      ev("opted_out", "2026-06-20T00:00:00Z"),
      ev("opted_in", "2026-06-22T00:00:00Z"),
    ];
    expect(currentOptOutState(events)).toBe("opted_in");
    // A later STOP re-suppresses.
    events.push(ev("opted_out", "2026-06-23T00:00:00Z"));
    expect(isOptedOut(events)).toBe(true);
  });
  it("uses array order as a stable tiebreak when timestamps are absent", () => {
    // Newest-first insert without timestamps: last element wins (>= compare).
    expect(currentOptOutState([ev("opted_in"), ev("opted_out")])).toBe("opted_out");
  });
});
