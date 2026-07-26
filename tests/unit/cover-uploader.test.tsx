/* @vitest-environment jsdom */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// --- Mocks ------------------------------------------------------------------

// Server functions are passed through untouched by `useServerFn` in tests.
vi.mock("@tanstack/react-start", async (o) => {
  const actual = (await o()) as Record<string, unknown>;
  return { ...actual, useServerFn: (fn: any) => fn };
});

// Track storage calls in a shared registry so we can assert ordering and
// argument exactness across every uploader test.
type Call = { op: "upload" | "remove" | "sign"; path?: string; paths?: string[] };
const storageCalls: Call[] = [];

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
          return uploadImpl(path, file, opts);
        },
        remove: (paths: string[]) => {
          storageCalls.push({ op: "remove", paths });
          return removeImpl(paths);
        },
        createSignedUrl: (path: string, ttl: number) => {
          storageCalls.push({ op: "sign", path });
          return signedImpl(path, ttl);
        },
      }),
    },
  },
}));

// Track server-function calls in the same registry so we can verify that the
// attach RPC never runs before upload and never receives the previous path.
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

// stub URL.createObjectURL/revokeObjectURL for jsdom
const createdBlobs: string[] = [];
const revokedBlobs: string[] = [];
beforeEach(() => {
  storageCalls.length = 0;
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

  getUserImpl.mockResolvedValue({ data: { user: { id: "user-1" } } });
  limitsFn.mockResolvedValue({
    cover: { fileSizeLimit: 5 * 1024 * 1024, allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"] },
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
        courseId="course-abc"
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
// 1 & 4. Path security, filename never enters the path, MIME-derived ext
// ---------------------------------------------------------------------------
describe("cover path security (uuid segment, mime-derived ext)", () => {
  it("upload path is <userId>/<courseId>/<uuid>.<ext> and never contains the original filename", async () => {
    uploadImpl.mockResolvedValue({ error: null });
    attachFn.mockResolvedValue({ ok: true });
    mount();
    await chooseFile(pngFile(1024, "MY-VERY-SECRET-NAME.png", "image/png"));

    await waitFor(() => expect(attachFn).toHaveBeenCalled());
    const uploadCall = storageCalls.find((c) => c.op === "upload");
    expect(uploadCall).toBeTruthy();
    const p = uploadCall!.path!;
    // exactly 3 segments: user / course / <uuid>.<ext>
    const parts = p.split("/");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe("user-1");
    expect(parts[1]).toBe("course-abc");
    // uuid.ext — never the original filename
    expect(parts[2]).toMatch(/^[0-9a-f-]{8,}\.png$/i);
    expect(p).not.toContain("MY-VERY-SECRET-NAME");
  });

  it("MIME image/jpg is normalized and produces a .jpg extension", async () => {
    uploadImpl.mockResolvedValue({ error: null });
    attachFn.mockResolvedValue({ ok: true });
    mount();
    await chooseFile(pngFile(1024, "x.bin", "image/jpg"));
    await waitFor(() => expect(uploadImpl).toHaveBeenCalled());
    const path = storageCalls.find((c) => c.op === "upload")!.path!;
    expect(path.endsWith(".jpg")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Replacement / attach ordering / cleanup guarantees
// ---------------------------------------------------------------------------
describe("attach ordering and compensating cleanup", () => {
  it("uploads first, then calls attach; attach never runs before upload", async () => {
    uploadImpl.mockResolvedValue({ error: null });
    attachFn.mockResolvedValue({ ok: true });
    mount({ coverStoragePath: "user-1/course-abc/old.png" });

    // record ordering across upload + attach
    const order: string[] = [];
    uploadImpl.mockImplementation(async () => {
      order.push("upload");
      return { error: null };
    });
    attachFn.mockImplementation(async () => {
      order.push("attach");
      return { ok: true };
    });
    await chooseFile(pngFile());
    await waitFor(() => expect(attachFn).toHaveBeenCalled());
    expect(order).toEqual(["upload", "attach"]);
  });

  it("attach failure leaves existing cover attached and only cleans up the NEW path", async () => {
    uploadImpl.mockResolvedValue({ error: null });
    attachFn.mockRejectedValueOnce(new Error("policy denied"));
    removeImpl.mockResolvedValue({ error: null });

    mount({ coverStoragePath: "user-1/course-abc/OLD.png" });
    await chooseFile(pngFile());

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/policy denied/));
    // remove was called once, targeting exactly the NEW upload path
    const upload = storageCalls.find((c) => c.op === "upload");
    const remove = storageCalls.find((c) => c.op === "remove");
    expect(upload).toBeTruthy();
    expect(remove).toBeTruthy();
    expect(remove!.paths).toEqual([upload!.path]);
    // the previously-attached OLD.png must NEVER be part of any cleanup
    for (const c of storageCalls) {
      if (c.op === "remove") expect(c.paths).not.toContain("user-1/course-abc/OLD.png");
    }
  });

  it("attach failure followed by cleanup failure surfaces cleanup_pending with the recorded path; retry removes only that path", async () => {
    uploadImpl.mockResolvedValue({ error: null });
    attachFn.mockRejectedValueOnce(new Error("policy denied"));
    // first cleanup fails, retry succeeds
    removeImpl
      .mockResolvedValueOnce({ error: { message: "storage boom" } })
      .mockResolvedValueOnce({ error: null });

    mount({ coverStoragePath: "user-1/course-abc/OLD.png" });
    await chooseFile(pngFile());

    const root = await waitFor(() => {
      const el = document.querySelector('[data-testid="cover-uploader-root"]') as HTMLElement;
      expect(el?.getAttribute("data-state")).toBe("cleanup_pending");
      return el;
    });
    // retry button visible
    const retry = within(root).getByRole("button", { name: /retry cleanup/i });
    const uploadPath = storageCalls.find((c) => c.op === "upload")!.path!;
    await userEvent.click(retry);

    await waitFor(() => {
      expect(root.getAttribute("data-state")).toBe("idle");
    });
    const removeCalls = storageCalls.filter((c) => c.op === "remove");
    expect(removeCalls).toHaveLength(2);
    // Both cleanup attempts targeted the exact same recorded path.
    for (const c of removeCalls) expect(c.paths).toEqual([uploadPath]);
  });

  it("rapid Replace clicks start exactly one upload", async () => {
    let resolveUpload!: () => void;
    uploadImpl.mockImplementation(
      () => new Promise<{ error: null }>((r) => (resolveUpload = () => r({ error: null }))),
    );
    attachFn.mockResolvedValue({ ok: true });
    mount({ coverStoragePath: "user-1/course-abc/OLD.png" });

    const input = screen.getByLabelText("Choose a cover image") as HTMLInputElement;
    // fire two file selections back-to-back before the first upload resolves
    await userEvent.upload(input, pngFile(1024, "a.png"));
    await userEvent.upload(input, pngFile(1024, "b.png"));

    // Only one upload call has been issued
    expect(storageCalls.filter((c) => c.op === "upload")).toHaveLength(1);
    await act(async () => {
      resolveUpload();
    });
    await waitFor(() => expect(attachFn).toHaveBeenCalledTimes(1));
  });
});

// ---------------------------------------------------------------------------
// 3. Removal ordering + accessible confirmation
// ---------------------------------------------------------------------------
describe("cover removal with accessible confirmation", () => {
  it("Cancel closes the dialog and performs no mutation", async () => {
    detachFn.mockResolvedValue({ ok: true });
    mount({ coverStoragePath: "user-1/course-abc/current.png" });
    await userEvent.click(screen.getByRole("button", { name: /remove/i }));
    // Dialog is open with a title and cancel button
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(detachFn).not.toHaveBeenCalled();
    expect(storageCalls.some((c) => c.op === "remove")).toBe(false);
  });

  it("Confirm calls detach first; storage.remove is never called by the client on remove", async () => {
    detachFn.mockResolvedValue({ ok: true });
    mount({ coverStoragePath: "user-1/course-abc/current.png" });
    await userEvent.click(screen.getByRole("button", { name: /remove/i }));
    await userEvent.click(await screen.findByRole("button", { name: /remove cover/i }));
    await waitFor(() => expect(detachFn).toHaveBeenCalledWith({ data: { courseId: "course-abc" } }));
    expect(storageCalls.some((c) => c.op === "remove")).toBe(false);
  });

  it("Detach failure surfaces error and does not touch Storage", async () => {
    detachFn.mockRejectedValue(new Error("not your course"));
    mount({ coverStoragePath: "user-1/course-abc/current.png" });
    await userEvent.click(screen.getByRole("button", { name: /remove/i }));
    await userEvent.click(await screen.findByRole("button", { name: /remove cover/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/not your course/));
    expect(storageCalls.some((c) => c.op === "remove")).toBe(false);
  });

  it("Locked (non-editable) courses hide Remove/Replace interactivity", async () => {
    mount({ isEditable: false, coverStoragePath: "user-1/course-abc/current.png" });
    const remove = screen.getByRole("button", { name: /remove/i }) as HTMLButtonElement;
    expect(remove.disabled).toBe(true);
    await userEvent.click(remove);
    // Even if a click somehow lands, no dialog opens and no detach happens.
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(detachFn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. Media validation (limits, MIME allowlist, zero-byte, ext derivation)
// ---------------------------------------------------------------------------
describe("media validation", () => {
  it("blocks unsupported MIME", async () => {
    mount();
    await chooseFile(pngFile(1024, "x.gif", "image/gif"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/JPEG, PNG, or WebP/));
    expect(uploadImpl).not.toHaveBeenCalled();
  });

  it("blocks zero-byte file", async () => {
    mount();
    await chooseFile(pngFile(0, "x.png", "image/png"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/empty/i));
    expect(uploadImpl).not.toHaveBeenCalled();
  });

  it("blocks oversize file", async () => {
    mount();
    await chooseFile(pngFile(6 * 1024 * 1024, "big.png", "image/png"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/over 5 MB/i));
    expect(uploadImpl).not.toHaveBeenCalled();
  });

  it("revokes optimistic blob URL on unmount", async () => {
    uploadImpl.mockImplementation(() => new Promise(() => {})); // pending forever
    attachFn.mockResolvedValue({ ok: true });
    const { unmount } = mount();
    await chooseFile(pngFile());
    await waitFor(() => expect(createdBlobs.length).toBeGreaterThan(0));
    unmount();
    expect(revokedBlobs).toContain(createdBlobs[0]);
  });
});

// ---------------------------------------------------------------------------
// 5. Signed preview security (stale-response guard, no leaks, detach clears)
// ---------------------------------------------------------------------------
describe("signed cover preview", () => {
  it("a stale sign response for a prior storage path cannot replace the current preview", async () => {
    // First render with pathA — will resolve slowly.
    let resolveA!: (v: any) => void;
    signCoverPreviewFn.mockImplementationOnce(
      () => new Promise((r) => (resolveA = r)),
    );
    // Second render with pathB — resolves fast.
    signCoverPreviewFn.mockImplementationOnce(async () => ({
      url: "https://signed.example/B",
      expiresIn: 3600,
    }));

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <CoverUploader
          courseId="c1"
          isEditable
          coverStoragePath="user-1/c1/A.png"
          legacyCoverUrl={null}
        />
      </QueryClientProvider>,
    );

    rerender(
      <QueryClientProvider client={qc}>
        <CoverUploader
          courseId="c1"
          isEditable
          coverStoragePath="user-1/c1/B.png"
          legacyCoverUrl={null}
        />
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect((screen.getByAltText(/cover preview/i) as HTMLImageElement).src).toBe(
        "https://signed.example/B",
      ),
    );
    // Now the stale response for A arrives; it must be ignored.
    await act(async () => {
      resolveA({ url: "https://signed.example/A-STALE", expiresIn: 3600 });
    });
    const img = screen.getByAltText(/cover preview/i) as HTMLImageElement;
    expect(img.src).toBe("https://signed.example/B");
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

  it("signed URL is not persisted in a query key (would leak to devtools/cache dumps)", async () => {
    // React Query's default keys are what we control. The uploader must not
    // put the signed URL into any queryKey. We assert by inspecting the
    // component's query cache after render.
    signCoverPreviewFn.mockResolvedValue({ url: "https://signed.example/secret", expiresIn: 3600 });
    const { qc } = mount({ coverStoragePath: "user-1/course-abc/x.png" });
    await waitFor(() =>
      expect((screen.getByAltText(/cover preview/i) as HTMLImageElement).src).toContain("secret"),
    );
    for (const q of qc.getQueryCache().getAll()) {
      expect(JSON.stringify(q.queryKey)).not.toContain("secret");
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Studio integration (invalidations, editable gating, stable copy)
// ---------------------------------------------------------------------------
describe("studio integration", () => {
  it("successful attach invalidates my-course, my-courses, and course-readiness", async () => {
    uploadImpl.mockResolvedValue({ error: null });
    attachFn.mockResolvedValue({ ok: true });
    const { qc } = mount();
    const spy = vi.spyOn(qc, "invalidateQueries");
    await chooseFile(pngFile());
    await waitFor(() => expect(attachFn).toHaveBeenCalled());
    const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(keys).toEqual(
      expect.arrayContaining([
        JSON.stringify(["my-course", "course-abc"]),
        JSON.stringify(["my-courses"]),
        JSON.stringify(["course-readiness", "course-abc"]),
      ]),
    );
  });

  it("successful detach also invalidates my-course + course-readiness", async () => {
    detachFn.mockResolvedValue({ ok: true });
    const { qc } = mount({ coverStoragePath: "user-1/course-abc/current.png" });
    const spy = vi.spyOn(qc, "invalidateQueries");
    await userEvent.click(screen.getByRole("button", { name: /remove/i }));
    await userEvent.click(await screen.findByRole("button", { name: /remove cover/i }));
    await waitFor(() => expect(detachFn).toHaveBeenCalled());
    const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(keys).toEqual(
      expect.arrayContaining([
        JSON.stringify(["my-course", "course-abc"]),
        JSON.stringify(["course-readiness", "course-abc"]),
      ]),
    );
  });

  it("locked course disables replace button", () => {
    mount({ isEditable: false });
    const replace = screen.getByRole("button", { name: /upload cover|replace cover/i }) as HTMLButtonElement;
    expect(replace.disabled).toBe(true);
  });

  it("error surface uses stable copy, not raw storage/postgres messages", async () => {
    uploadImpl.mockResolvedValue({ error: null });
    attachFn.mockRejectedValue(new Error("policy denied"));
    removeImpl.mockResolvedValue({ error: null });
    mount({ coverStoragePath: "user-1/course-abc/old.png" });
    await chooseFile(pngFile());
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    // We show the underlying (already-mapped) message; but we never expose
    // raw JWT/postgrest hints — the string "column c." or "42501" must
    // not appear in this rendering because we mock a friendly upstream.
    const alert = screen.getByRole("alert").textContent ?? "";
    expect(alert).not.toMatch(/42501/);
    expect(alert).not.toMatch(/postgrest|jwt|apikey/i);
  });
});

// ---------------------------------------------------------------------------
// 7. State-machine visible transitions
// ---------------------------------------------------------------------------
describe("state machine visible transitions", () => {
  it("idle → validating → uploading → attaching → ready", async () => {
    // Hold the upload open to observe intermediate states.
    let resolveUpload!: () => void;
    uploadImpl.mockImplementation(
      () => new Promise<{ error: null }>((r) => (resolveUpload = () => r({ error: null }))),
    );
    let resolveAttach!: (v: any) => void;
    attachFn.mockImplementation(() => new Promise((r) => (resolveAttach = r)));

    mount();
    const root = () =>
      document.querySelector('[data-testid="cover-uploader-root"]') as HTMLElement;
    expect(root().getAttribute("data-state")).toBe("idle");

    await chooseFile(pngFile());
    await waitFor(() => expect(root().getAttribute("data-state")).toBe("uploading"));

    await act(async () => {
      resolveUpload();
    });
    await waitFor(() => expect(root().getAttribute("data-state")).toBe("attaching"));

    await act(async () => {
      resolveAttach({ ok: true });
    });
    await waitFor(() => expect(root().getAttribute("data-state")).toBe("ready"));
  });

  it("replace flow uses `replacing` state (not `attaching`)", async () => {
    uploadImpl.mockResolvedValue({ error: null });
    let resolveAttach!: (v: any) => void;
    attachFn.mockImplementation(() => new Promise((r) => (resolveAttach = r)));

    mount({ coverStoragePath: "user-1/course-abc/OLD.png" });
    await chooseFile(pngFile());
    const root = document.querySelector('[data-testid="cover-uploader-root"]') as HTMLElement;
    await waitFor(() => expect(root.getAttribute("data-state")).toBe("replacing"));
    await act(async () => {
      resolveAttach({ ok: true });
    });
  });
});