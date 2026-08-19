export const RIVERSIDE_DEMO_CONTENT_ITEM_ID =
  "11111111-cccc-4ccc-8ccc-111111111111";

export type RiversideDemoContentItem = {
  id: string;
  shop_id: string;
  title: string;
  content_type: string;
  status: string;
  updated_at: string;
  body: string;
};

export const RIVERSIDE_DEMO_CONTENT_ITEMS: RiversideDemoContentItem[] = [
  {
    id: RIVERSIDE_DEMO_CONTENT_ITEM_ID,
    shop_id: "riverside-demo-preview",
    title: "Riverside Collision July repair tips",
    content_type: "blog_post",
    status: "pending_review",
    updated_at: "2026-08-11T16:00:00.000Z",
    body:
      "# Riverside Collision July repair tips\n\n" +
      "PSG prepared this customer-facing article so Riverside can educate drivers before storm season.\n\n" +
      "- Check lamps and sensors after any bumper impact\n" +
      "- Schedule an estimate before small damage spreads\n" +
      "- Keep photos and claim numbers ready for the repair team",
  },
  {
    id: "22222222-cccc-4ccc-8ccc-222222222222",
    shop_id: "riverside-demo-preview",
    title: "Post-repair sensor check reminder",
    content_type: "email_campaign",
    status: "pending_review",
    updated_at: "2026-08-10T16:00:00.000Z",
    body:
      "# Post-repair sensor check reminder\n\n" +
      "Riverside can send this message after repairs that involve bumper, grille, or windshield work.\n\n" +
      "- Explain that modern safety systems may need calibration\n" +
      "- Invite the customer to call if warning lights appear\n" +
      "- Reinforce that Riverside stands behind the completed repair",
  },
  {
    id: "33333333-cccc-4ccc-8ccc-333333333333",
    shop_id: "riverside-demo-preview",
    title: "Google review reply for finished repair",
    content_type: "review_response",
    status: "approved",
    updated_at: "2026-08-09T16:00:00.000Z",
    body:
      "# Google review reply for finished repair\n\n" +
      "Thank you for trusting Riverside Collision with your repair. We are glad the updates were helpful and that the vehicle was ready sooner than expected.",
  },
];

export const RIVERSIDE_DEMO_CONTENT_ITEM = RIVERSIDE_DEMO_CONTENT_ITEMS[0];

export function findRiversideDemoContentItem(id: string) {
  return RIVERSIDE_DEMO_CONTENT_ITEMS.find((item) => item.id === id) ?? null;
}
