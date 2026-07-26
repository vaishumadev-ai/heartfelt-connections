// Pure, client-safe stable error mapper for learner surfaces.
// Never surfaces raw Postgres/Supabase/policy/table/function names.

export type LearnerErrorKind =
  | "unauthenticated"
  | "not_entitled"
  | "invalid_input"
  | "not_found"
  | "temporary_failure";

const MESSAGES: Record<LearnerErrorKind, string> = {
  unauthenticated: "Please sign in to continue.",
  not_entitled: "You need to enroll in this course to do that.",
  invalid_input: "That doesn't look right. Please review and try again.",
  not_found: "We couldn't find what you were looking for.",
  temporary_failure: "Something went wrong. Please try again in a moment.",
};

export function classifyLearnerError(err: unknown): LearnerErrorKind {
  const msg = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const code =
    (err as { code?: string } | null)?.code ??
    (err as { status?: number } | null)?.status?.toString?.() ??
    "";

  if (/not authenticated/i.test(msg) || code === "28000" || code === "401") {
    return "unauthenticated";
  }
  if (
    /not entitled|entitlement|forbidden|not your|admin only|requires? free-course|paid course/i.test(
      msg,
    ) ||
    code === "42501" ||
    code === "403"
  ) {
    return "not_entitled";
  }
  if (/invalid|rating|reason required|too long|note body/i.test(msg) || code === "22023") {
    return "invalid_input";
  }
  if (/not found/i.test(msg) || code === "42704" || code === "404") {
    return "not_found";
  }
  return "temporary_failure";
}

export function mapLearnerError(err: unknown): string {
  return MESSAGES[classifyLearnerError(err)];
}
