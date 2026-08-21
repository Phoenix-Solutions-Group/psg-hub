export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireOpsFn } from "@/lib/auth/ops-access";
import { sendEmail } from "@/lib/mail/sendgrid";
import { createServiceClient } from "@/lib/supabase/service";
import {
  ReviewWorkspaceInputError,
  bsmReviewWorkspaceInternalEnabled,
  createReviewWorkspaceProject,
  createInternalReviewWorkspaceSlice,
  listStaffReviewWorkspaces,
  startReviewWorkspaceRound,
} from "@/lib/bsm/review-workspace";

export async function GET(): Promise<Response> {
  const gate = await requireOpsFn("manage_bsm_content_approvals");
  if (!gate.ok) return gate.response;

  try {
    const workspaces = await listStaffReviewWorkspaces(gate.userId, gate.access.role);
    return NextResponse.json({ workspaces }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error(
      "[ops/bsm/review-workspace/projects] list failed:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json({ error: "Could not list review workspaces." }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<Response> {
  const gate = await requireOpsFn("manage_bsm_content_approvals");
  if (!gate.ok) return gate.response;

  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!payload) return NextResponse.json({ error: "The request body was not readable." }, { status: 400 });

  try {
    if (payload.action === "create_workspace") {
      const workspace = await createReviewWorkspaceProject({
        shopId: payload.shopId as string,
        title: payload.title as string,
        description: payload.description as string | null | undefined,
        actorProfileId: gate.userId,
        metadata: { feature: "content_approvals_workspace_first" },
      });
      return NextResponse.json({ workspace }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
    }

    if (payload.action === "start_review") {
      if (!bsmReviewWorkspaceInternalEnabled()) {
        return NextResponse.json({ error: "The reviewer workspace is disabled in this environment." }, { status: 409 });
      }
      const service = createServiceClient();
      // ponytail: one auth page covers current PSG scale; paginate when the account directory exceeds 1,000 users.
      const { data: userPage, error: userError } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (userError) throw new Error(`Could not resolve reviewer accounts: ${userError.message}`);
      const profileByEmail = new Map(userPage.users.flatMap((user) => user.email ? [[user.email.trim().toLowerCase(), user.id] as const] : []));
      const review = await startReviewWorkspaceRound({
        projectId: payload.projectId as string,
        actorProfileId: gate.userId,
        actorRole: gate.access.role,
        reviewers: Array.isArray(payload.reviewers)
          ? payload.reviewers.map((reviewer) => {
              const contact = reviewer as { email: string; name?: string | null };
              return { ...contact, profileId: profileByEmail.get(contact.email.trim().toLowerCase()) ?? null };
            })
          : [],
      });
      const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin).replace(/\/+$/, "");
      const deliveryResults = await Promise.allSettled(review.invitations.map((invitation) =>
        sendEmail({
          to: invitation.reviewerName
            ? { name: invitation.reviewerName, email: invitation.reviewerEmail }
            : invitation.reviewerEmail,
          subject: "Your PSG content review is ready",
          text: [
            "PSG has shared content for your review.",
            `Open: ${baseUrl}/review-workspace?invite=${encodeURIComponent(invitation.inviteToken)}`,
            `One-time code: ${invitation.inviteCode}`,
            "This private invitation expires in 14 days.",
          ].join("\n\n"),
          html: `<p>PSG has shared content for your review.</p><p><a href="${baseUrl}/review-workspace?invite=${encodeURIComponent(invitation.inviteToken)}">Open the private review workspace</a></p><p>One-time code: <strong>${invitation.inviteCode}</strong></p><p>This private invitation expires in 14 days.</p>`,
          clickTracking: false,
        }),
      ));
      await Promise.all(review.invitations.map((invitation, index) =>
        service
          .from("bsm_content_review_invitations")
          .update({
            status: "sent",
            last_code_sent_at: deliveryResults[index]?.status === "fulfilled" ? new Date().toISOString() : null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", invitation.invitationId),
      ));
      const invitations = review.invitations.map((invitation, index) => ({
        ...invitation,
        deliveryStatus: deliveryResults[index]?.status === "fulfilled" ? "sent" as const : "failed" as const,
      }));
      const failedDeliveryCount = invitations.filter((invitation) => invitation.deliveryStatus === "failed").length;
      return NextResponse.json(
        { review: { ...review, invitations }, failedDeliveryCount },
        { status: failedDeliveryCount ? 207 : 201, headers: { "Cache-Control": "private, no-store" } },
      );
    }

    const slice = await createInternalReviewWorkspaceSlice({
      shopId: payload.shopId as string,
      title: payload.title as string,
      description: payload.description as string | null | undefined,
      actorProfileId: gate.userId,
      reviewerEmail: payload.reviewerEmail as string,
      reviewerName: payload.reviewerName as string | null | undefined,
      documents: Array.isArray(payload.documents)
        ? payload.documents.map((doc) => doc as never)
        : [],
    });

    return NextResponse.json({ slice }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ReviewWorkspaceInputError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error(
      "[ops/bsm/review-workspace/projects] create failed:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json({ error: "Could not create the internal review workspace." }, { status: 500 });
  }
}
