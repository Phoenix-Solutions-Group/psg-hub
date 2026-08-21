const UNSUBSCRIBE_URL = /https?:\/\/[^\s<>"']+\/api\/unsubscribe\?token=[^\s<>"']+/gi;

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function sanitizedMessage(value: unknown): string | null {
  return text(value)?.replace(UNSUBSCRIBE_URL, "[unsubscribe link included]") ?? null;
}

/** Allow only customer-visible preview fields across the server/client boundary. */
export function customerApprovalPreviewPayload(
  actionType: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  if (actionType === "gbp_post") {
    const callToAction = record(payload.callToAction);
    return {
      ...(text(payload.summary) ? { summary: text(payload.summary) } : {}),
      ...(callToAction
        ? {
            callToAction: {
              ...(text(callToAction.actionType)
                ? { actionType: text(callToAction.actionType) }
                : {}),
              ...(text(callToAction.url) ? { url: text(callToAction.url) } : {}),
            },
          }
        : {}),
    };
  }

  if (actionType === "review_solicitation") {
    const draft = record(payload.draft);
    const email = record(draft?.email);
    const sms = record(draft?.sms);
    return {
      draft: {
        ...(email
          ? {
              email: {
                ...(text(email.subject) ? { subject: text(email.subject) } : {}),
                ...(sanitizedMessage(email.text)
                  ? { text: sanitizedMessage(email.text) }
                  : {}),
              },
            }
          : {}),
        ...(sms && text(sms.body) ? { sms: { body: text(sms.body) } } : {}),
      },
    };
  }

  return {};
}
