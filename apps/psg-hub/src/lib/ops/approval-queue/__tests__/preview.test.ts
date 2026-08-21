import { describe, expect, it } from "vitest";
import { customerApprovalPreviewPayload } from "@/lib/ops/approval-queue/preview";

describe("customerApprovalPreviewPayload", () => {
  it("keeps exact solicitation copy without exposing contact data or unsubscribe tokens", () => {
    const preview = customerApprovalPreviewPayload("review_solicitation", {
      recipient: { email: "customer@example.com", phone: "+15555550123" },
      consent: { sms: true, email: true },
      draft: {
        email: {
          subject: "How did we do?",
          text: "Thanks for choosing us. https://hub.test/api/unsubscribe?token=secret-token",
          html: "<p>not sent to the browser</p>",
        },
        sms: { body: "Would you leave us a review?" },
      },
    });

    expect(preview).toEqual({
      draft: {
        email: {
          subject: "How did we do?",
          text: "Thanks for choosing us. [unsubscribe link included]",
        },
        sms: { body: "Would you leave us a review?" },
      },
    });
    expect(JSON.stringify(preview)).not.toContain("customer@example.com");
    expect(JSON.stringify(preview)).not.toContain("secret-token");
  });

  it("allows only the fields needed to preview a Google post", () => {
    expect(
      customerApprovalPreviewPayload("gbp_post", {
        summary: "We are open Saturday.",
        languageCode: "en-US",
        callToAction: { actionType: "CALL" },
        internalNote: "do not expose",
      }),
    ).toEqual({
      summary: "We are open Saturday.",
      callToAction: { actionType: "CALL" },
    });
  });
});
