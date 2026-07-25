/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
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
  Link: ({ children, to, params }: any) => (
    <a href={typeof to === "string" ? to : "#"} data-to={to} data-slug={params?.slug ?? ""}>
      {children}
    </a>
  ),
  useNavigate: () => navigateSpy,
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
    markLessonCompleteMock.mockImplementation(
      () => new Promise((r) => (resolve = r)),
    );
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
    expect(await screen.findByText(/paid access is not available yet/i)).toBeInTheDocument();
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
    // No lesson content leaks
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