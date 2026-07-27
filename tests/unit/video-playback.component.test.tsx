/* @vitest-environment jsdom */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// ---------- Module boundary mocks ----------

const navigateSpy = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (_config: unknown) => ({
    useParams: () => ({ slug: "test-slug" }),
    useSearch: () => ({ lesson: undefined }),
  }),
  Link: ({ children, to, params, onClick, ...rest }: any) => (
    <a
      href={typeof to === "string" ? to : "#"}
      data-to={to}
      data-slug={params?.slug ?? ""}
      onClick={onClick}
      {...rest}
    >
      {children}
    </a>
  ),
  useNavigate: () => navigateSpy,
  useRouter: () => ({ invalidate: vi.fn() }),
}));

vi.mock("@tanstack/react-start", () => ({
  useServerFn: <T,>(fn: T) => fn,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const getLessonPlayerMock = vi.fn();
const getLessonVideoUrlMock = vi.fn();
const markLessonCompleteMock = vi.fn();
const setLastLessonMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/courses.functions", () => ({
  getLessonPlayer: (...a: unknown[]) => getLessonPlayerMock(...a),
  markLessonComplete: (...a: unknown[]) => markLessonCompleteMock(...a),
  setLastLesson: (...a: unknown[]) => setLastLessonMock(...a),
  getLessonVideoUrl: (...a: unknown[]) => getLessonVideoUrlMock(...a),
}));

vi.mock("@/lib/learner.functions", () => ({
  getLessonNote: vi.fn().mockResolvedValue(null),
  saveLessonNote: vi.fn().mockResolvedValue({ ok: true }),
  deleteLessonNote: vi.fn().mockResolvedValue({ ok: true }),
  getLessonBookmark: vi.fn().mockResolvedValue(null),
  addLessonBookmark: vi.fn().mockResolvedValue({ ok: true }),
  removeLessonBookmark: vi.fn().mockResolvedValue({ ok: true }),
}));

// ---------- Fixtures ----------

const lessonWith = (id: string, has_video: boolean) => ({
  id,
  title: `Lesson ${id}`,
  position: 1,
  duration_seconds: 300,
  is_preview: false,
  content: `Content ${id}`,
  has_video,
});

function readyDTO(currentHasVideo: boolean) {
  const current = lessonWith("l1", currentHasVideo);
  return {
    state: "ready",
    course: { id: "c1", slug: "test-slug", title: "Course", category: "Design" },
    lessons: [current, lessonWith("l2", false)],
    current,
    prevId: null,
    nextId: "l2",
    entitlement: "full",
    isEnrolled: true,
    canTrackProgress: true,
    progress: 0,
    courseComplete: false,
    canSelfEnroll: false,
    completedLessonIds: [],
  };
}

async function renderPlayer(lessonId?: string) {
  const mod = await import("@/routes/_authenticated/learn.$slug");
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  const utils = render(
    <QueryClientProvider client={qc}>
      <mod.PlayerBody slug="test-slug" lessonId={lessonId} />
    </QueryClientProvider>,
  );
  return { ...utils, qc };
}

beforeEach(() => {
  vi.clearAllMocks();
  getLessonPlayerMock.mockReset();
  getLessonVideoUrlMock.mockReset();
  setLastLessonMock.mockReset();
  setLastLessonMock.mockResolvedValue(undefined);
  markLessonCompleteMock.mockReset();
});

// ============================================================

describe("LessonVideo — no-video lessons", () => {
  it("does NOT call getLessonVideoUrl for a lesson without video", async () => {
    getLessonPlayerMock.mockResolvedValue(readyDTO(false));
    await renderPlayer();
    await screen.findByText(/no video for this lesson/i);
    // Allow any microtasks to flush
    await new Promise((r) => setTimeout(r, 20));
    expect(getLessonVideoUrlMock).not.toHaveBeenCalled();
  });
});

describe("LessonVideo — signed URL lifecycle", () => {
  it("shows loading, then renders <video> with the signed URL on success", async () => {
    getLessonPlayerMock.mockResolvedValue(readyDTO(true));
    getLessonVideoUrlMock.mockResolvedValue({
      signedUrl: "https://signed.example/abc",
      expiresAt: Date.now() + 300_000,
    });
    await renderPlayer();
    await screen.findByTestId("video-loading");
    const el = (await screen.findByTestId("video-element")) as HTMLVideoElement;
    expect(el.getAttribute("src")).toBe("https://signed.example/abc");
    expect(getLessonVideoUrlMock).toHaveBeenCalledWith({
      data: { slug: "test-slug", lessonId: "l1" },
    });
  });

  it("signing failure shows stable failure state + manual Retry recovers", async () => {
    getLessonPlayerMock.mockResolvedValue(readyDTO(true));
    getLessonVideoUrlMock.mockRejectedValueOnce(new Error("boom secret path leaked"));
    getLessonVideoUrlMock.mockResolvedValueOnce({
      signedUrl: "https://signed.example/ok",
      expiresAt: Date.now() + 300_000,
    });
    await renderPlayer();
    const failed = await screen.findByTestId("video-failed");
    // No raw error text is exposed to the user.
    expect(failed.textContent ?? "").not.toMatch(/boom|secret|leaked/i);
    // Manual retry re-runs signing.
    await userEvent.setup().click(screen.getByTestId("video-retry"));
    const el = (await screen.findByTestId("video-element")) as HTMLVideoElement;
    expect(el.getAttribute("src")).toBe("https://signed.example/ok");
  });

  it("stale signing response for a previous lesson does not overwrite the current URL", async () => {
    // First render: lesson l1, deferred signing.
    getLessonPlayerMock.mockImplementation((args: any) => {
      const wanted = args?.data?.lessonId ?? "l1";
      const lessons = [lessonWith("l1", true), lessonWith("l2", true)];
      const current = lessons.find((l) => l.id === wanted) ?? lessons[0];
      return Promise.resolve({
        state: "ready",
        course: { id: "c1", slug: "test-slug", title: "Course", category: "Design" },
        lessons,
        current,
        prevId: current.id === "l1" ? null : "l1",
        nextId: current.id === "l1" ? "l2" : null,
        entitlement: "full",
        isEnrolled: true,
        canTrackProgress: true,
        progress: 0,
        courseComplete: false,
        canSelfEnroll: false,
        completedLessonIds: [],
      });
    });
    let resolveL1!: (v: any) => void;
    getLessonVideoUrlMock.mockImplementation((args: any) => {
      if (args?.data?.lessonId === "l1") {
        return new Promise((r) => (resolveL1 = r));
      }
      return Promise.resolve({
        signedUrl: "https://signed.example/L2",
        expiresAt: Date.now() + 300_000,
      });
    });
    const mod = await import("@/routes/_authenticated/learn.$slug");
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
    });
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <mod.PlayerBody slug="test-slug" lessonId="l1" />
      </QueryClientProvider>,
    );
    await screen.findByTestId("video-loading");
    // Swap to lesson l2 before l1's signing resolves.
    rerender(
      <QueryClientProvider client={qc}>
        <mod.PlayerBody slug="test-slug" lessonId="l2" />
      </QueryClientProvider>,
    );
    const el = (await screen.findByTestId("video-element")) as HTMLVideoElement;
    expect(el.getAttribute("src")).toBe("https://signed.example/L2");
    // Now let l1's stale sign resolve — MUST NOT touch the DOM.
    await act(async () => {
      resolveL1({ signedUrl: "https://signed.example/STALE_L1", expiresAt: Date.now() + 300_000 });
    });
    expect((screen.getByTestId("video-element") as HTMLVideoElement).getAttribute("src")).toBe(
      "https://signed.example/L2",
    );
    expect(screen.queryByDisplayValue("https://signed.example/STALE_L1")).toBeNull();
  });
});

describe("LessonVideo — refresh & auto-retry with fake timers", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it("refreshes the signed URL ~30s before expiry and cleans up on unmount", async () => {
    getLessonPlayerMock.mockResolvedValue(readyDTO(true));
    const now = Date.now();
    getLessonVideoUrlMock.mockResolvedValueOnce({
      signedUrl: "https://signed.example/first",
      expiresAt: now + 60_000, // 60s TTL for fast test
    });
    getLessonVideoUrlMock.mockResolvedValueOnce({
      signedUrl: "https://signed.example/second",
      expiresAt: now + 120_000,
    });

    const { unmount } = await renderPlayer();
    await screen.findByTestId("video-element");
    expect(getLessonVideoUrlMock).toHaveBeenCalledTimes(1);

    // Advance to (expiresAt - 30s) → refresh fires.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });
    await waitFor(() => expect(getLessonVideoUrlMock).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect((screen.getByTestId("video-element") as HTMLVideoElement).getAttribute("src")).toBe(
        "https://signed.example/second",
      ),
    );

    // Unmount clears any pending refresh timer — no further calls even after
    // large advances.
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(getLessonVideoUrlMock).toHaveBeenCalledTimes(2);
  });

  it("auto-retries signing exactly once on <video> error; a second error surfaces stable failure", async () => {
    getLessonPlayerMock.mockResolvedValue(readyDTO(true));
    getLessonVideoUrlMock.mockResolvedValue({
      signedUrl: "https://signed.example/v",
      expiresAt: Date.now() + 300_000,
    });
    await renderPlayer();
    const el = (await screen.findByTestId("video-element")) as HTMLVideoElement;
    expect(getLessonVideoUrlMock).toHaveBeenCalledTimes(1);

    // First media error → automatic re-sign (call #2).
    fireEvent.error(el);
    await waitFor(() => expect(getLessonVideoUrlMock).toHaveBeenCalledTimes(2));
    const el2 = (await screen.findByTestId("video-element")) as HTMLVideoElement;

    // Second media error → NO further automatic sign; stable failure surfaces.
    fireEvent.error(el2);
    await screen.findByTestId("video-failed");
    expect(getLessonVideoUrlMock).toHaveBeenCalledTimes(2);

    // Manual Retry re-arms the auto-retry budget: exactly one more sign call.
    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTimeAsync })
      .click(screen.getByTestId("video-retry"));
    await waitFor(() => expect(getLessonVideoUrlMock).toHaveBeenCalledTimes(3));
  });
});

describe("LessonVideo — playback does not mutate completion", () => {
  it("firing <video> ended does not call markLessonComplete", async () => {
    getLessonPlayerMock.mockResolvedValue(readyDTO(true));
    getLessonVideoUrlMock.mockResolvedValue({
      signedUrl: "https://signed.example/v",
      expiresAt: Date.now() + 300_000,
    });
    await renderPlayer();
    const el = (await screen.findByTestId("video-element")) as HTMLVideoElement;
    fireEvent.ended(el);
    await new Promise((r) => setTimeout(r, 20));
    expect(markLessonCompleteMock).not.toHaveBeenCalled();
  });
});

describe("LessonVideo — no leakage of signed URLs or storage paths", () => {
  it("signed URL is NEVER used in the query cache, router search, or console", async () => {
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    getLessonPlayerMock.mockResolvedValue(readyDTO(true));
    const signed = "https://signed.example/URL_TOKEN_SHOULD_NOT_LEAK";
    getLessonVideoUrlMock.mockResolvedValue({
      signedUrl: signed,
      expiresAt: Date.now() + 300_000,
    });
    const { qc } = await renderPlayer();
    await screen.findByTestId("video-element");
    // Query cache should not include the signed URL as a key or key part.
    const keys = qc
      .getQueryCache()
      .getAll()
      .map((q) => JSON.stringify(q.queryKey));
    for (const k of keys) expect(k).not.toContain("URL_TOKEN_SHOULD_NOT_LEAK");
    // No console logging of the signed URL.
    const consoleCalls = [
      ...consoleErr.mock.calls.flat(),
      ...consoleLog.mock.calls.flat(),
      ...consoleWarn.mock.calls.flat(),
    ]
      .map((c) => (typeof c === "string" ? c : JSON.stringify(c)))
      .join("\n");
    expect(consoleCalls).not.toContain("URL_TOKEN_SHOULD_NOT_LEAK");
    // Router navigation never receives the URL.
    for (const call of navigateSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain("URL_TOKEN_SHOULD_NOT_LEAK");
    }
    consoleErr.mockRestore();
    consoleLog.mockRestore();
    consoleWarn.mockRestore();
  });
});
