/** Public types for the mail adapter (provider-agnostic surface). */

/** A recipient/sender — a bare address or a named address. */
export type EmailAddress = string | { name?: string; email: string };

export interface MailMessage {
  to: EmailAddress | EmailAddress[];
  /** Defaults to SENDGRID_FROM_EMAIL when omitted. */
  from?: EmailAddress;
  subject?: string;
  html?: string;
  text?: string;
  /** SendGrid dynamic template id (use instead of subject/html). */
  templateId?: string;
  dynamicTemplateData?: Record<string, unknown>;
  /**
   * Set false to disable SendGrid click tracking for this message. Transactional
   * links (e.g. the membership-gated report download) must NOT be rewritten through
   * the link-branding subdomain — that domain serves a *.sendgrid.net cert that does
   * not match the branded host, so a tracked link errors COMMON_NAME_INVALID.
   * Undefined leaves the account default untouched.
   */
  clickTracking?: boolean;
}

export interface MailResult {
  statusCode: number;
  /** SendGrid `x-message-id` header, when present. */
  messageId?: string;
}

/** Typed mail failure. `retryable` reflects whether the underlying error was transient. */
export class MailError extends Error {
  readonly statusCode?: number;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: { statusCode?: number; retryable: boolean; cause?: unknown }
  ) {
    super(message);
    this.name = "MailError";
    this.statusCode = options.statusCode;
    this.retryable = options.retryable;
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}
