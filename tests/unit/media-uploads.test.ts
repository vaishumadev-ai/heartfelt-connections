import { describe, it, expect, vi } from "vitest";
import {
  buildCoverObjectPath,
  bestEffortRemoveObject,
  COVER_ALLOWED_MIMES,
  COVER_MAX_BYTES,
  normalizeMime,
  removeObjectStrict,
  signCoverUrl,
  uploadCoverToStorage,
  validateCoverFile,
} from "@/lib/media-uploads";

function fakeFile(size: number, type: string): File {
  return new File([new Uint8Array(size)], "x.bin", { type });
}

// Real UUID fixtures. Using literal `u1` / `c1` strings would (correctly)
// throw from buildCoverObjectPath after the UUID guard was added.
const U = "11111111-1111-4111-8111-111111111111";
const C = "22222222-2222-4222-8222-222222222222";
const OID = "33333333-3333-4333-8333-333333333333";

describe("media-uploads path & validation", () => {
  it("rejects empty files", () => {
    expect(validateCoverFile(fakeFile(0, "image/png"))).toEqual({
      ok: false,
      code: "empty_file",
    });
  });

  it("rejects unsupported mime types", () => {
    expect(validateCoverFile(fakeFile(1024, "image/gif"))).toEqual({
      ok: false,
      code: "unsupported_type",
    });
  });

  it("rejects the non-standard image/jpg string (not mapped to image/jpeg)", () => {
    expect(validateCoverFile(fakeFile(2048, "image/jpg"))).toEqual({
      ok: false,
      code: "unsupported_type",
    });
    expect(normalizeMime("image/jpg")).toBeNull();
  });

  it("rejects oversize files (compiled default)", () => {
    expect(validateCoverFile(fakeFile(COVER_MAX_BYTES + 1, "image/png"))).toEqual({
      ok: false,
      code: "file_too_large",
    });
  });

  it("accepts each allowed IANA mime", () => {
    for (const mime of COVER_ALLOWED_MIMES) {
      const r = validateCoverFile(fakeFile(2048, mime));
      expect(r.ok).toBe(true);
    }
  });

  it("normalizeMime is null for garbage", () => {
    expect(normalizeMime("")).toBeNull();
    expect(normalizeMime("application/pdf")).toBeNull();
  });

  it("buildCoverObjectPath scopes to user, course, ext and uses a random uuid segment", () => {
    const p = buildCoverObjectPath({
      userId: U,
      courseId: C,
      ext: "png",
      id: OID,
    });
    expect(p).toBe(`${U}/${C}/${OID}.png`);
  });

  it("buildCoverObjectPath produces distinct paths across attempts (uuid segment)", () => {
    const a = buildCoverObjectPath({ userId: U, courseId: C, ext: "jpg" });
    const b = buildCoverObjectPath({ userId: U, courseId: C, ext: "jpg" });
    expect(a).not.toBe(b);
    expect(a).toMatch(new RegExp(`^${U}/${C}/[0-9a-f-]{36}\\.jpg$`, "i"));
  });

  it("buildCoverObjectPath never embeds the original filename", () => {
    const p = buildCoverObjectPath({ userId: U, courseId: C, ext: "webp" });
    expect(p).not.toMatch(/\.(png|jpg|jpeg)$/i);
    expect(p.split("/")).toHaveLength(3);
  });

  it("buildCoverObjectPath rejects malformed user/course IDs, traversal, and slashes", () => {
    // Not a UUID
    expect(() => buildCoverObjectPath({ userId: "user-1", courseId: C, ext: "png" })).toThrow(
      /invalid_user_id/,
    );
    expect(() => buildCoverObjectPath({ userId: U, courseId: "course-abc", ext: "png" })).toThrow(
      /invalid_course_id/,
    );
    // Path traversal / slash injection
    expect(() => buildCoverObjectPath({ userId: "../../etc", courseId: C, ext: "png" })).toThrow();
    expect(() => buildCoverObjectPath({ userId: `${U}/x`, courseId: C, ext: "png" })).toThrow();
    expect(() => buildCoverObjectPath({ userId: U, courseId: `${C}%2Fx`, ext: "png" })).toThrow();
    // Braces / encoded separators
    expect(() => buildCoverObjectPath({ userId: `{${U}}`, courseId: C, ext: "png" })).toThrow();
    // Empty IDs
    expect(() => buildCoverObjectPath({ userId: "", courseId: C, ext: "png" })).toThrow();
    expect(() => buildCoverObjectPath({ userId: U, courseId: "", ext: "png" })).toThrow();
    // Extension not in allowlist
    expect(() => buildCoverObjectPath({ userId: U, courseId: C, ext: "gif" })).toThrow(
      /invalid_extension/,
    );
  });

  it("validateCoverFile with DB-driven limits uses them (below/above), rejects MIME absent from allowlist, and fails closed on malformed limits", () => {
    const limits = { fileSizeLimit: 1024, allowedMimeTypes: ["image/png"] };
    // Below the mocked limit succeeds.
    expect(validateCoverFile(fakeFile(512, "image/png"), limits).ok).toBe(true);
    // Above the mocked limit fails.
    expect(validateCoverFile(fakeFile(2048, "image/png"), limits)).toEqual({
      ok: false,
      code: "file_too_large",
    });
    // MIME not in the returned allowlist fails.
    expect(validateCoverFile(fakeFile(512, "image/jpeg"), limits)).toEqual({
      ok: false,
      code: "unsupported_type",
    });
    // Malformed limits → fail closed with config_unavailable.
    expect(
      validateCoverFile(fakeFile(512, "image/png"), {
        fileSizeLimit: 0,
        allowedMimeTypes: [],
      }).ok,
    ).toBe(false);
    expect(
      validateCoverFile(
        fakeFile(512, "image/png"),
        null as unknown as {
          fileSizeLimit: number;
          allowedMimeTypes: string[];
        },
      ),
    ).toEqual({ ok: false, code: "config_unavailable" });
  });
});

describe("media-uploads storage adapters", () => {
  it("uploadCoverToStorage forwards contentType and upsert:false", async () => {
    const upload = vi.fn().mockResolvedValue({ error: null });
    const sb = { storage: { from: () => ({ upload }) } };
    const file = fakeFile(10, "image/png");
    await uploadCoverToStorage(sb, "u/c/cover-1.png", file, "image/png");
    expect(upload).toHaveBeenCalledWith(
      "u/c/cover-1.png",
      file,
      expect.objectContaining({ upsert: false, contentType: "image/png" }),
    );
  });

  it("uploadCoverToStorage throws on storage error", async () => {
    const sb = {
      storage: {
        from: () => ({ upload: () => Promise.resolve({ error: { message: "boom" } }) }),
      },
    };
    await expect(
      uploadCoverToStorage(sb, "p", fakeFile(1, "image/png"), "image/png"),
    ).rejects.toThrow("boom");
  });

  it("bestEffortRemoveObject swallows storage errors", async () => {
    const sb = {
      storage: { from: () => ({ remove: () => Promise.reject(new Error("nope")) }) },
    };
    await expect(bestEffortRemoveObject(sb, "x")).resolves.toBeUndefined();
  });

  it("removeObjectStrict throws on storage error so the UI can enter cleanup_pending", async () => {
    const sb = {
      storage: {
        from: () => ({
          remove: () => Promise.resolve({ error: { message: "acl denied" } }),
        }),
      },
    };
    await expect(removeObjectStrict(sb, "u/c/o.png")).rejects.toThrow("acl denied");
  });

  it("removeObjectStrict resolves on success", async () => {
    const remove = vi.fn().mockResolvedValue({ error: null });
    const sb = { storage: { from: () => ({ remove }) } };
    await expect(removeObjectStrict(sb, "p")).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledWith(["p"]);
  });

  it("signCoverUrl returns null on error", async () => {
    const sb = {
      storage: {
        from: () => ({
          createSignedUrl: () => Promise.resolve({ data: null, error: { message: "e" } }),
        }),
      },
    };
    expect(await signCoverUrl(sb, "p")).toBeNull();
  });

  it("signCoverUrl returns url on success", async () => {
    const sb = {
      storage: {
        from: () => ({
          createSignedUrl: () =>
            Promise.resolve({ data: { signedUrl: "https://x/y" }, error: null }),
        }),
      },
    };
    expect(await signCoverUrl(sb, "p", 60)).toBe("https://x/y");
  });
});
