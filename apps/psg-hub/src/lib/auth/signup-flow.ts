export const EXISTING_ACCOUNT_MESSAGE =
  "An account already exists for this email. Log in instead, or reset your password if you cannot remember it.";

export const CONFIRM_EMAIL_MESSAGE =
  "Account created. Check your email to confirm your account, then log in.";

export type SignupOutcome =
  | {
      kind: "existing_account";
      message: string;
    }
  | {
      kind: "confirmation_required";
      message: string;
    }
  | {
      kind: "signed_in";
    }
  | {
      kind: "error";
      message: string;
    };

type SignupFlowInput = {
  data?: {
    user?: {
      identities?: unknown[] | null;
    } | null;
    session?: unknown | null;
  } | null;
  error?: {
    message?: string | null;
    code?: string | null;
  } | null;
};

export function resolveSignupOutcome({ data, error }: SignupFlowInput): SignupOutcome {
  if (isExistingAccountError(error)) {
    return {
      kind: "existing_account",
      message: EXISTING_ACCOUNT_MESSAGE,
    };
  }

  if (error) {
    return {
      kind: "error",
      message: error.message || "We could not create the account. Please try again.",
    };
  }

  if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    return {
      kind: "existing_account",
      message: EXISTING_ACCOUNT_MESSAGE,
    };
  }

  if (data?.session) {
    return {
      kind: "signed_in",
    };
  }

  return {
    kind: "confirmation_required",
    message: CONFIRM_EMAIL_MESSAGE,
  };
}

function isExistingAccountError(error: SignupFlowInput["error"]): boolean {
  const normalizedCode = error?.code?.toLowerCase() ?? "";
  const normalizedMessage = error?.message?.toLowerCase() ?? "";

  return (
    normalizedCode === "user_already_exists" ||
    normalizedMessage.includes("user already registered") ||
    normalizedMessage.includes("already exists") ||
    normalizedMessage.includes("already registered")
  );
}
