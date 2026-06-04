/** Public types for the SMS adapter (provider-agnostic surface). */

export interface SmsMessage {
  /** Destination in E.164 (e.g. +15558675310). */
  to: string;
  /**
   * Explicit sender number (E.164). Used only when no Messaging Service is
   * available; defaults to TWILIO_PHONE_NUMBER.
   */
  from?: string;
  /**
   * Twilio Messaging Service SID (MG...). Preferred sender (sender pool +
   * failover + opt-out/compliance); defaults to TWILIO_MESSAGING_SERVICE_SID.
   */
  messagingServiceSid?: string;
  /** Message text (up to 1600 chars). */
  body: string;
  /** Per-message status callback URL (overrides the Messaging Service callback). */
  statusCallback?: string;
}

export interface SmsResult {
  /** Twilio Message SID (SM.../MM...). */
  sid: string;
  /** Message status at create time (queued | accepted | sent | ...). */
  status: string;
  /** Twilio error code when the message failed, else null. */
  errorCode?: number | null;
}

/** Typed SMS failure. `retryable` reflects whether the underlying error was transient. */
export class SmsError extends Error {
  readonly statusCode?: number;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: { statusCode?: number; retryable: boolean; cause?: unknown }
  ) {
    super(message);
    this.name = "SmsError";
    this.statusCode = options.statusCode;
    this.retryable = options.retryable;
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}
