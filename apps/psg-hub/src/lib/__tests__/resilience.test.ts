import { describe, it, expect, vi } from "vitest";
import { withRetry, CircuitBreaker, CircuitOpenError } from "@/lib/resilience";

const noSleep = () => Promise.resolve();
const noJitter = () => 0;

describe("withRetry", () => {
  it("returns on first success without sleeping", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const sleep = vi.fn(noSleep);
    await expect(withRetry(fn, { sleep, jitter: noJitter })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries retryable failures then succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("a"))
      .mockRejectedValueOnce(new Error("b"))
      .mockResolvedValue("ok");
    const sleep = vi.fn(noSleep);
    await expect(
      withRetry(fn, { retries: 3, sleep, jitter: noJitter })
    ).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("does not retry when isRetryable returns false", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("permanent"));
    const sleep = vi.fn(noSleep);
    await expect(
      withRetry(fn, { isRetryable: () => false, sleep })
    ).rejects.toThrow("permanent");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("throws the last error after exhausting retries", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("still failing"));
    await expect(
      withRetry(fn, { retries: 2, sleep: noSleep, jitter: noJitter })
    ).rejects.toThrow("still failing");
    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it("uses bounded exponential backoff (jitter=0 → 100,200,400)", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("x"));
    const delays: number[] = [];
    const sleep = (ms: number) => {
      delays.push(ms);
      return Promise.resolve();
    };
    await expect(
      withRetry(fn, {
        retries: 3,
        baseDelayMs: 200,
        maxDelayMs: 5000,
        sleep,
        jitter: noJitter,
      })
    ).rejects.toThrow();
    expect(delays).toEqual([100, 200, 400]);
  });

  it("caps each backoff at maxDelayMs", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("x"));
    const delays: number[] = [];
    const sleep = (ms: number) => {
      delays.push(ms);
      return Promise.resolve();
    };
    await expect(
      withRetry(fn, {
        retries: 5,
        baseDelayMs: 1000,
        maxDelayMs: 1500,
        sleep,
        jitter: noJitter,
      })
    ).rejects.toThrow();
    for (const d of delays) {
      expect(d).toBeLessThanOrEqual(750); // maxDelayMs/2 with jitter 0
    }
  });
});

describe("CircuitBreaker", () => {
  it("opens after threshold consecutive failures and fails fast", async () => {
    const cb = new CircuitBreaker({
      failureThreshold: 2,
      resetTimeoutMs: 1000,
      now: () => 0,
    });
    const boom = () => Promise.reject(new Error("boom"));
    await expect(cb.execute(boom)).rejects.toThrow("boom");
    expect(cb.getState()).toBe("closed");
    await expect(cb.execute(boom)).rejects.toThrow("boom");
    expect(cb.getState()).toBe("open");

    const fn = vi.fn(boom);
    await expect(cb.execute(fn)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(fn).not.toHaveBeenCalled();
  });

  it("transitions to half-open after resetTimeoutMs and closes on success", async () => {
    let t = 0;
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 1000,
      now: () => t,
    });
    await expect(
      cb.execute(() => Promise.reject(new Error("x")))
    ).rejects.toThrow();
    expect(cb.getState()).toBe("open");
    t = 1000;
    expect(cb.getState()).toBe("half-open");
    await expect(cb.execute(() => Promise.resolve("ok"))).resolves.toBe("ok");
    expect(cb.getState()).toBe("closed");
  });

  it("re-opens on a half-open failure", async () => {
    let t = 0;
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 1000,
      now: () => t,
    });
    await expect(
      cb.execute(() => Promise.reject(new Error("x")))
    ).rejects.toThrow();
    t = 1000;
    expect(cb.getState()).toBe("half-open");
    await expect(
      cb.execute(() => Promise.reject(new Error("y")))
    ).rejects.toThrow("y");
    expect(cb.getState()).toBe("open");
  });

  it("resets the failure count on success", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, now: () => 0 });
    await expect(
      cb.execute(() => Promise.reject(new Error("x")))
    ).rejects.toThrow();
    await expect(cb.execute(() => Promise.resolve("ok"))).resolves.toBe("ok");
    await expect(
      cb.execute(() => Promise.reject(new Error("x")))
    ).rejects.toThrow();
    expect(cb.getState()).toBe("closed");
  });

  it("only counts failures matching isFailure", async () => {
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      isFailure: (e) => (e as Error).message === "count",
      now: () => 0,
    });
    await expect(
      cb.execute(() => Promise.reject(new Error("ignore")))
    ).rejects.toThrow();
    expect(cb.getState()).toBe("closed");
    await expect(
      cb.execute(() => Promise.reject(new Error("count")))
    ).rejects.toThrow();
    expect(cb.getState()).toBe("open");
  });

  it("reset() returns the breaker to closed", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, now: () => 0 });
    await expect(
      cb.execute(() => Promise.reject(new Error("x")))
    ).rejects.toThrow();
    expect(cb.getState()).toBe("open");
    cb.reset();
    expect(cb.getState()).toBe("closed");
  });
});
