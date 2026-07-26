import { describe, it, expect } from "vitest";
import {
  VIDEO_ALLOWED_MIMES,
  VIDEO_MAX_BYTES,
  VIDEO_BUCKET,
  buildTusUploadConfig,
  buildVideoObjectPath,
  normalizeVideoMime,
  validateVideoFile,
} from "@/lib/media-uploads";

function fakeFile(size: number, type: string): File {
  return new File([new Uint8Array(size)], "x.bin", { type });
}

const U = "11111111-1111-4111-8111-111111111111";
const C = "22222222-2222-4222-8222-222222222222";
const OID = "33333333-3333-4333-8333-333333333333";

describe("video validation", () => {
  it("rejects null / empty files", () => {
    expect(validateVideoFile(null).ok).toBe(false);
    expect(validateVideoFile(fakeFile(0, "video/mp4"))).toEqual({
      ok: false,
      code: "empty_file",
    });
  });

  it("rejects unsupported mimes including OGG and matroska", () => {
    expect(validateVideoFile(fakeFile(2048, "video/ogg"))).toEqual({
      ok: false,
      code: "unsupported_type",
    });
    expect(validateVideoFile(fakeFile(2048, "video/x-matroska"))).toEqual({
      ok: false,
      code: "unsupported_type",
    });
    expect(normalizeVideoMime("video/ogg")).toBeNull();
    expect(normalizeVideoMime("")).toBeNull();
    expect(normalizeVideoMime(null)).toBeNull();
  });

  it("rejects oversize files at the compiled 50 MiB cap", () => {
    expect(VIDEO_MAX_BYTES).toBe(50 * 1024 * 1024);
    expect(validateVideoFile(fakeFile(VIDEO_MAX_BYTES + 1, "video/mp4"))).toEqual({
      ok: false,
      code: "file_too_large",
    });
  });

  it("accepts each allowed IANA video mime", () => {
    for (const mime of VIDEO_ALLOWED_MIMES) {
      const r = validateVideoFile(fakeFile(2048, mime));
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.mime).toBe(mime);
      }
    }
  });

  it("uses DB-driven limits when supplied and fails closed on malformed limits", () => {
    const limits = { fileSizeLimit: 1024, allowedMimeTypes: ["video/mp4"] };
    expect(validateVideoFile(fakeFile(512, "video/mp4"), limits).ok).toBe(true);
    expect(validateVideoFile(fakeFile(2048, "video/mp4"), limits)).toEqual({
      ok: false,
      code: "file_too_large",
    });
    expect(validateVideoFile(fakeFile(512, "video/webm"), limits)).toEqual({
      ok: false,
      code: "unsupported_type",
    });
    expect(
      validateVideoFile(fakeFile(512, "video/mp4"), {
        fileSizeLimit: 0,
        allowedMimeTypes: [],
      }),
    ).toEqual({ ok: false, code: "config_unavailable" });
    expect(
      validateVideoFile(
        fakeFile(512, "video/mp4"),
        null as unknown as { fileSizeLimit: number; allowedMimeTypes: string[] },
      ),
    ).toEqual({ ok: false, code: "config_unavailable" });
  });
});

describe("buildVideoObjectPath", () => {
  it("scopes path to <user>/<course>/<uuid>.<ext>", () => {
    const p = buildVideoObjectPath({ userId: U, courseId: C, ext: "mp4", id: OID });
    expect(p).toBe(`${U}/${C}/${OID}.mp4`);
  });

  it("emits distinct paths across attempts without embedding the original filename", () => {
    const a = buildVideoObjectPath({ userId: U, courseId: C, ext: "webm" });
    const b = buildVideoObjectPath({ userId: U, courseId: C, ext: "webm" });
    expect(a).not.toBe(b);
    expect(a).toMatch(new RegExp(`^${U}/${C}/[0-9a-f-]{36}\\.webm$`, "i"));
  });

  it("rejects malformed IDs, slash/traversal injection, and non-allowlisted extensions", () => {
    expect(() => buildVideoObjectPath({ userId: "u", courseId: C, ext: "mp4" })).toThrow(
      /invalid_user_id/,
    );
    expect(() => buildVideoObjectPath({ userId: U, courseId: "c", ext: "mp4" })).toThrow(
      /invalid_course_id/,
    );
    expect(() => buildVideoObjectPath({ userId: `${U}/x`, courseId: C, ext: "mp4" })).toThrow();
    expect(() => buildVideoObjectPath({ userId: "../etc", courseId: C, ext: "mp4" })).toThrow();
    expect(() => buildVideoObjectPath({ userId: U, courseId: C, ext: "mov" })).toThrow(
      /invalid_extension/,
    );
    expect(() => buildVideoObjectPath({ userId: U, courseId: C, ext: "ogg" })).toThrow(
      /invalid_extension/,
    );
    expect(() =>
      buildVideoObjectPath({ userId: U, courseId: C, ext: "mp4", id: "not-a-uuid" }),
    ).toThrow(/invalid_object_id/);
  });
});

describe("buildTusUploadConfig", () => {
  const base = {
    supabaseUrl: "https://project.supabase.co",
    accessToken: "acc-tok",
    apiKey: "sb_publishable_xxx",
    objectPath: `${U}/${C}/${OID}.mp4`,
    mime: "video/mp4" as const,
  };

  it("produces a TUS config aimed at the Storage resumable endpoint", () => {
    const c = buildTusUploadConfig(base);
    expect(c.endpoint).toBe("https://project.supabase.co/storage/v1/upload/resumable");
    expect(c.metadata.bucketName).toBe(VIDEO_BUCKET);
    expect(c.metadata.objectName).toBe(base.objectPath);
    expect(c.metadata.contentType).toBe("video/mp4");
    expect(c.metadata.cacheControl).toBe("3600");
    expect(c.uploadDataDuringCreation).toBe(true);
    expect(c.removeFingerprintOnSuccess).toBe(true);
    expect(c.chunkSize).toBe(6 * 1024 * 1024);
    expect(c.retryDelays.length).toBeGreaterThan(2);
  });

  it("forwards bearer + apikey + x-upsert:false headers", () => {
    const c = buildTusUploadConfig(base);
    expect(c.headers.authorization).toBe("Bearer acc-tok");
    expect(c.headers.apikey).toBe("sb_publishable_xxx");
    expect(c.headers["x-upsert"]).toBe("false");
  });

  it("trims a trailing slash on the supabase URL", () => {
    const c = buildTusUploadConfig({ ...base, supabaseUrl: "https://project.supabase.co/" });
    expect(c.endpoint).toBe("https://project.supabase.co/storage/v1/upload/resumable");
  });

  it("rejects invalid inputs", () => {
    expect(() => buildTusUploadConfig({ ...base, supabaseUrl: "" })).toThrow(
      /invalid_supabase_url/,
    );
    expect(() => buildTusUploadConfig({ ...base, supabaseUrl: "ftp://x" })).toThrow(
      /invalid_supabase_url/,
    );
    expect(() => buildTusUploadConfig({ ...base, accessToken: "" })).toThrow(
      /missing_access_token/,
    );
    expect(() => buildTusUploadConfig({ ...base, apiKey: "" })).toThrow(/missing_api_key/);
    expect(() => buildTusUploadConfig({ ...base, objectPath: "" })).toThrow(/missing_object_path/);
    expect(() =>
      buildTusUploadConfig({ ...base, mime: "video/ogg" as unknown as "video/mp4" }),
    ).toThrow(/invalid_mime/);
    expect(() => buildTusUploadConfig({ ...base, chunkSize: 0 })).toThrow(/invalid_chunk_size/);
  });

  it("accepts webm as well as mp4", () => {
    const c = buildTusUploadConfig({
      ...base,
      mime: "video/webm",
      objectPath: `${U}/${C}/${OID}.webm`,
    });
    expect(c.metadata.contentType).toBe("video/webm");
  });
});
