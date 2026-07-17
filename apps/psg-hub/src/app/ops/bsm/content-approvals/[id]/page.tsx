import { redirect } from "next/navigation";

export default async function LegacyBsmContentApprovalReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/ops/bsm-content-approvals?reviewItemId=${encodeURIComponent(id)}`);
}
