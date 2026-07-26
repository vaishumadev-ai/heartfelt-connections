/* @vitest-environment jsdom */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const COURSE_ID = "22222222-2222-4222-8222-222222222222";
const LESSON_ID = "33333333-3333-4333-8333-333333333333";

vi.mock("@tanstack/react-start", async (o) => {
  const actual = (await o()) as Record<string, unknown>;
  return { ...actual, useServerFn: (fn: any) => fn };
});

const getUserImpl = vi.fn();
const getSessionImpl = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getUser: (...a: any[]) => getUserImpl(...a),
      getSession: (...a: any[]) => getSessionImpl(...a),
    },
  },
}));

const attachFn = vi.fn();
const detachFn = vi.fn();
const limitsFn = vi.fn();
const signFn = vi.fn();

vi.mock("@/lib/media.functions", () => ({
  getMediaLimits: (...a: any[]) => limitsFn(...a),
  attachLessonVideo: (...a: any[]) => attachFn(...a),
  detachLessonVideo: (...a: any[]) => detachFn(...a),
  signLessonVideoUrl: (...a: any[]) => signFn(...a),
}));

import { VideoUploader, __setTusDriver, type TusDriverOptions } from "@/components/studio/VideoUploader";
import { UnsavedGuardProvider } from "@/components/lesson-tools/UnsavedGuard";

// Configurable fake driver — captures options, exposes hooks so tests can
// drive onProgress/onSuccess/onError manually.
type DriverCapture = {
  opts: TusDriverOptions | null;
  aborted: number;
};
let capture: DriverCapture;

function installFakeDriver(opts?: { autoSuccess?: boolean; error?: Error }) {
  __setTusDriver((o) => {
    capture.opts = o;
    if (opts?.error) {
      queueMicrotask(() => o.onError(opts.error!));
    } else if (opts?.autoSuccess !== false) {
      queueMicrotask(() => {
        o.onProgress(50, 100);
        o.onProgress(100, 100);
        o.onSuccess();
      });
    }
    return {
      start: () => {},
      abort: () => {
        capture.aborted++;
      },
    };
  });
}

beforeEach(() => {
  capture = { opts: null, aborted: 0 };
  __setTusDriver(null);
  getUserImpl.mockResolvedValue({ data: { user: { id: USER_ID } } });
  getSessionImpl.mockResolvedValue({ data: { session: { access_token: "tok-abc" } } });
  limitsFn.mockResolvedValue({
    cover: { fileSizeLimit: 5 * 1024 * 1024, allowedMimeTypes: ["image/png"] },
    video: {
      fileSizeLimit: 50 * 1024 * 1024,
      allowedMimeTypes: ["video/mp4", "video/webm"],
    },
  });
  signFn.mockResolvedValue({ url: "https://signed.example/vid", expiresIn: 3600 });
  attachFn.mockReset();
  detachFn.mockReset();
  attachFn.mockResolvedValue({ ok: true });
  detachFn.mockResolvedValue({ ok: true });
  (import.meta as any).env = {
    ...(import.meta as any).env,
    VITE_SUPABASE_URL: "https://proj.supabase.co",
    VITE_SUPABASE_PUBLISHABLE_KEY: "pub_key",
  };
});

function mp4(size = 1024, name = "clip.mp4", type = "video/mp4"): File {
  return new File([new Uint8Array(size)], name, { type });
}

function mount(props?: Partial<React.ComponentProps<typeof VideoUploader>>) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <UnsavedGuardProvider>
        <VideoUploader
          lessonId={LESSON_ID}
          courseId={COURSE_ID}
          isEditable
          videoStoragePath={null}
          {...props}
        />
      </UnsavedGuardProvider>
    </QueryClientProvider>,
  );
}

async function choose(file: File) {
  const input = screen.getByLabelText("Choose a lesson video") as HTMLInputElement;
  await userEvent.upload(input, file);
}

describe("VideoUploader — upload happy path", () => {
  it("validates, uploads via TUS, then attaches", async () => {
    installFakeDriver({ autoSuccess: true });
    mount();
    await choose(mp4());
    await waitFor(() => expect(attachFn).toHaveBeenCalled());
    const args = attachFn.mock.calls[0][0];
    expect(args.data.lessonId).toBe(LESSON_ID);
    expect(args.data.storagePath).toMatch(
      new RegExp(`^${USER_ID}/${COURSE_ID}/[0-9a-f-]{36}\\.mp4$`, "i"),
    );
  });

  it("passes the caller's access token and correct bucket to TUS config", async () => {
    installFakeDriver({ autoSuccess: false });
    mount();
    await choose(mp4());
    await waitFor(() => expect(capture.opts).toBeTruthy());
    const cfg = capture.opts!.config as any;
    expect(cfg.endpoint).toContain("/storage/v1/upload/resumable");
    expect(cfg.chunkSize).toBe(6 * 1024 * 1024);
    expect(cfg.headers.Authorization).toBe("Bearer tok-abc");
    expect(cfg.metadata.bucketName).toBe("course-videos");
    expect(cfg.metadata.contentType).toBe("video/mp4");
  });

  it("Storage path never contains the original filename", async () => {
    installFakeDriver({ autoSuccess: true });
    mount();
    await choose(mp4(1024, "PRIVATE-secret-name.mp4"));
    await waitFor(() => expect(attachFn).toHaveBeenCalled());
    const path = attachFn.mock.calls[0][0].data.storagePath as string;
    expect(path).not.toContain("PRIVATE");
    expect(path).not.toContain("secret");
  });
});

describe("VideoUploader — validation", () => {
  it("rejects unsupported MIME (mov/ogg) with a stable message", async () => {
    mount();
    const input = screen.getByLabelText("Choose a lesson video") as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File([new Uint8Array(10)], "x.mov", { type: "video/quicktime" })] },
    });
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(attachFn).not.toHaveBeenCalled();
  });

  it("rejects oversize file per DB-driven limit", async () => {
    limitsFn.mockResolvedValue({
      cover: { fileSizeLimit: 1, allowedMimeTypes: ["image/png"] },
      video: { fileSizeLimit: 1024, allowedMimeTypes: ["video/mp4"] },
    });
    mount();
    // Give limits query a chance to resolve.
    await waitFor(() => expect(limitsFn).toHaveBeenCalled());
    await choose(mp4(4096));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(attachFn).not.toHaveBeenCalled();
  });
});

describe("VideoUploader — failure paths and cleanup", () => {
  it("shows a stable error when TUS reports failure and does NOT attach", async () => {
    installFakeDriver({ error: new Error("network dropped") });
    mount();
    await choose(mp4());
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/network dropped/));
    expect(attachFn).not.toHaveBeenCalled();
  });

  it("cancel aborts the TUS upload with termination", async () => {
    // Never-resolving upload — hold in "uploading".
    installFakeDriver({ autoSuccess: false });
    mount();
    await choose(mp4());
    // Wait for uploading state.
    await waitFor(() => expect(capture.opts).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: /cancel upload/i }));
    expect(capture.aborted).toBeGreaterThanOrEqual(1);
  });
});

describe("VideoUploader — remove", () => {
  it("confirm dialog → detach RPC", async () => {
    mount({ videoStoragePath: `${USER_ID}/${COURSE_ID}/${LESSON_ID}/aaaa.mp4` });
    await userEvent.click(screen.getByRole("button", { name: /remove lesson video/i }));
    await userEvent.click(screen.getByRole("button", { name: /remove video/i }));
    await waitFor(() => expect(detachFn).toHaveBeenCalled());
    expect(detachFn.mock.calls[0][0].data.lessonId).toBe(LESSON_ID);
  });
});

describe("VideoUploader — locked state", () => {
  it("disables all controls when not editable", () => {
    mount({ isEditable: false, videoStoragePath: `${USER_ID}/${COURSE_ID}/${LESSON_ID}/x.mp4` });
    expect((screen.getByLabelText("Choose a lesson video") as HTMLInputElement).disabled).toBe(true);
    expect(
      (screen.getByRole("button", { name: /replace video/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: /remove lesson video/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe("VideoUploader — private path never in DOM", () => {
  it("does not render the storage path text anywhere", async () => {
    const path = `${USER_ID}/${COURSE_ID}/${LESSON_ID}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mp4`;
    mount({ videoStoragePath: path });
    // Wait for the sign call to resolve so the video element mounts.
    await waitFor(() => expect(signFn).toHaveBeenCalled());
    expect(document.body.textContent ?? "").not.toContain(path);
  });
});

// Silence unused import warning if act removed later.
void act;