// Pure, client-safe validator for post-auth "next" redirects.
// Rejects protocol-relative, absolute, encoded-external, and malformed values.
// Only same-origin internal paths under a fixed allowlist are permitted.

const ALLOWED_PREFIXES = [
  "/dashboard",
  "/browse",
  "/courses",
  "/learn",
  "/studio",
  "/admin",
];

export const DEFAULT_NEXT = "/dashboard";

export function safeNextPath(
  raw: string | null | undefined,
  fallback: string = DEFAULT_NEXT,
): string {
  if (typeof raw !== "string" || raw.length === 0) return fallback;
  let decoded = raw;
  // Decode up to two levels to catch double-encoded external URLs.
  for (let i = 0; i < 2; i++) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      return fallback;
    }
  }
  if (!decoded.startsWith("/")) return fallback;
  if (decoded.startsWith("//") || decoded.startsWith("/\\")) return fallback;
  if (decoded.includes("://")) return fallback;
  if (decoded.includes("\n") || decoded.includes("\r") || decoded.includes("\t")) return fallback;
  // Strip fragment; keep query.
  const withoutHash = decoded.split("#", 1)[0];
  const pathOnly = withoutHash.split("?", 1)[0];
  if (pathOnly === "/") return fallback;
  const allowed = ALLOWED_PREFIXES.some(
    (p) => pathOnly === p || pathOnly.startsWith(p + "/"),
  );
  return allowed ? withoutHash : fallback;
}

export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const shown = local.length <= 2 ? local[0] ?? "" : local.slice(0, 2);
  return `${shown}${"•".repeat(Math.max(1, local.length - shown.length))}@${domain}`;
}