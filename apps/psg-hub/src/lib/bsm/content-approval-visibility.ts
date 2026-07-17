export const CONTENT_APPROVAL_VISIBILITIES = ["shop", "psg_internal"] as const;

export type ContentApprovalVisibility = (typeof CONTENT_APPROVAL_VISIBILITIES)[number];

export type ContentApprovalVisibilityOption = {
  value: ContentApprovalVisibility;
  label: string;
  description: string;
};

export const CONTENT_APPROVAL_VISIBILITY_OPTIONS: ContentApprovalVisibilityOption[] = [
  {
    value: "shop",
    label: "Visible to customer",
    description: "The shop account can see this comment or approval record.",
  },
  {
    value: "psg_internal",
    label: "Private PSG note",
    description: "Only PSG team members can see this. It is hidden from the customer.",
  },
];

export function isContentApprovalVisibility(
  value: unknown,
): value is ContentApprovalVisibility {
  return (
    typeof value === "string" &&
    CONTENT_APPROVAL_VISIBILITIES.includes(value as ContentApprovalVisibility)
  );
}

export function contentApprovalVisibilityLabel(
  visibility: ContentApprovalVisibility,
): string {
  return CONTENT_APPROVAL_VISIBILITY_OPTIONS.find((option) => option.value === visibility)
    ?.label ?? visibility;
}
