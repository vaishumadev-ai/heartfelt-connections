/**
 * Pure helpers for the cover-artwork upload pipeline. All I/O methods take a
 * Supabase client so tests can pass a stub. No React, no globals.
 *
 * Contract:
 *  - Cover files: JPEG, PNG, or WebP. `image/jpg` normalized to `image/jpeg`.
 *  - Cover size hard cap enforced client-side; server enforces its own via
 *    the `get_media_limits` RPC and RLS.
 *  - Object path shape: `<userId>/<courseId>/cover-<epoch_ms>.<ext>`. Timestamp
 *    guarantees each attempt writes a fresh key so a partial upload never
 *    collides with a subsequent one.
 */

export const COVER_BUCKET = "course-covers";
export const COVER_MAX_BYTES = 5 * 1024 * 1024; // 5 MiB
export const COVER_ALLOWED_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;

export type CoverMime = (typeof COVER_ALLOWED_MIMES)[number];

export const COVER_EXT_BY_MIME: Record<CoverMime, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export type CoverValidationError =
  | "empty_file"
  | "unsupported_type"
  | "file_too_large"
  | "invalid_input";

export type CoverValidationResult =
  | { ok: true; mime: CoverMime; ext: string; size: number }
  | { ok: false; code: CoverValidationError };

export function normalizeMime(raw: string | undefined | null): CoverMime | null {
  if (!raw) return null;
  const m = raw.toLowerCase();
  if (m === "image/jpg" || m === "image/jpeg") return "image/jpeg";
  if (m === "image/png") return "image/png";
  if (m === "image/webp") return "image/webp";
  return null;
}

export function validateCoverFile(file: File | null | undefined): CoverValidationResult {
  if (!file) return { ok: false, code: "invalid_input" };
  if (file.size === 0) return { ok: false, code: "empty_file" };
  const mime = normalizeMime(file.type);
  if (!mime) return { ok: false, code: "unsupported_type" };
  if (file.size > COVER_MAX_BYTES) return { ok: false, code: "file_too_large" };
  return { ok: true, mime, ext: COVER_EXT_BY_MIME[mime], size: file.size };
}

/**
 * Build a deterministic-but-fresh object path scoped to the caller. Uses the
 * user id and course id so RLS policies keyed on `auth.uid()` will match.
 */
export function buildCoverObjectPath(input: {
  userId: string;
  courseId: string;
  ext: string;
  now?: number;
}): string {
  const stamp = input.now ?? Date.now();
  return `${input.userId}/${input.courseId}/cover-${stamp}.${input.ext}`;
}

export const COVER_VALIDATION_MESSAGE: Record<CoverValidationError, string> = {
  empty_file: "That file appears to be empty. Try re-exporting your image.",
  unsupported_type: "Please upload a JPEG, PNG, or WebP image.",
  file_too_large: "That image is over 5 MB. Please compress it and try again.",
  invalid_input: "We couldn't read that file. Please try selecting it again.",
};

/**
 * Upload the cover file to Storage. Uses `upsert: false` so a duplicate key
 * (which shouldn't happen given the timestamp) raises rather than silently
 * overwriting.
 */
export async function uploadCoverToStorage(
  supabase: {
    storage: {
      from: (bucket: string) => {
        upload: (
          path: string,
          file: File,
          opts?: { upsert?: boolean; contentType?: string; cacheControl?: string },
        ) => Promise<{ error: { message: string } | null }>;
      };
    };
  },
  path: string,
  file: File,
  mime: CoverMime,
): Promise<void> {
  const { error } = await supabase.storage.from(COVER_BUCKET).upload(path, file, {
    upsert: false,
    contentType: mime,
    cacheControl: "3600",
  });
  if (error) throw new Error(error.message);
}

/**
 * Best-effort cleanup for a partially-written object. Silently swallows
 * errors — the caller is already in a failure branch and there is nothing
 * useful to surface to the instructor beyond the original error.
 */
export async function bestEffortRemoveObject(
  supabase: {
    storage: {
      from: (bucket: string) => {
        remove: (paths: string[]) => Promise<{ error: { message: string } | null }>;
      };
    };
  },
  path: string,
): Promise<void> {
  try {
    await supabase.storage.from(COVER_BUCKET).remove([path]);
  } catch {
    /* swallow */
  }
}

/**
 * Request a signed URL for a private cover. Returns null on failure so the
 * UI can render a fallback state instead of blocking the page.
 */
export async function signCoverUrl(
  supabase: {
    storage: {
      from: (bucket: string) => {
        createSignedUrl: (
          path: string,
          expiresIn: number,
        ) => Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }>;
      };
    };
  },
  path: string,
  expiresInSeconds = 3600,
): Promise<string | null> {
  try {
    const { data, error } = await supabase.storage
      .from(COVER_BUCKET)
      .createSignedUrl(path, expiresInSeconds);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}