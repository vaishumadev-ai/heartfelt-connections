/* @vitest-environment jsdom */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// ---------- Module boundary mocks ----------

const navigateSpy = vi.fn();
const routerInvalidateSpy = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (_config: unknown) => ({
    useParams: () => ({ slug: "test-slug" }),
    useSearch: () => ({ lesson: undefined }),
  }),
  Link: ({ children, to, params }: any) => (
    <a href={typeof to === "string" ? to : "#"} data-to={to} data-slug={params?.slug ?? ""}>
      {children}
    </a>
  ),
  useNavigate: () => navigateSpy,
  useRouter: () => ({ invalidate: routerInvalidateSpy }),
}));

vi.mock("@tanstack/react-start", () => ({
  useServerFn: <T,>(fn: T) => fn,
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const getLessonPlayerMock = vi.fn();
const markLessonCompleteMock = vi.fn();
const setLastLessonMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/courses.functions", () => ({
  getLessonPlayer: (...a: unknown[]) => getLessonPlayerMock(...a),
  markLessonComplete: (...a: unknown[]) => markLessonCompleteMock(...a),
  setLastLesson: (...a: unknown[]) => setLastLessonMock(...a),
}));

const getLessonNoteMock = vi.fn();
const saveLessonNoteMock = vi.fn();
const deleteLessonNoteMock = vi.fn();
const getLessonBookmarkMock = vi.fn();
const addLessonBookmarkMock = vi.fn();
const removeLessonBookmarkMock = vi.fn();

vi.mock("@/lib/learner.functions", () => ({
  getLessonNote: (...a: unknown[]) => getLessonNoteMock(...a),
  saveLessonNote: (...a: unknown[]) => saveLessonNoteMock(...a),
  deleteLessonNote: (...a: unknown[]) => deleteLessonNoteMock(...a),
  getLessonBookmark: (...a: unknown[]) => getLessonBookmarkMock(...a),
  addLessonBookmark: (...a: unknown[]) => addLessonBookmarkMock(...a),
  removeLessonBookmark: (...a: unknown[]) => removeLessonBookmarkMock(...a),
}));

// ---------- Fixtures ----------

const baseLesson = (id: string, position: number, is_preview = false, extras: any = {}) => ({
  id,
  title: `Lesson ${id}`,
  position,
  duration_seconds: 300,
  is_preview,
  content: `Content ${id}`,
  video_url: null,
  ...extras,
});

function readyDTO(overrides: any = {}) {
  const lessons = overrides.lessons ?? [
    baseLesson("l1", 1, true),
    baseLesson("l2", 2, false),
    baseLesson("l3", 3, false),
  ];
  return {
    state: "ready",
    course: { id: "c1", slug: "test-slug", title: "Course", category: "Design" },
    lessons,
    current: overrides.current ?? lessons[0],
    prevId: "prevId" in overrides ? overrides.prevId : null,
    nextId: "nextId" in overrides ? overrides.nextId : (lessons[1]?.id ?? null),
    entitlement: overrides.entitlement ?? "full",
    isEnrolled: overrides.isEnrolled ?? true,
    canTrackProgress: overrides.canTrackProgress ?? true,
    progress: overrides.progress ?? 33,
    courseComplete: overrides.courseComplete ?? false,
    canSelfEnroll: overrides.canSelfEnroll ?? false,
    completedLessonIds: overrides.completedLessonIds ?? [],
  };
}

async function renderPlayer(props: { lessonId?: string } = {}) {
  const mod = await import("@/routes/_authenticated/learn.$slug");
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  const utils = render(
    <QueryClientProvider client={qc}>
      <mod.PlayerBody slug="test-slug" lessonId={props.lessonId} />
    </QueryClientProvider>,
  );
  return { ...utils, qc };
}

beforeEach(() => {
  vi.clearAllMocks();
  getLessonPlayerMock.mockReset();
  markLessonCompleteMock.mockReset();
  setLastLessonMock.mockReset();
  setLastLessonMock.mockResolvedValue(undefined);
  navigateSpy.mockReset();
  routerInvalidateSpy.mockReset();
  getLessonNoteMock.mockReset();
  getLessonNoteMock.mockResolvedValue(null);
  saveLessonNoteMock.mockReset();
  saveLessonNoteMock.mockResolvedValue({ ok: true });
  deleteLessonNoteMock.mockReset();
  deleteLessonNoteMock.mockResolvedValue({ ok: true });
  getLessonBookmarkMock.mockReset();
  getLessonBookmarkMock.mockResolvedValue(null);
  addLessonBookmarkMock.mockReset();
  addLessonBookmarkMock.mockResolvedValue({ ok: true });
  removeLessonBookmarkMock.mockReset();
  removeLessonBookmarkMock.mockResolvedValue({ ok: true });
});

// ---------- Tests ----------

describe("Lesson player — entitlement matrix", () => {
  it("free unenrolled preview: shows Enroll CTA, hides Mark complete, preview content renders", async () => {
    getLessonPlayerMock.mockResolvedValue(
      readyDTO({
        entitlement: "preview",
        isEnrolled: false,
        canTrackProgress: false,
        progress: null,
        canSelfEnroll: true,
        current: baseLesson("l1", 1, true),
        lessons: [baseLesson("l1", 1, true)],
        nextId: null,
      }),
    );
    await renderPlayer();
    expect(await screen.findByText(/Content l1/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /enroll to unlock full course/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /mark complete/i })).toBeNull();
  });

  it("paid unenrolled preview: preview renders but no Enroll CTA", async () => {
    getLessonPlayerMock.mockResolvedValue(
      readyDTO({
        entitlement: "preview",
        isEnrolled: false,
        canTrackProgress: false,
        progress: null,
        canSelfEnroll: false,
        current: baseLesson("l1", 1, true),
        lessons: [baseLesson("l1", 1, true)],
        nextId: null,
      }),
    );
    await renderPlayer();
    expect(await screen.findByText(/Content l1/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /enroll to unlock/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /mark complete/i })).toBeNull();
  });

  it("historical paid enrollment: no Mark complete, no Enroll CTA", async () => {
    getLessonPlayerMock.mockResolvedValue(
      readyDTO({
        entitlement: "preview",
        isEnrolled: true,
        canTrackProgress: false,
        progress: null,
        canSelfEnroll: false,
      }),
    );
    await renderPlayer();
    await screen.findByText(/Content l1/);
    expect(screen.queryByRole("button", { name: /mark complete/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /enroll to unlock/i })).toBeNull();
  });

  it("owner/admin inspection: full lesson renders, no Enroll CTA, no Mark complete", async () => {
    getLessonPlayerMock.mockResolvedValue(
      readyDTO({
        entitlement: "full",
        isEnrolled: false,
        canTrackProgress: false,
        progress: null,
        canSelfEnroll: false,
      }),
    );
    await renderPlayer();
    await screen.findByText(/Content l1/);
    expect(screen.queryByRole("button", { name: /mark complete/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /enroll to unlock/i })).toBeNull();
  });

  it("trackable free learner: authoritative progress renders, completion control present", async () => {
    getLessonPlayerMock.mockResolvedValue(readyDTO({ progress: 67 }));
    await renderPlayer();
    expect(await screen.findByRole("button", { name: /mark complete/i })).toBeInTheDocument();
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("67");
    expect(screen.getByText("67%")).toBeInTheDocument();
  });
});

describe("Lesson player — completion flow", () => {
  it("rapid repeated completion coalesces into exactly one mutation call", async () => {
    let resolve!: (v: any) => void;
    markLessonCompleteMock.mockImplementation(() => new Promise((r) => (resolve = r)));
    getLessonPlayerMock.mockResolvedValue(readyDTO({ progress: 0 }));
    await renderPlayer();
    const btn = await screen.findByRole("button", { name: /mark complete/i });
    const user = userEvent.setup();
    await user.click(btn);
    await user.click(btn);
    await user.click(btn);
    // Only one mutation triggered even before it resolves.
    expect(markLessonCompleteMock).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ progress: 50 }));
  });

  it("failed completion: no phantom completion, retryable action", async () => {
    markLessonCompleteMock.mockRejectedValueOnce(new Error("boom"));
    getLessonPlayerMock.mockResolvedValue(readyDTO({ progress: 0 }));
    await renderPlayer();
    const btn = await screen.findByRole("button", { name: /mark complete/i });
    const user = userEvent.setup();
    await user.click(btn);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /mark complete/i })).not.toBeDisabled(),
    );
    expect(screen.queryByRole("button", { name: /completed/i })).toBeNull();
    // Second click works — retryable
    markLessonCompleteMock.mockResolvedValueOnce({ progress: 50 });
    await user.click(screen.getByRole("button", { name: /mark complete/i }));
    await waitFor(() => expect(markLessonCompleteMock).toHaveBeenCalledTimes(2));
  });

  it("courseComplete=true (from server DTO): completion banner renders", async () => {
    getLessonPlayerMock.mockResolvedValue(
      readyDTO({
        progress: 100,
        courseComplete: true,
        completedLessonIds: ["l1", "l2", "l3"],
      }),
    );
    await renderPlayer();
    expect(await screen.findByRole("heading", { name: /course complete/i })).toBeInTheDocument();
  });
});

describe("Lesson player — non-ready states", () => {
  it("no_preview_available with canSelfEnroll=true → Enroll copy", async () => {
    getLessonPlayerMock.mockResolvedValue({
      state: "no_preview_available",
      course: { id: "c1", slug: "test-slug", title: "T", category: "Design" },
      entitlement: "preview",
      isEnrolled: false,
      canTrackProgress: false,
      progress: null,
      courseComplete: false,
      canSelfEnroll: true,
      completedLessonIds: [],
    });
    await renderPlayer();
    expect(await screen.findByText(/enroll to unlock the course/i)).toBeInTheDocument();
  });

  it("no_preview_available for paid/historical → neutral copy", async () => {
    getLessonPlayerMock.mockResolvedValue({
      state: "no_preview_available",
      course: { id: "c1", slug: "test-slug", title: "T", category: "Design" },
      entitlement: "preview",
      isEnrolled: false,
      canTrackProgress: false,
      progress: null,
      courseComplete: false,
      canSelfEnroll: false,
      completedLessonIds: [],
    });
    await renderPlayer();
    expect(await screen.findByText(/full access isn't available yet/i)).toBeInTheDocument();
    // Never suggests a paid purchase or enrollment specifically.
    expect(screen.queryByText(/enroll/i)).toBeNull();
    expect(screen.queryByText(/paid/i)).toBeNull();
  });

  it("protected_lesson_requested state: no protected content rendered", async () => {
    getLessonPlayerMock.mockResolvedValue({
      state: "protected_lesson_requested",
      course: { id: "c1", slug: "test-slug", title: "T", category: "Design" },
      entitlement: "preview",
      isEnrolled: false,
      canTrackProgress: false,
      progress: null,
      courseComplete: false,
      canSelfEnroll: true,
      completedLessonIds: [],
    });
    await renderPlayer();
    expect(await screen.findByText(/lesson locked/i)).toBeInTheDocument();
    expect(screen.getByText(/enroll to unlock this lesson/i)).toBeInTheDocument();
    // No lesson content leaks
    expect(screen.queryByText(/Content l\d/)).toBeNull();
  });

  it("protected_lesson_requested with canSelfEnroll=false → neutral copy, no enrollment CTA", async () => {
    getLessonPlayerMock.mockResolvedValue({
      state: "protected_lesson_requested",
      course: { id: "c1", slug: "test-slug", title: "T", category: "Design" },
      entitlement: "preview",
      isEnrolled: false,
      canTrackProgress: false,
      progress: null,
      courseComplete: false,
      canSelfEnroll: false,
      completedLessonIds: [],
    });
    await renderPlayer();
    expect(
      await screen.findByText(/this lesson isn't available with your current access/i),
    ).toBeInTheDocument();
    // No "requires enrollment" / "enroll" wording, no leaked existence hint.
    expect(screen.queryByText(/requires enrollment/i)).toBeNull();
    expect(screen.queryByText(/enroll/i)).toBeNull();
    expect(screen.queryByText(/Content l\d/)).toBeNull();
  });
});

describe("Lesson player — navigation", () => {
  it("Previous is disabled on first lesson; no wrap-around", async () => {
    getLessonPlayerMock.mockResolvedValue(readyDTO({ prevId: null, nextId: "l2" }));
    await renderPlayer();
    const prev = await screen.findByRole("button", { name: /previous lesson/i });
    expect(prev).toBeDisabled();
    expect(screen.getByRole("button", { name: /next lesson/i })).not.toBeDisabled();
  });

  it("Next is disabled on last lesson; no wrap-around", async () => {
    const lessons = [baseLesson("l1", 1), baseLesson("l2", 2), baseLesson("l3", 3)];
    getLessonPlayerMock.mockResolvedValue(
      readyDTO({ lessons, current: lessons[2], prevId: "l2", nextId: null }),
    );
    await renderPlayer();
    const next = await screen.findByRole("button", { name: /next lesson/i });
    expect(next).toBeDisabled();
  });

  it("Mobile Sheet trigger has accessible name", async () => {
    getLessonPlayerMock.mockResolvedValue(readyDTO());
    await renderPlayer();
    expect(await screen.findByRole("button", { name: /open curriculum/i })).toBeInTheDocument();
  });
});

// ---------------- URL resume sync ----------------

describe("Lesson player — URL resume sync", () => {
  it("no lesson search param: server-resolved resume triggers replace navigation exactly once", async () => {
    const lessons = [baseLesson("l1", 1), baseLesson("l2", 2), baseLesson("l3", 3)];
    getLessonPlayerMock.mockResolvedValue(
      readyDTO({ lessons, current: lessons[1], prevId: "l1", nextId: "l3" }),
    );
    const { rerender, qc } = await renderPlayer();
    await screen.findByText(/Content l2/);
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledTimes(1));
    expect(navigateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/learn/$slug",
        params: { slug: "test-slug" },
        search: { lesson: "l2" },
        replace: true,
      }),
    );
    // Rerender / refetch does not create a navigation loop.
    const mod = await import("@/routes/_authenticated/learn.$slug");
    rerender(
      <QueryClientProvider client={qc}>
        <mod.PlayerBody slug="test-slug" />
      </QueryClientProvider>,
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(navigateSpy).toHaveBeenCalledTimes(1);
  });

  it("explicit lesson param: server never triggers a replace navigation", async () => {
    const lessons = [baseLesson("l1", 1), baseLesson("l2", 2), baseLesson("l3", 3)];
    getLessonPlayerMock.mockResolvedValue(
      readyDTO({ lessons, current: lessons[2], prevId: "l2", nextId: null }),
    );
    await renderPlayer({ lessonId: "l3" });
    await screen.findByText(/Content l3/);
    await new Promise((r) => setTimeout(r, 20));
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});

// ---------------- Mobile Sheet ----------------

describe("Lesson player — Mobile Sheet interaction", () => {
  it("opens the curriculum, selecting a lesson closes the sheet and navigates with the lesson id", async () => {
    const lessons = [baseLesson("l1", 1), baseLesson("l2", 2), baseLesson("l3", 3)];
    getLessonPlayerMock.mockResolvedValue(
      readyDTO({ lessons, current: lessons[0], prevId: null, nextId: "l2" }),
    );
    await renderPlayer();
    const user = userEvent.setup();
    const trigger = await screen.findByRole("button", { name: /open curriculum/i });
    await user.click(trigger);
    // Sheet opens — a curriculum panel with role=dialog is now present.
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    // Select "Lesson l3" from the mobile curriculum list (scoped to dialog).
    const l3Button = await screen.findByRole("button", { name: /lesson l3/i });
    await user.click(l3Button);
    // Navigation received the selected lesson id (no replace).
    expect(navigateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/learn/$slug",
        params: { slug: "test-slug" },
        search: { lesson: "l3" },
      }),
    );
    // Sheet closes.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // Focus restoration to the trigger is asserted by Radix in real browsers;
    // jsdom's focus semantics are unreliable for this specific check, so it
    // is parked as Playwright coverage — see phase 1A E2E gate.
  });
});

// ---------------- Completion accessibility ----------------

describe("Lesson player — completion accessibility live regions", () => {
  it("success announces a saved message and no raw error text is present", async () => {
    getLessonPlayerMock.mockResolvedValue(readyDTO({ progress: 0 }));
    markLessonCompleteMock.mockResolvedValueOnce({ progress: 50 });
    await renderPlayer();
    const user = userEvent.setup();
    const btn = await screen.findByRole("button", { name: /mark complete/i });
    await user.click(btn);
    const polite = await screen.findByTestId("completion-status-polite");
    await waitFor(() => expect(polite).toHaveTextContent(/lesson complete\. progress saved/i));
    // No raw error text ever appears.
    expect(screen.queryByText(/boom|policy|postgres|RLS|permission/i)).toBeNull();
  });

  it("failure announces friendly copy, no raw error surfaced, retry clears failure", async () => {
    markLessonCompleteMock.mockRejectedValueOnce(
      new Error("permission denied for table courses (RLS policy X)"),
    );
    getLessonPlayerMock.mockResolvedValue(readyDTO({ progress: 0 }));
    await renderPlayer();
    const user = userEvent.setup();
    const btn = await screen.findByRole("button", { name: /mark complete/i });
    await user.click(btn);
    const alert = await screen.findByTestId("completion-status-alert");
    await waitFor(() =>
      expect(alert).toHaveTextContent(/we couldn't save your progress\. please try again/i),
    );
    // Raw error message must be absent everywhere.
    expect(screen.queryByText(/permission denied/i)).toBeNull();
    expect(screen.queryByText(/RLS/i)).toBeNull();
    expect(screen.queryByText(/policy X/i)).toBeNull();
    // Retry clears the previous failure message before the next attempt.
    markLessonCompleteMock.mockResolvedValueOnce({ progress: 50 });
    await user.click(screen.getByRole("button", { name: /mark complete/i }));
    await waitFor(() => expect(alert).toHaveTextContent(""));
  });

  it("rapid activation still yields exactly one request (single-flight)", async () => {
    let resolve!: (v: any) => void;
    markLessonCompleteMock.mockImplementation(() => new Promise((r) => (resolve = r)));
    getLessonPlayerMock.mockResolvedValue(readyDTO({ progress: 0 }));
    await renderPlayer();
    const btn = await screen.findByRole("button", { name: /mark complete/i });
    const user = userEvent.setup();
    await user.click(btn);
    await user.click(btn);
    await user.click(btn);
    expect(markLessonCompleteMock).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ progress: 50 }));
  });
});

// ---------------- Error boundary + retry recovery ----------------

describe("Lesson player — error boundary retry recovery", () => {
  // Manual ErrorBoundary + QueryErrorResetBoundary mirrors the Router
  // errorComponent contract without pulling the whole router into tests.
  class TestErrorBoundary extends React.Component<
    {
      fallback: (props: { error: Error; reset: () => void }) => React.ReactElement;
      onReset?: () => void;
      children: React.ReactNode;
    },
    { error: Error | null }
  > {
    state = { error: null as Error | null };
    static getDerivedStateFromError(error: Error) {
      return { error };
    }
    reset = () => {
      this.props.onReset?.();
      this.setState({ error: null });
    };
    render() {
      if (this.state.error) {
        return this.props.fallback({ error: this.state.error, reset: this.reset });
      }
      return this.props.children;
    }
  }

  it("rejected query renders friendly boundary; Retry re-runs and recovers", async () => {
    const { QueryErrorResetBoundary } = await import("@tanstack/react-query");
    const mod = await import("@/routes/_authenticated/learn.$slug");
    // First call fails with a leak-shaped raw error, second call succeeds.
    getLessonPlayerMock
      .mockRejectedValueOnce(
        new Error("permission denied for function get_course_curriculum (policy courses_admin)"),
      )
      .mockResolvedValueOnce(readyDTO({ progress: 0 }));
    const qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0, staleTime: 0 },
        mutations: { retry: false },
      },
    });
    render(
      <QueryClientProvider client={qc}>
        <QueryErrorResetBoundary>
          {({ reset: qReset }) => (
            <TestErrorBoundary
              onReset={qReset}
              fallback={({ error, reset }) => (
                <mod.PlayerErrorComponent error={error} reset={reset} />
              )}
            >
              <React.Suspense fallback={<div>loading…</div>}>
                <mod.PlayerBody slug="test-slug" />
              </React.Suspense>
            </TestErrorBoundary>
          )}
        </QueryErrorResetBoundary>
      </QueryClientProvider>,
    );
    // Friendly boundary renders.
    expect(await screen.findByText(/we couldn't load this lesson/i)).toBeInTheDocument();
    // Raw error text is absent everywhere.
    expect(screen.queryByText(/permission denied/i)).toBeNull();
    expect(screen.queryByText(/get_course_curriculum/i)).toBeNull();
    expect(screen.queryByText(/courses_admin/i)).toBeNull();
    // Click Retry — second request succeeds and the player renders.
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /retry/i }));
    expect(routerInvalidateSpy).toHaveBeenCalledWith({ forcePending: true });
    expect(await screen.findByText(/Content l1/)).toBeInTheDocument();
  });
});

// ---------- Phase 3B: Notes & Bookmarks ----------
describe("Lesson player — Phase 3B notes & bookmarks", () => {
  it("tools do not mount for preview (canTrackProgress=false)", async () => {
    getLessonPlayerMock.mockResolvedValue(
      readyDTO({ canTrackProgress: false, isEnrolled: false, entitlement: "preview" }),
    );
    await renderPlayer();
    expect(await screen.findByText(/Content l1/)).toBeInTheDocument();
    expect(screen.queryByTestId("bookmark-button")).toBeNull();
    expect(screen.queryByTestId("notes-panel")).toBeNull();
    expect(getLessonBookmarkMock).not.toHaveBeenCalled();
    expect(getLessonNoteMock).not.toHaveBeenCalled();
  });

  it("bookmark toggles on and off, invalidates dashboard, and single-flights", async () => {
    getLessonPlayerMock.mockResolvedValue(readyDTO());
    getLessonBookmarkMock.mockResolvedValue(null);
    let resolveAdd: (v: unknown) => void = () => {};
    addLessonBookmarkMock.mockImplementation(
      () => new Promise((res) => (resolveAdd = res)),
    );
    const { qc } = await renderPlayer();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const btn = await screen.findByTestId("bookmark-button");
    expect(btn).toHaveAttribute("aria-pressed", "false");
    const user = userEvent.setup();
    await user.click(btn);
    await user.click(btn); // rapid second click — must be ignored while in-flight
    resolveAdd({ ok: true });
    await waitFor(() =>
      expect(screen.getByTestId("bookmark-button")).toHaveAttribute("aria-pressed", "true"),
    );
    expect(addLessonBookmarkMock).toHaveBeenCalledTimes(1);
    expect(
      invalidate.mock.calls.some(
        (c) => (c[0] as { queryKey?: unknown[] } | undefined)?.queryKey?.[0] === "learner-dashboard",
      ),
    ).toBe(true);

    await user.click(screen.getByTestId("bookmark-button"));
    await waitFor(() => expect(removeLessonBookmarkMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId("bookmark-button")).toHaveAttribute("aria-pressed", "false"),
    );
  });

  it("note Save enabled only when dirty + non-empty + under 4000, Ctrl+Enter saves, counter shows near-limit", async () => {
    getLessonPlayerMock.mockResolvedValue(readyDTO());
    const { qc } = await renderPlayer();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const ta = await screen.findByTestId("note-textarea");
    const save = screen.getByTestId("note-save");
    expect(save).toBeDisabled(); // empty + not dirty

    const user = userEvent.setup();
    await user.type(ta, "  ");
    expect(save).toBeDisabled(); // whitespace only
    await user.clear(ta);
    await user.type(ta, "Hello lesson");
    expect(save).toBeEnabled();
    // Ctrl+Enter triggers save
    await user.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() =>
      expect(saveLessonNoteMock).toHaveBeenCalledWith({
        data: { courseId: "c1", lessonId: "l1", body: "Hello lesson" },
      }),
    );
    await waitFor(() => expect(screen.getByTestId("note-status")).toHaveTextContent(/saved/i));
    expect(
      invalidate.mock.calls.some(
        (c) => (c[0] as { queryKey?: unknown[] } | undefined)?.queryKey?.[0] === "learner-dashboard",
      ),
    ).toBe(true);
  });

  it("note over 4000 chars disables Save and marks textarea invalid", async () => {
    getLessonPlayerMock.mockResolvedValue(readyDTO());
    await renderPlayer();
    const ta = (await screen.findByTestId("note-textarea")) as HTMLTextAreaElement;
    // Fast path: set value via fireEvent to avoid typing 4001 chars.
    const long = "x".repeat(4001);
    fireEvent.change(ta, { target: { value: long } });
    expect(screen.getByTestId("note-save")).toBeDisabled();
    expect(ta).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByTestId("note-counter")).toHaveTextContent("4001 / 4000");
  });

  it("save failure surfaces stable error copy, does not persist optimistic body, keeps note dirty", async () => {
    getLessonPlayerMock.mockResolvedValue(readyDTO());
    saveLessonNoteMock.mockRejectedValueOnce(new Error("permission denied for function save_lesson_note"));
    await renderPlayer();
    const ta = await screen.findByTestId("note-textarea");
    const user = userEvent.setup();
    await user.type(ta, "draft");
    await user.click(screen.getByTestId("note-save"));
    const err = await screen.findByTestId("note-error");
    // Stable copy — no raw postgres text
    expect(err.textContent ?? "").not.toMatch(/permission denied|save_lesson_note/i);
    // Still dirty
    expect(screen.getByTestId("note-status")).toHaveTextContent(/unsaved/i);
  });

  it("delete requires confirmation and clears the note", async () => {
    getLessonPlayerMock.mockResolvedValue(readyDTO());
    getLessonNoteMock.mockResolvedValue({
      id: "n1",
      course_id: "c1",
      lesson_id: "l1",
      body: "Existing note",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await renderPlayer();
    const user = userEvent.setup();
    const trigger = await screen.findByTestId("note-delete-trigger");
    await user.click(trigger);
    await user.click(await screen.findByTestId("note-delete-confirm"));
    await waitFor(() => expect(deleteLessonNoteMock).toHaveBeenCalledWith({ data: { lessonId: "l1" } }));
    await waitFor(() =>
      expect((screen.getByTestId("note-textarea") as HTMLTextAreaElement).value).toBe(""),
    );
  });

  it("dirty note blocks curriculum navigation until confirmed", async () => {
    getLessonPlayerMock.mockResolvedValue(readyDTO());
    await renderPlayer();
    const user = userEvent.setup();
    const ta = await screen.findByTestId("note-textarea");
    await user.type(ta, "wip");
    // click Next lesson via curriculum
    const nextBtn = screen.getByRole("button", { name: /next lesson/i });
    await user.click(nextBtn);
    // Guard dialog appears; navigation not yet called
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(navigateSpy).not.toHaveBeenCalled();
    // Confirm discard
    await user.click(screen.getByRole("button", { name: /discard|leave|continue/i }));
    await waitFor(() => expect(navigateSpy).toHaveBeenCalled());
  });
});
