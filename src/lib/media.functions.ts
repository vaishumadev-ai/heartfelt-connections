import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Media limits sourced from the authoritative `get_media_limits` RPC. Values
 * are advisory for the client — the browser's own validation short-circuits
 * obviously invalid uploads before touching Storage, but Storage RLS still
 * enforces the same limits server-side.
 */
export type MediaLimits = {
  cover: { fileSizeLimit: number; allowedMimeTypes: string[] };
  video: { fileSizeLimit: number; allowedMimeTypes: string[] };
};

const FALLBACK: MediaLimits = {
  cover: {
    fileSizeLimit: 5 * 1024 * 1024,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
  },
  video: {
    fileSizeLimit: 50 * 1024 * 1024,
    allowedMimeTypes: ["video/mp4", "video/webm"],
  },
};

/**
 * Returns the current media limits for cover and video buckets. Falls back to
 * conservative defaults if the RPC fails so the UI never blocks the whole
 * editor on a transient error.
 */
export const getMediaLimits = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MediaLimits> => {
    const { data, error } = await context.supabase.rpc("get_media_limits");
    if (error || !Array.isArray(data)) return FALLBACK;
    const byBucket = new Map<string, { file_size_limit: number; allowed_mime_types: string[] }>();
    for (const row of data as {
      bucket: string;
      file_size_limit: number;
      allowed_mime_types: string[];
    }[]) {
      byBucket.set(row.bucket, {
        file_size_limit: Number(row.file_size_limit ?? 0),
        allowed_mime_types: Array.isArray(row.allowed_mime_types) ? row.allowed_mime_types : [],
      });
    }
    const cover = byBucket.get("course-covers");
    const video = byBucket.get("course-videos");
    return {
      cover: cover
        ? { fileSizeLimit: cover.file_size_limit, allowedMimeTypes: cover.allowed_mime_types }
        : FALLBACK.cover,
      video: video
        ? { fileSizeLimit: video.file_size_limit, allowedMimeTypes: video.allowed_mime_types }
        : FALLBACK.video,
    };
  });

/**
 * Attach a freshly-uploaded cover object to a course. The RPC verifies that
 * the caller owns the course and that the storage object exists and is owned
 * by the same user.
 */
export const attachCourseCover = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { courseId: string; storagePath: string }) => d)
  .handler(async ({ data, context }) => {
    const { data: prev, error } = await context.supabase.rpc("attach_course_cover", {
      _course_id: data.courseId,
      _path: data.storagePath,
    });
    if (error) throw new Error(error.message);
    const previousStoragePath = typeof prev === "string" && prev.length > 0 ? prev : null;
    return { ok: true as const, previousStoragePath };
  });

/**
 * Detach the current cover from a course and return the previously-attached
 * storage path so the caller-scoped Storage client can delete it as a
 * compensating step. The database change commits regardless of whether the
 * subsequent object deletion succeeds.
 */
export const detachCourseCover = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { courseId: string }) => d)
  .handler(async ({ data, context }) => {
    const { data: prev, error } = await context.supabase.rpc("detach_course_cover", {
      _course_id: data.courseId,
    });
    if (error) throw new Error(error.message);
    const previousStoragePath = typeof prev === "string" && prev.length > 0 ? prev : null;
    return { ok: true as const, previousStoragePath };
  });

/**
 * Sign a private cover object for preview. This wraps the Storage signed-URL
 * API from the server so the client never needs a direct Storage read.
 */
export const signCoverPreview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { storagePath: string; expiresIn?: number }) => d)
  .handler(async ({ data, context }) => {
    const ttl = Math.max(60, Math.min(data.expiresIn ?? 3600, 60 * 60 * 24));
    const { data: signed, error } = await context.supabase.storage
      .from("course-covers")
      .createSignedUrl(data.storagePath, ttl);
    if (error || !signed?.signedUrl) return { url: null as string | null, expiresIn: ttl };
    return { url: signed.signedUrl, expiresIn: ttl };
  });

/**
 * Attach a freshly-uploaded lesson video object to a lesson. The RPC verifies
 * the caller owns the parent course, the course is editable, the storage
 * object exists, and the object was uploaded by the same user. If a previous
 * video existed, the RPC also removes the prior object from Storage as part
 * of the same transaction — no client-side compensating delete needed.
 */
export const attachLessonVideo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { lessonId: string; storagePath: string }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("attach_lesson_video", {
      _lesson_id: data.lessonId,
      _path: data.storagePath,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/**
 * Detach the current lesson video and delete the underlying storage object.
 * The RPC removes the object atomically with the DB update.
 */
export const detachLessonVideo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { lessonId: string }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("detach_lesson_video", {
      _lesson_id: data.lessonId,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/**
 * Sign a private lesson-video URL for short-lived playback. TTL is clamped
 * to [60s, 6h]. Returns null on failure so the player can enter a fail-closed
 * state instead of exposing a stale URL.
 */
export const signLessonVideoUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { storagePath: string; expiresIn?: number }) => d)
  .handler(async ({ data, context }) => {
    const ttl = Math.max(60, Math.min(data.expiresIn ?? 3600, 60 * 60 * 6));
    const { data: signed, error } = await context.supabase.storage
      .from("course-videos")
      .createSignedUrl(data.storagePath, ttl);
    if (error || !signed?.signedUrl) return { url: null as string | null, expiresIn: ttl };
    return { url: signed.signedUrl, expiresIn: ttl };
  });
