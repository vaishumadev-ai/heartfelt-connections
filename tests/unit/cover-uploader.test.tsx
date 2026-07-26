/* @vitest-environment jsdom */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Real UUID fixtures so buildCoverObjectPath's guards pass in tests.
const USER_ID = "11111111-1111-4111-8111-111111111111";
const COURSE_ID = "22222222-2222-4222-8222-222222222222";
const OLD_PATH = `${USER_ID}/${COURSE_ID}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png`;
const CURRENT_PATH = `${USER_ID}/${COURSE_ID}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png`;

// --- Mocks ------------------------------------------------------------------

vi.mock("@tanstack/react-start", async (o) => {
  const actual = (await o()) as Record<string, unknown>;
  return { ...actual, useServerFn: (fn: any) => fn };
});

// Track storage calls so we can assert ordering.
type Call = { op: "upload" | "remove" | "sign"; path?: string; paths?: string[] };
const storageCalls: Call[] = [];
const opLog: string[] = [];

const uploadImpl = vi.fn();
const removeImpl = vi.fn();
const signedImpl = vi.fn();
const getUserImpl = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: (...a: any[]) => getUserImpl(...a) },
    storage: {
      from: (_bucket: string) => ({
        upload: (path: string, file: File, opts: any) => {
          storageCalls.push({ op: "upload", path });
          opLog.push("upload");
          return uploadImpl(path, file, opts);
        },
        remove: (paths: string[]) => {
          storageCalls.push({ op: "remove", paths });
          opLog.push("remove");
          return removeImpl(paths);
        },
        createSignedUrl: (path: string, ttl: number) => {
          storageCalls.push({ op: "sign", path });
          opLog.push("sign");
          return signedImpl(path, ttl);
        },
      }),
    },
  },
}));

const attachFn = vi.fn();
const detachFn = vi.fn();
const limitsFn = vi.fn();
const signCoverPreviewFn = vi.fn();

vi.mock("@/lib/media.functions", () => ({
  getMediaLimits: (...a: any[]) => limitsFn(...a),
  attachCourseCover: (...a: any[]) => attachFn(...a),
  detachCourseCover: (...a: any[]) => detachFn(...a),
  signCoverPreview: (...a: any[]) => signCoverPreviewFn(...a),
}));

// Stub browser image decoding — jsdom's HTMLImageElement never fires load
// events without help, so we resolve the media-uploads decoder synchronously.
vi.mock("@/lib/media-uploads", async (o) => {
  const actual = (await o()) as Record<string, unknown>;
  return {
    ...actual,
    decodeImage: vi.fn(async () => ({ ok: true, width: 1600, height: 900, is16by9: true })),
  };
});

const createdBlobs: string[] = [];
const revokedBlobs: string[] = [];

beforeEach(() => {
  storageCalls.length = 0;
  opLog.length = 0;
  createdBlobs.length = 0;
  revokedBlobs.length = 0;
  uploadImpl.mockReset();
  removeImpl.mockReset();
  signedImpl.mockReset();
  getUserImpl.mockReset();
  attachFn.mockReset();
  detachFn.mockReset();
  limitsFn.mockReset();
  signCoverPreviewFn.mockReset();

  getUserImpl.mockResolvedValue({ data: { user: { id: USER_ID } } });
  limitsFn.mockResolvedValue({
    cover: {
      fileSizeLimit: 5 * 1024 * 1024,
      allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    },
    video: { fileSizeLimit: 50 * 1024 * 1024, allowedMimeTypes: ["video/mp4"] },
  });
  signCoverPreviewFn.mockResolvedValue({ url: "https://signed.example/current", expiresIn: 3600 });

  let n = 0;
  (globalThis.URL as any).createObjectURL = vi.fn(() => {
    const u = `blob:mock-${++n}`;
    createdBlobs.push(u);
    return u;
  });
  (globalThis.URL as any).revokeObjectURL = vi.fn((u: string) => {
    revokedBlobs.push(u);
  });
});

import { CoverUploader } from "@/components/studio/CoverUploader";

function pngFile(size = 1024, name = "art.png", type = "image/png"): File {
  return new File([new Uint8Array(size)], name, { type });
}

function mount(props?: Partial<React.ComponentProps<typeof CoverUploader>>) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={qc}>
      <CoverUploader
        courseId={COURSE_ID}
        isEditable
        coverStoragePath={null}
        legacyCoverUrl={null}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { qc, ...utils };
}

async function chooseFile(file: File) {
  const input = screen.getByLabelText("Choose a cover image") as HTMLInputElement;
  await userEvent.upload(input, file);
}

// ---------------------------------------------------------------------------
// Path security — UUID segments only, filename never enters the path
// ---------------------------------------------------------------------------
describe("cover path security", () => {
  it("upload path is <userUuid>/<courseUuid>/<uuid>.<ext> and never contains the original filename", async () => {
    uploadImpl.mockResolvedValue({ error: null });
    attachFn.mockResolvedValue({ ok: true, previousStoragePath: null });
    mount();
    await chooseFile(pngFile(1024, "MY-VERY-SECRET-NAME.png", "image/png"));

    await waitFor(() => expect(attachFn).toHaveBeenCalled());
    const uploadCall = storageCalls.find((c) => c.op === "upload");
    expect(uploadCall).toBeTruthy();
    const parts = uploadCall!.path!.split("/");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe(USER_ID);
    expect(parts[1]).toBe(COURSE_ID);
    expect(parts[2]).toMatch(/^[0-9a-f-]{36}\.png$/i);
    expect(uploadCall!.path).not.toContain("MY-VERY-SECRET-NAME");
  });

  it("rejects the non-standard image/jpg MIME string", async () => {
    mount();
    const input = screen.getByLabelText("Choose a cover image") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [pngFile(1024, "x.bin", "image/jpg")] } });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/JPEG, PNG, or WebP/));
    expect(uploadImpl).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Attach ordering + compensating cleanup
// ---------------------------------------------------------------------------
describe("attach ordering and compensating cleanup", () => {
  it("uploads strictly before attach", async () => {
    const order: string[] = [];
    uploadImpl.mockImplementation(async () => {
      order.push("upload");
      return { error: null };
    });
    attachFn.mockImplementation(async () => {
      order.push("attach");
      return { ok: true, previousStoragePath: null };
    });
    mount();
    await chooseFile(pngFile());
    await waitFor(() => expect(attachFn).toHaveBeenCalled());
    expect(order).toEqual(["upload", "attach"]);
  });

  it("replacement order: upload → attach → sign new preview → delete previous unreferenced object", async () => {
    uploadImpl.mockResolvedValue({ error: null });
    attachFn.mockResolvedValue({ ok: true, previousStoragePath: OLD_PATH });
    removeImpl.mockResolvedValue({ error: null });
    // Sign refresh after cache invalidation (course prop unchanged in this
    // mount so we assert the storage delete ordering only).

    mount({ coverStoragePath: CURRENT_PATH });
    await chooseFile(pngFile());
    await waitFor(() => expect(removeImpl).toHaveBeenCalled());

    // upload, then attach (via server fn), then remove(prev).
    const uploadIdx = opLog.indexOf("upload");
    const removeIdx = opLog.indexOf("remove");
    expect(uploadIdx).toBeGreaterThanOrEqual(0);
    expect(removeIdx).toBeGreaterThan(uploadIdx);
    // The remove must target ONLY the previous path.
    const removeCall = storageCalls.find((c) => c.op === "remove");
    expect(removeCall!.paths).toEqual([OLD_PATH]);
  });

  it("attach failure leaves existing cover attached and cleans up only the new path", async () => {
    uploadImpl.mockResolvedValue({ error: null });
    attachFn.mockRejectedValueOnce(new Error("policy denied"));
    removeImpl.mockResolvedValue({ error: null });

    mount({ coverStoragePath: CURRENT_PATH });
    await chooseFile(pngFile());

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/policy denied/));
    const upload = storageCalls.find((c) => c.op === "upload");
    const remove = storageCalls.find((c) => c.op === "remove");
    expect(remove!.paths).toEqual([upload!.path]);
    // The previously-attached cover path must NEVER appear in cleanup.
    for (const c of storageCalls) {
      if (c.op === "remove") expect(c.paths).not.toContain(CURRENT_PATH);
    }
  });

  it("attach OK but previous-object deletion fails → new cover attached, cleanup_pending shown, path never rendered", async () => {
    uploadImpl.mockResolvedValue({ error: null });
    attachFn.mockResolvedValue({ ok: true, previousStoragePath: OLD_PATH });
    removeImpl.mockResolvedValue({ error: { message: "acl denied" } });

    const { container } = mount({ coverStoragePath: CURRENT_PATH });
    await chooseFile(pngFile());

    const root = await waitFor(() => {
      const el = container.querySelector('[data-testid="cover-uploader-root"]') as HTMLElement;
      expect(el.getAttribute("data-state")).toBe("cleanup_pending");
      return el;
    });
    // Generic operator-safe copy — no raw path anywhere in the DOM.
    expect(root.textContent).toMatch(/older file still needs cleanup/i);
    expect(root.textContent).not.toContain(OLD_PATH);
    expect(root.innerHTML).not.toContain(OLD_PATH);
    // Retry cleanup targets only the recorded previous path.
    const before = storageCalls.filter((c) => c.op === "remove").length;
    removeImpl.mockResolvedValueOnce({ error: null });
    await userEvent.click(within(root).getByRole("button", { name: /retry cleanup/i }));
    await waitFor(() => expect(root.getAttribute("data-state")).toBe("idle"));
    const removes = storageCalls.filter((c) => c.op === "remove");
    expect(removes.length).toBe(before + 1);
    expect(removes[removes.length - 1].paths).toEqual([OLD_PATH]);
  });

  it("attach failure + cleanup failure surfaces cleanup_pending; retry targets only that recorded path", async () => {
    uploadImpl.mockResolvedValue({ error: null });
    attachFn.mockRejectedValueOnce(new Error("policy denied"));
    removeImpl
      .mockResolvedValueOnce({ error: { message: "storage boom" } })
      .mockResolvedValueOnce({ error: null });

    mount({ coverStoragePath: CURRENT_PATH });
    await chooseFile(pngFile());

    const root = await waitFor(() => {
      const el = document.querySelector('[data-testid="cover-uploader-root"]') as HTMLElement;
      expect(el.getAttribute("data-state")).toBe("cleanup_pending");
      return el;
    });
    // No path leakage in DOM.
    const uploadPath = storageCalls.find((c) => c.op === "upload")!.path!;
    expect(root.textContent).not.toContain(uploadPath);
    await userEvent.click(within(root).getByRole("button", { name: /retry cleanup/i }));
    await waitFor(() => expect(root.getAttribute("data-state")).toBe("idle"));
    const removeCalls = storageCalls.filter((c) => c.op === "remove");
    expect(removeCalls).toHaveLength(2);
    for (const c of removeCalls) expect(c.paths).toEqual([uploadPath]);
  });

  it("rapid Replace clicks start exactly one upload", async () => {
    let resolveUpload!: () => void;
    uploadImpl.mockImplementation(
      () => new Promise<{ error: null }>((r) => (resolveUpload = () => r({ error: null }))),
    );
    attachFn.mockResolvedValue({ ok: true, previousStoragePath: null });
    mount({ coverStoragePath: CURRENT_PATH });

    const input = screen.getByLabelText("Choose a cover image") as HTMLInputElement;
    await userEvent.upload(input, pngFile(1024, "a.png"));
    await userEvent.upload(input, pngFile(1024, "b.png"));

    expect(storageCalls.filter((c) => c.op === "upload")).toHaveLength(1);
    await act(async () => {
      resolveUpload();
    });
    await waitFor(() => expect(attachFn).toHaveBeenCalledTimes(1));
  });
});

// ---------------------------------------------------------------------------
// Removal — DB detach first, then compensating Storage delete
// ---------------------------------------------------------------------------
describe("cover removal with client-side compensating delete", () => {
  it("Cancel closes the dialog and performs no mutation", async () => {
    detachFn.mockResolvedValue({ ok: true, previousStoragePath: CURRENT_PATH });
    mount({ coverStoragePath: CURRENT_PATH });
    await userEvent.click(screen.getByRole("button", { name: /remove/i }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(detachFn).not.toHaveBeenCalled();
    expect(storageCalls.some((c) => c.op === "remove")).toBe(false);
  });

  it("Confirm calls detach first, then removes exactly the returned path from Storage", async () => {
    detachFn.mockResolvedValue({ ok: true, previousStoragePath: CURRENT_PATH });
    removeImpl.mockResolvedValue({ error: null });
    const order: string[] = [];
    detachFn.mockImplementation(async () => {
      order.push("detach");
      return { ok: true, previousStoragePath: CURRENT_PATH };
    });
    removeImpl.mockImplementation(async (paths: string[]) => {
      order.push(`remove:${paths.join(",")}`);
      return { error: null };
    });
    mount({ coverStoragePath: CURRENT_PATH });
    await userEvent.click(screen.getByRole("button", { name: /remove/i }));
    await userEvent.click(await screen.findByRole("button", { name: /remove cover/i }));
    await waitFor(() => expect(order).toEqual(["detach", `remove:${CURRENT_PATH}`]));
  });

  it("Detach failure keeps existing cover attached and does NOT touch Storage", async () => {
    detachFn.mockRejectedValue(new Error("not your course"));
    mount({ coverStoragePath: CURRENT_PATH });
    await userEvent.click(screen.getByRole("button", { name: /remove/i }));
    await userEvent.click(await screen.findByRole("button", { name: /remove cover/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/not your course/));
    expect(storageCalls.some((c) => c.op === "remove")).toBe(false);
  });

  it("Detach OK but Storage delete fails → DB detached, cleanup_pending visible, retry targets returned path once", async () => {
    detachFn.mockResolvedValue({ ok: true, previousStoragePath: CURRENT_PATH });
    removeImpl
      .mockResolvedValueOnce({ error: { message: "storage boom" } })
      .mockResolvedValueOnce({ error: null });

    mount({ coverStoragePath: CURRENT_PATH });
    await userEvent.click(screen.getByRole("button", { name: /remove/i }));
    await userEvent.click(await screen.findByRole("button", { name: /remove cover/i }));
    const root = await waitFor(() => {
      const el = document.querySelector('[data-testid="cover-uploader-root"]') as HTMLElement;
      expect(el.getAttribute("data-state")).toBe("cleanup_pending");
      return el;
    });
    // No path leakage.
    expect(root.textContent).not.toContain(CURRENT_PATH);
    // Retry
    await userEvent.click(within(root).getByRole("button", { name: /retry cleanup/i }));
    await waitFor(() => expect(root.getAttribute("data-state")).toBe("idle"));
    const removes = storageCalls.filter((c) => c.op === "remove");
    // First failed attempt + successful retry, both targeting only the prev.
    expect(removes).toHaveLength(2);
    for (const c of removes) expect(c.paths).toEqual([CURRENT_PATH]);
  });

  it("Locked (non-editable) courses cannot remove covers", async () => {
    mount({ isEditable: false, coverStoragePath: CURRENT_PATH });
    const remove = screen.getByRole("button", { name: /remove/i }) as HTMLButtonElement;
    expect(remove.disabled).toBe(true);
    await userEvent.click(remove);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(detachFn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Media validation (limits from DB, zero-byte, image decode)
// ---------------------------------------------------------------------------
describe("media validation", () => {
  it("blocks unsupported MIME", async () => {
    mount();
    const input = screen.getByLabelText("Choose a cover image") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [pngFile(1024, "x.gif", "image/gif")] } });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/JPEG, PNG, or WebP/));
    expect(uploadImpl).not.toHaveBeenCalled();
  });

  it("blocks zero-byte file", async () => {
    mount();
    await chooseFile(pngFile(0, "x.png", "image/png"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/empty/i));
    expect(uploadImpl).not.toHaveBeenCalled();
  });

  it("uses the DB-returned size limit — below succeeds, above fails", async () => {
    limitsFn.mockResolvedValue({
      cover: { fileSizeLimit: 2048, allowedMimeTypes: ["image/png"] },
      video: { fileSizeLimit: 1, allowedMimeTypes: [] },
    });
    uploadImpl.mockResolvedValue({ error: null });
    attachFn.mockResolvedValue({ ok: true, previousStoragePath: null });
    mount();
    await chooseFile(pngFile(4096, "big.png", "image/png"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/over/i));
    expect(uploadImpl).not.toHaveBeenCalled();

    // A file within the mocked limit succeeds.
    await chooseFile(pngFile(512, "ok.png", "image/png"));
    await waitFor(() => expect(uploadImpl).toHaveBeenCalled());
  });

  it("rejects a MIME absent from the DB allowlist even if it's in the compiled default", async () => {
    limitsFn.mockResolvedValue({
      cover: { fileSizeLimit: 5 * 1024 * 1024, allowedMimeTypes: ["image/png"] },
      video: { fileSizeLimit: 1, allowedMimeTypes: [] },
    });
    mount();
    const input = screen.getByLabelText("Choose a cover image") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [pngFile(1024, "x.jpg", "image/jpeg")] } });
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(uploadImpl).not.toHaveBeenCalled();
  });

  it("fails closed when limits are unavailable (no hardcoded UI drift)", async () => {
    limitsFn.mockRejectedValue(new Error("nope"));
    mount();
    await chooseFile(pngFile(1024, "x.png", "image/png"));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(uploadImpl).not.toHaveBeenCalled();
  });

  it("rejects an undecodable image", async () => {
    const mu = await import("@/lib/media-uploads");
    (mu.decodeImage as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      code: "undecodable_image",
    });
    mount();
    await chooseFile(pngFile());
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/decode/i));
    expect(uploadImpl).not.toHaveBeenCalled();
  });

  it("accepts a non-16:9 valid image without blocking", async () => {
    const mu = await import("@/lib/media-uploads");
    (mu.decodeImage as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      width: 800,
      height: 800,
      is16by9: false,
    });
    uploadImpl.mockResolvedValue({ error: null });
    attachFn.mockResolvedValue({ ok: true, previousStoragePath: null });
    mount();
    await chooseFile(pngFile());
    await waitFor(() => expect(uploadImpl).toHaveBeenCalled());
  });

  it("revokes optimistic blob URL on unmount", async () => {
    uploadImpl.mockImplementation(() => new Promise(() => {}));
    const { unmount } = mount();
    await chooseFile(pngFile());
    await waitFor(() => expect(createdBlobs.length).toBeGreaterThan(0));
    unmount();
    expect(revokedBlobs).toContain(createdBlobs[0]);
  });
});

// ---------------------------------------------------------------------------
// Attach argument authority — server derives MIME/size from Storage metadata
// ---------------------------------------------------------------------------
describe("attach RPC arguments", () => {
  it("attach payload contains only courseId and storagePath — no client-asserted MIME or size", async () => {
    uploadImpl.mockResolvedValue({ error: null });
    attachFn.mockResolvedValue({ ok: true, previousStoragePath: null });
    mount();
    await chooseFile(pngFile(1024, "x.png", "image/png"));
    await waitFor(() => expect(attachFn).toHaveBeenCalled());
    const payload = attachFn.mock.calls[0][0]?.data;
    expect(Object.keys(payload).sort()).toEqual(["courseId", "storagePath"]);
  });
});

// ---------------------------------------------------------------------------
// Signed preview
// ---------------------------------------------------------------------------
describe("signed cover preview", () => {
  it("a stale sign response for a prior storage path cannot replace the current preview", async () => {
    let resolveA!: (v: any) => void;
    signCoverPreviewFn.mockImplementationOnce(() => new Promise((r) => (resolveA = r)));
    signCoverPreviewFn.mockImplementationOnce(async () => ({
      url: "https://signed.example/B",
      expiresIn: 3600,
    }));

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const A_PATH = `${USER_ID}/${COURSE_ID}/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png`;
    const B_PATH = `${USER_ID}/${COURSE_ID}/dddddddd-dddd-4ddd-8ddd-dddddddddddd.png`;
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <CoverUploader courseId={COURSE_ID} isEditable coverStoragePath={A_PATH} legacyCoverUrl={null} />
      </QueryClientProvider>,
    );
    rerender(
      <QueryClientProvider client={qc}>
        <CoverUploader courseId={COURSE_ID} isEditable coverStoragePath={B_PATH} legacyCoverUrl={null} />
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect((screen.getByAltText(/cover preview/i) as HTMLImageElement).src).toBe(
        "https://signed.example/B",
      ),
    );
    await act(async () => {
      resolveA({ url: "https://signed.example/A-STALE", expiresIn: 3600 });
    });
    expect((screen.getByAltText(/cover preview/i) as HTMLImageElement).src).toBe(
      "https://signed.example/B",
    );
  });

  it("uses legacy cover_url only when cover_storage_path is absent", async () => {
    mount({ coverStoragePath: null, legacyCoverUrl: "https://cdn.example/legacy.png" });
    const img = screen.getByAltText(/cover preview/i) as HTMLImageElement;
    expect(img.src).toBe("https://cdn.example/legacy.png");
    expect(signCoverPreviewFn).not.toHaveBeenCalled();
  });

  it("icon fallback shows when neither storage path nor legacy url exists", () => {
    mount({ coverStoragePath: null, legacyCoverUrl: null });
    expect(screen.getByText(/no cover yet/i)).toBeInTheDocument();
    expect(signCoverPreviewFn).not.toHaveBeenCalled();
  });

  it("signed URL is not persisted in any query key", async () => {
    signCoverPreviewFn.mockResolvedValue({ url: "https://signed.example/secret", expiresIn: 3600 });
    const P = `${USER_ID}/${COURSE_ID}/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.png`;
    const { qc } = mount({ coverStoragePath: P });
    await waitFor(() =>
      expect((screen.getByAltText(/cover preview/i) as HTMLImageElement).src).toContain("secret"),
    );
    for (const q of qc.getQueryCache().getAll()) {
      expect(JSON.stringify(q.queryKey)).not.toContain("secret");
    }
  });
});

// ---------------------------------------------------------------------------
// Studio integration
// ---------------------------------------------------------------------------
describe("studio integration", () => {
  it("successful attach invalidates my-course, my-courses, and course-readiness", async () => {
    uploadImpl.mockResolvedValue({ error: null });
    attachFn.mockResolvedValue({ ok: true, previousStoragePath: null });
    const { qc } = mount();
    const spy = vi.spyOn(qc, "invalidateQueries");
    await chooseFile(pngFile());
    await waitFor(() => expect(attachFn).toHaveBeenCalled());
    const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(keys).toEqual(
      expect.arrayContaining([
        JSON.stringify(["my-course", COURSE_ID]),
        JSON.stringify(["my-courses"]),
        JSON.stringify(["course-readiness", COURSE_ID]),
      ]),
    );
  });

  it("successful detach invalidates my-course, my-courses, and course-readiness", async () => {
    detachFn.mockResolvedValue({ ok: true, previousStoragePath: null });
    const { qc } = mount({ coverStoragePath: CURRENT_PATH });
    const spy = vi.spyOn(qc, "invalidateQueries");
    await userEvent.click(screen.getByRole("button", { name: /remove/i }));
    await userEvent.click(await screen.findByRole("button", { name: /remove cover/i }));
    await waitFor(() => expect(detachFn).toHaveBeenCalled());
    const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(keys).toEqual(
      expect.arrayContaining([
        JSON.stringify(["my-course", COURSE_ID]),
        JSON.stringify(["my-courses"]),
        JSON.stringify(["course-readiness", COURSE_ID]),
      ]),
    );
  });

  it("locked course disables replace button", () => {
    mount({ isEditable: false });
    const replace = screen.getByRole("button", {
      name: /upload cover|replace cover/i,
    }) as HTMLButtonElement;
    expect(replace.disabled).toBe(true);
  });

  it("error surface uses stable copy, not raw storage/postgres codes", async () => {
    uploadImpl.mockResolvedValue({ error: null });
    attachFn.mockRejectedValue(new Error("policy denied"));
    removeImpl.mockResolvedValue({ error: null });
    mount({ coverStoragePath: CURRENT_PATH });
    await chooseFile(pngFile());
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    const alert = screen.getByRole("alert").textContent ?? "";
    expect(alert).not.toMatch(/42501/);
    expect(alert).not.toMatch(/postgrest|jwt|apikey/i);
  });
});

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------
describe("state machine visible transitions", () => {
  it("idle → validating → uploading → attaching → ready", async () => {
    let resolveUpload!: () => void;
    uploadImpl.mockImplementation(
      () => new Promise<{ error: null }>((r) => (resolveUpload = () => r({ error: null }))),
    );
    let resolveAttach!: (v: any) => void;
    attachFn.mockImplementation(() => new Promise((r) => (resolveAttach = r)));

    mount();
    const root = () => document.querySelector('[data-testid="cover-uploader-root"]') as HTMLElement;
    expect(root().getAttribute("data-state")).toBe("idle");

    await chooseFile(pngFile());
    await waitFor(() => expect(root().getAttribute("data-state")).toBe("uploading"));

    await act(async () => {
      resolveUpload();
    });
    await waitFor(() => expect(root().getAttribute("data-state")).toBe("attaching"));

    await act(async () => {
      resolveAttach({ ok: true, previousStoragePath: null });
    });
    await waitFor(() => expect(root().getAttribute("data-state")).toBe("ready"));
  });

  it("replace flow uses `replacing` state", async () => {
    uploadImpl.mockResolvedValue({ error: null });
    let resolveAttach!: (v: any) => void;
    attachFn.mockImplementation(() => new Promise((r) => (resolveAttach = r)));

    mount({ coverStoragePath: CURRENT_PATH });
    await chooseFile(pngFile());
    const root = document.querySelector('[data-testid="cover-uploader-root"]') as HTMLElement;
    await waitFor(() => expect(root.getAttribute("data-state")).toBe("replacing"));
    await act(async () => {
      resolveAttach({ ok: true, previousStoragePath: null });
    });
  });
});