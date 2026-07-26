import { describe, it, expect, vi } from "vitest";
import {
  buildCoverObjectPath,
  bestEffortRemoveObject,
  COVER_ALLOWED_MIMES,
  COVER_MAX_BYTES,
  normalizeMime,
  signCoverUrl,
  uploadCoverToStorage,
  validateCoverFile,
} from "@/lib/media-uploads";

function fakeFile(size: number, type: string): File {
  return new File([new Uint8Array(size)], "x.bin", { type });
}

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

  it("rejects oversize files", () => {
    expect(validateCoverFile(fakeFile(COVER_MAX_BYTES + 1, "image/png"))).toEqual({
      ok: false,
      code: "file_too_large",
    });
  });

  it("accepts each allowed mime and normalizes image/jpg to image/jpeg", () => {
    for (const mime of COVER_ALLOWED_MIMES) {
      const r = validateCoverFile(fakeFile(2048, mime));
      expect(r.ok).toBe(true);
    }
    const j = validateCoverFile(fakeFile(2048, "image/jpg"));
    expect(j.ok).toBe(true);
    if (j.ok) expect(j.mime).toBe("image/jpeg");
  });

  it("normalizeMime is null for garbage", () => {
    expect(normalizeMime("")).toBeNull();
    expect(normalizeMime("application/pdf")).toBeNull();
  });

  it("buildCoverObjectPath scopes to user, course, ext and stamps time", () => {
    const p = buildCoverObjectPath({
      userId: "u1",
      courseId: "c1",
      ext: "png",
      now: 1_700_000_000_000,
    });
    expect(p).toBe("u1/c1/cover-1700000000000.png");
  });

  it("buildCoverObjectPath produces distinct paths across attempts", () => {
    const a = buildCoverObjectPath({ userId: "u", courseId: "c", ext: "jpg", now: 1 });
    const b = buildCoverObjectPath({ userId: "u", courseId: "c", ext: "jpg", now: 2 });
    expect(a).not.toBe(b);
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