/**
 * Shared resilience primitives for external-service calls.
 *
 * PROJECT.md mandate: retry + circuit breaker on every external call, no bare
 * catches. Pure (no I/O) so it is unit-testable with injected clock/sleep/jitter.
 * First consumer: the SendGrid mail adapter (03-01). Reused by Twilio (03-02).
 */

export class CircuitOpenError extends Error {
  constructor(message = "Circuit breaker is open") {
    super(message);
    this.name = "CircuitOpenError";
  }
}

export interface RetryOptions {
  /** Max retry attempts AFTER the first try. Default 3 (so up to 4 calls). */
  retries?: number;
  /** Base backoff in ms. Default 200. */
  baseDelayMs?: number;
  /** Upper bound for a single backoff delay in ms. Default 5000. */
  maxDelayMs?: number;
  /** Returns true if the error is worth retrying. Default: always retry. */
  isRetryable?: (error: unknown) => boolean;
  /** Called before each retry sleep (1-based attempt). */
  onRetry?: (error: unknown, attempt: number) => void;
  /** Injectable sleep — default setTimeout. Tests pass a no-op. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable jitter in [0,1) — default Math.random. Tests pass a constant. */
  jitter?: () => number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn`, retrying transient failures with exponential backoff + jitter.
 * Rethrows immediately on non-retryable errors and after retries are exhausted.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const retries = options.retries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 200;
  const maxDelayMs = options.maxDelayMs ?? 5000;
  const isRetryable = options.isRetryable ?? (() => true);
  const sleep = options.sleep ?? defaultSleep;
  const jitter = options.jitter ?? Math.random;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === retries || !isRetryable(error)) {
        throw error;
      }
      // Exponential backoff capped at maxDelayMs, with [50%,100%] jitter.
      const expo = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
      const delay = expo / 2 + jitter() * (expo / 2);
      options.onRetry?.(error, attempt + 1);
      await sleep(delay);
    }
  }
  // Unreachable (loop either returns or throws) — satisfies the type checker.
  throw lastError;
}

export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  /** Consecutive failures before the circuit opens. Default 5. */
  failureThreshold?: number;
  /** How long the circuit stays open before a half-open trial (ms). Default 30000. */
  resetTimeoutMs?: number;
  /** Injectable clock — default Date.now. Tests advance it manually. */
  now?: () => number;
  /** Which errors count as failures. Default: every error counts. */
  isFailure?: (error: unknown) => boolean;
}

/**
 * Minimal circuit breaker. Opens after `failureThreshold` consecutive failures,
 * fails fast (throws CircuitOpenError) while open, then allows a single
 * half-open trial after `resetTimeoutMs`. A half-open success closes it; a
 * half-open failure re-opens it.
 */
export class CircuitBreaker {
  private failures = 0;
  private state: CircuitState = "closed";
  private openedAt = 0;
  private readonly threshold: number;
  private readonly resetMs: number;
  private readonly now: () => number;
  private readonly isFailure: (error: unknown) => boolean;

  constructor(options: CircuitBreakerOptions = {}) {
    this.threshold = options.failureThreshold ?? 5;
    this.resetMs = options.resetTimeoutMs ?? 30_000;
    this.now = options.now ?? Date.now;
    this.isFailure = options.isFailure ?? (() => true);
  }

  /** Current state, transitioning open → half-open once the reset window passes. */
  getState(): CircuitState {
    if (this.state === "open" && this.now() - this.openedAt >= this.resetMs) {
      this.state = "half-open";
    }
    return this.state;
  }

  /** Run `fn` under the breaker. Throws CircuitOpenError without calling `fn` while open. */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.getState() === "open") {
      throw new CircuitOpenError();
    }
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      if (this.isFailure(error)) {
        this.onFailure();
      }
      throw error;
    }
  }

  /** Reset to a clean closed state (used between tests). */
  reset(): void {
    this.failures = 0;
    this.state = "closed";
    this.openedAt = 0;
  }

  private onSuccess(): void {
    this.failures = 0;
    this.state = "closed";
  }

  private onFailure(): void {
    this.failures += 1;
    if (this.failures >= this.threshold) {
      this.state = "open";
      this.openedAt = this.now();
    }
  }
}
