/**
 * Pure helpers for the cover-artwork upload pipeline. All I/O methods take a
 * Supabase client so tests can pass a stub. No React, no globals.
 *
 * Contract:
 *  - Cover files: JPEG, PNG, or WebP. `image/jpg` normalized to `image/jpeg`.
 *  - Cover size hard cap enforced client-side; server enforces its own via
 *    the `get_media_limits` RPC and RLS.
 *  - Object path shape:
 *      `<userId>/<courseId>/<crypto.randomUUID()>.<mimeExt>`
 *    A UUID is used instead of a timestamp so parallel or retried uploads
 *    from the same instructor can never collide and so the object key can
 *    never leak the original filename or client clock.
 */

export const COVER_BUCKET = "course-covers";
export const COVER_MAX_BYTES = 5 * 1024 * 1024; // 5 MiB
export const COVER_ALLOWED_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;

// --- Lesson video contract ---------------------------------------------------
// Videos live in a private bucket and are uploaded resumably via TUS. Only
// MP4 (H.264/AAC) and WebM (VP8/VP9) are accepted. OGG is NOT supported.
// Server-side RLS + `attach_lesson_video` enforce the same caps.
export const VIDEO_BUCKET = "course-videos";
export const VIDEO_MAX_BYTES = 50 * 1024 * 1024; // 50 MiB
export const VIDEO_ALLOWED_MIMES = ["video/mp4", "video/webm"] as const;

export type VideoMime = (typeof VIDEO_ALLOWED_MIMES)[number];

export const VIDEO_EXT_BY_MIME: Record<VideoMime, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
};

export type VideoValidationError =
  | "empty_file"
  | "unsupported_type"
  | "file_too_large"
  | "invalid_input"
  | "config_unavailable";

export type VideoValidationResult =
  | { ok: true; mime: VideoMime; ext: string; size: number }
  | { ok: false; code: VideoValidationError };

export const VIDEO_VALIDATION_MESSAGE: Record<VideoValidationError, string> = {
  empty_file: "That video file appears to be empty. Please export it again.",
  unsupported_type: "Please upload an MP4 or WebM video.",
  file_too_large: "That video is over 50 MB. Please compress it and try again.",
  invalid_input: "We couldn't read that file. Please try selecting it again.",
  config_unavailable: "We couldn't load the video configuration. Please refresh and try again.",
};

/**
 * Normalize a video MIME string. Only the exact IANA MIMEs listed in
 * VIDEO_ALLOWED_MIMES are accepted; browser variants like `video/x-matroska`
 * are rejected so the client set matches the Storage bucket exactly.
 */
export function normalizeVideoMime(raw: string | undefined | null): VideoMime | null {
  if (!raw) return null;
  const m = raw.toLowerCase().trim();
  if (m === "video/mp4") return "video/mp4";
  if (m === "video/webm") return "video/webm";
  return null;
}

export function validateVideoFile(
  file: File | null | undefined,
  limits?: { fileSizeLimit: number; allowedMimeTypes: readonly string[] } | null,
): VideoValidationResult {
  if (!file) return { ok: false, code: "invalid_input" };
  if (file.size === 0) return { ok: false, code: "empty_file" };
  if (limits !== undefined) {
    if (
      !limits ||
      typeof limits.fileSizeLimit !== "number" ||
      !Number.isFinite(limits.fileSizeLimit) ||
      limits.fileSizeLimit <= 0 ||
      !Array.isArray(limits.allowedMimeTypes) ||
      limits.allowedMimeTypes.length === 0
    ) {
      return { ok: false, code: "config_unavailable" };
    }
  }
  const mime = normalizeVideoMime(file.type);
  if (!mime) return { ok: false, code: "unsupported_type" };
  const allowed = limits ? limits.allowedMimeTypes : VIDEO_ALLOWED_MIMES;
  if (!allowed.includes(mime)) return { ok: false, code: "unsupported_type" };
  const cap = limits ? limits.fileSizeLimit : VIDEO_MAX_BYTES;
  if (file.size > cap) return { ok: false, code: "file_too_large" };
  return { ok: true, mime, ext: VIDEO_EXT_BY_MIME[mime], size: file.size };
}

/**
 * Build a caller-scoped object path for a lesson video. Mirrors the cover
 * path shape: `<userUuid>/<courseUuid>/<randomUuid>.<ext>` so RLS policies
 * keyed on `auth.uid()` and `_object_course_id()` match without change.
 *
 * Throws for malformed UUIDs, path-traversal attempts, or extensions not in
 * the derived allowlist.
 */
export function buildVideoObjectPath(input: {
  userId: string;
  courseId: string;
  ext: string;
  id?: string;
}): string {
  if (!isUuid(input.userId)) throw new Error("invalid_user_id");
  if (!isUuid(input.courseId)) throw new Error("invalid_course_id");
  const allowedExts = Object.values(VIDEO_EXT_BY_MIME) as string[];
  if (!allowedExts.includes(input.ext)) throw new Error("invalid_extension");
  const id = input.id ?? cryptoRandomUUID();
  if (!isUuid(id)) throw new Error("invalid_object_id");
  return `${input.userId}/${input.courseId}/${id}.${input.ext}`;
}

/**
 * Config for a resumable Supabase Storage TUS upload. The caller passes this
 * dict to `new tus.Upload(file, config)` after obtaining a fresh access token
 * from the browser Supabase client. Kept pure so tests can assert the exact
 * shape without pulling `tus-js-client` into JSDOM.
 */
export type TusUploadConfig = {
  endpoint: string;
  retryDelays: number[];
  headers: Record<string, string>;
  uploadDataDuringCreation: boolean;
  removeFingerprintOnSuccess: boolean;
  chunkSize: number;
  metadata: {
    bucketName: string;
    objectName: string;
    contentType: string;
    cacheControl: string;
  };
};

export function buildTusUploadConfig(input: {
  supabaseUrl: string;
  accessToken: string;
  apiKey: string;
  objectPath: string;
  mime: VideoMime;
  chunkSize?: number;
}): TusUploadConfig {
  if (!input.supabaseUrl || !/^https?:\/\//i.test(input.supabaseUrl)) {
    throw new Error("invalid_supabase_url");
  }
  if (!input.accessToken) throw new Error("missing_access_token");
  if (!input.apiKey) throw new Error("missing_api_key");
  if (!input.objectPath) throw new Error("missing_object_path");
  if (!normalizeVideoMime(input.mime)) throw new Error("invalid_mime");
  const chunk = input.chunkSize ?? 6 * 1024 * 1024;
  if (!Number.isFinite(chunk) || chunk <= 0) throw new Error("invalid_chunk_size");
  const base = input.supabaseUrl.replace(/\/+$/, "");
  return {
    endpoint: `${base}/storage/v1/upload/resumable`,
    retryDelays: [0, 3000, 5000, 10000, 20000],
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      "x-upsert": "false",
      apikey: input.apiKey,
    },
    uploadDataDuringCreation: true,
    removeFingerprintOnSuccess: true,
    chunkSize: chunk,
    metadata: {
      bucketName: VIDEO_BUCKET,
      objectName: input.objectPath,
      contentType: input.mime,
      cacheControl: "3600",
    },
  };
}

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
  | "invalid_input"
  | "invalid_dimensions"
  | "undecodable_image"
  | "config_unavailable";

export type CoverValidationResult =
  | { ok: true; mime: CoverMime; ext: string; size: number }
  | { ok: false; code: CoverValidationError };

/**
 * The bucket accepts only the exact IANA image MIMEs listed in
 * COVER_ALLOWED_MIMES. `image/jpg` is a common but non-standard string that
 * some browsers/tools emit — we deliberately REJECT it rather than silently
 * rewriting it to `image/jpeg`, so the accepted set at the UI matches the
 * accepted set at Storage exactly.
 */
export function normalizeMime(raw: string | undefined | null): CoverMime | null {
  if (!raw) return null;
  const m = raw.toLowerCase().trim();
  if (m === "image/jpeg") return "image/jpeg";
  if (m === "image/png") return "image/png";
  if (m === "image/webp") return "image/webp";
  return null;
}

export function validateCoverFile(
  file: File | null | undefined,
  limits?: { fileSizeLimit: number; allowedMimeTypes: readonly string[] } | null,
): CoverValidationResult {
  if (!file) return { ok: false, code: "invalid_input" };
  if (file.size === 0) return { ok: false, code: "empty_file" };
  // If DB-driven limits are provided but malformed, fail closed rather than
  // silently falling back to the compiled default.
  if (limits !== undefined) {
    if (
      !limits ||
      typeof limits.fileSizeLimit !== "number" ||
      !Number.isFinite(limits.fileSizeLimit) ||
      limits.fileSizeLimit <= 0 ||
      !Array.isArray(limits.allowedMimeTypes) ||
      limits.allowedMimeTypes.length === 0
    ) {
      return { ok: false, code: "config_unavailable" };
    }
  }
  const mime = normalizeMime(file.type);
  if (!mime) return { ok: false, code: "unsupported_type" };
  const allowed = limits ? limits.allowedMimeTypes : COVER_ALLOWED_MIMES;
  if (!allowed.includes(mime)) return { ok: false, code: "unsupported_type" };
  const cap = limits ? limits.fileSizeLimit : COVER_MAX_BYTES;
  if (file.size > cap) return { ok: false, code: "file_too_large" };
  return { ok: true, mime, ext: COVER_EXT_BY_MIME[mime], size: file.size };
}

// Standard UUID v1–v5 shape. We validate BOTH the caller-supplied user and
// course IDs so a malformed value can never be smuggled into the object key
// (e.g. `..`, slashes, encoded separators, `user-1` style test fixtures).
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/**
 * Build a deterministic-but-fresh object path scoped to the caller. Uses the
 * user id and course id so RLS policies keyed on `auth.uid()` will match.
 *
 * Throws if `userId` or `courseId` isn't a well-formed UUID, or if `ext`
 * isn't one of the derived allowlist extensions. This prevents path
 * traversal, slash injection, and accidental filename leakage.
 */
export function buildCoverObjectPath(input: {
  userId: string;
  courseId: string;
  ext: string;
  /** Random object id. Pass a `crypto.randomUUID()` in prod. Tests may override. */
  id?: string;
}): string {
  if (!isUuid(input.userId)) throw new Error("invalid_user_id");
  if (!isUuid(input.courseId)) throw new Error("invalid_course_id");
  const allowedExts = Object.values(COVER_EXT_BY_MIME) as string[];
  if (!allowedExts.includes(input.ext)) throw new Error("invalid_extension");
  const id = input.id ?? cryptoRandomUUID();
  if (!isUuid(id)) throw new Error("invalid_object_id");
  return `${input.userId}/${input.courseId}/${id}.${input.ext}`;
}

function cryptoRandomUUID(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  // Last-ditch fallback for exotic runtimes. Not intended to be reached in
  // production browsers or workerd.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export const COVER_VALIDATION_MESSAGE: Record<CoverValidationError, string> = {
  empty_file: "That file appears to be empty. Try re-exporting your image.",
  unsupported_type: "Please upload a JPEG, PNG, or WebP image.",
  file_too_large: "That image is over 5 MB. Please compress it and try again.",
  invalid_input: "We couldn't read that file. Please try selecting it again.",
  invalid_dimensions: "That image doesn't have valid dimensions. Try a different file.",
  undecodable_image: "We couldn't decode that image. Please export it again and retry.",
  config_unavailable: "We couldn't load the cover configuration. Please refresh and try again.",
};

/**
 * Decode the image in the browser to prove it's not corrupt and read its
 * intrinsic dimensions. Returns width/height on success, or a validation
 * error code on failure. The temporary object URL is revoked before the
 * function returns so it can't leak.
 */
export async function decodeImage(
  file: File,
): Promise<
  | { ok: true; width: number; height: number; is16by9: boolean }
  | { ok: false; code: "undecodable_image" | "invalid_dimensions" }
> {
  const g = globalThis as {
    URL?: { createObjectURL?: (b: Blob) => string; revokeObjectURL?: (u: string) => void };
    Image?: new () => HTMLImageElement;
  };
  if (!g.URL?.createObjectURL || !g.Image) {
    // No decoder available in this runtime (SSR/edge). Skip decode; the
    // upload path still enforces size + MIME.
    return { ok: true, width: 0, height: 0, is16by9: true };
  }
  const url = g.URL.createObjectURL(file);
  try {
    const img = new g.Image();
    const loaded = await new Promise<boolean>((resolve) => {
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = url;
    });
    if (!loaded) return { ok: false, code: "undecodable_image" };
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h || w <= 0 || h <= 0) return { ok: false, code: "invalid_dimensions" };
    const ratio = w / h;
    return { ok: true, width: w, height: h, is16by9: Math.abs(ratio - 16 / 9) < 0.02 };
  } finally {
    try {
      g.URL.revokeObjectURL?.(url);
    } catch {
      /* ignore */
    }
  }
}

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
 * Remove an object and surface any storage error to the caller so the UI
 * can enter a `cleanup_pending` retry state with the exact orphaned path.
 */
export async function removeObjectStrict(
  supabase: {
    storage: {
      from: (bucket: string) => {
        remove: (paths: string[]) => Promise<{ error: { message: string } | null }>;
      };
    };
  },
  path: string,
): Promise<void> {
  const { error } = await supabase.storage.from(COVER_BUCKET).remove([path]);
  if (error) throw new Error(error.message);
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
