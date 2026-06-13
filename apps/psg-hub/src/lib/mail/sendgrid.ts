import "server-only";
import sgMail, { type MailDataRequired } from "@sendgrid/mail";
import {
  CircuitBreaker,
  CircuitOpenError,
  withRetry,
  type RetryOptions,
} from "@/lib/resilience";
import { MailError, type MailMessage, type MailResult } from "./types";

/**
 * SendGrid mail adapter — mirrors the lazy-singleton client pattern in
 * src/lib/stripe.ts and wraps every send in the shared circuit breaker + retry
 * (PROJECT.md: retry + circuit breaker on every external call, no bare catches).
 */

let configured = false;

function getMailClient(): typeof sgMail {
  if (!configured) {
    const apiKey = process.env.SENDGRID_API_KEY;
    if (!apiKey) {
      throw new Error("Missing SENDGRID_API_KEY");
    }
    sgMail.setApiKey(apiKey);
    configured = true;
  }
  return sgMail;
}

/** Extract a numeric HTTP status from a SendGrid ResponseError (`.code`), if present. */
function statusOf(error: unknown): number | undefined {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "number") {
      return code;
    }
  }
  return undefined;
}

/** Transient = 429 or 5xx, or an unknown/network error with no numeric status. */
export function isRetryableMailError(error: unknown): boolean {
  const status = statusOf(error);
  if (status === undefined) {
    return true;
  }
  return status === 429 || status >= 500;
}

function headerValue(headers: unknown, name: string): string | undefined {
  if (headers && typeof headers === "object") {
    const value = (headers as Record<string, unknown>)[name];
    if (typeof value === "string") {
      return value;
    }
  }
  return undefined;
}

function buildPayload(
  message: MailMessage,
  from: NonNullable<MailMessage["from"]>
): MailDataRequired {
  // MailDataRequired is a strict union (content xor template); we construct the
  // shape dynamically and assert it — SendGrid validates the combination itself.
  return {
    to: message.to,
    from,
    subject: message.subject,
    html: message.html,
    text: message.text,
    templateId: message.templateId,
    dynamicTemplateData: message.dynamicTemplateData,
    // Per-message click-tracking override. Only emitted when explicitly disabled,
    // so account-default behavior is untouched for every other send.
    ...(message.clickTracking === false
      ? { trackingSettings: { clickTracking: { enable: false, enableText: false } } }
      : {}),
  } as unknown as MailDataRequired;
}

export interface MailSenderOptions {
  /** Override the circuit breaker (tests inject a fast-tripping one). */
  breaker?: CircuitBreaker;
  /** Override retry behaviour (tests inject no-op sleep / zero retries). */
  retry?: RetryOptions;
}

export interface MailSender {
  send(message: MailMessage): Promise<MailResult>;
}

/**
 * Build a mail sender with a given breaker + retry policy. The default instance
 * (`sendEmail`) uses production defaults; tests build their own with fast seams.
 */
export function createMailSender(options: MailSenderOptions = {}): MailSender {
  const breaker =
    options.breaker ??
    new CircuitBreaker({
      failureThreshold: 5,
      resetTimeoutMs: 30_000,
      // Only transient failures should trip the breaker — a permanent 4xx is a
      // caller bug, not a provider outage.
      isFailure: isRetryableMailError,
    });

  const retry: RetryOptions = {
    retries: 3,
    baseDelayMs: 200,
    maxDelayMs: 5000,
    isRetryable: isRetryableMailError,
    ...options.retry,
  };

  async function send(message: MailMessage): Promise<MailResult> {
    const from = message.from ?? process.env.SENDGRID_FROM_EMAIL;
    if (!from) {
      throw new MailError("Missing from address (set SENDGRID_FROM_EMAIL)", {
        retryable: false,
      });
    }

    const client = getMailClient();
    const payload = buildPayload(message, from);

    try {
      const [response] = await breaker.execute(() =>
        withRetry(() => client.send(payload), retry)
      );
      return {
        statusCode: response.statusCode,
        messageId: headerValue(response.headers, "x-message-id"),
      };
    } catch (error) {
      if (error instanceof CircuitOpenError) {
        throw new MailError("Mail service circuit open — sending paused", {
          retryable: true,
          cause: error,
        });
      }
      if (error instanceof MailError) {
        throw error;
      }
      const status = statusOf(error);
      throw new MailError(
        `SendGrid send failed${status !== undefined ? ` (status ${status})` : ""}`,
        { statusCode: status, retryable: isRetryableMailError(error), cause: error }
      );
    }
  }

  return { send };
}

const defaultSender = createMailSender();

/** Send a transactional email via SendGrid (resilient: retry + circuit breaker). */
export function sendEmail(message: MailMessage): Promise<MailResult> {
  return defaultSender.send(message);
}
