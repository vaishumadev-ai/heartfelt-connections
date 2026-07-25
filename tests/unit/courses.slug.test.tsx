/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// ---------- Module boundary mocks ----------

vi.mock("@tanstack/react-router", async () => {
  const React = await import("react");
  const navigateSpy = vi.fn();
  return {
    createFileRoute: () => (_config: unknown) => ({
      useParams: () => ({ slug: "test-slug" }),
    }),
    Link: ({
      children,
      to,
      params,
      className,
    }: {
      children?: React.ReactNode;
      to?: string;
      params?: Record<string, string>;
      className?: string;
    }) => (
      <a
        href={typeof to === "string" ? to : "#"}
        data-to={typeof to === "string" ? to : ""}
        data-slug={params?.slug ?? ""}
        className={className}
      >
        {children}
      </a>
    ),
    useNavigate: () => navigateSpy,
    notFound: () => new Error("notFound"),
    __navigateSpy: navigateSpy,
  };
});

vi.mock("@tanstack/react-start", () => ({
  useServerFn: <T,>(fn: T) => fn,
}));

vi.mock("@/components/CourseReviews", () => ({
  CourseReviews: () => <div data-testid="course-reviews" />,
}));

const listMyEnrollmentsMock = vi.fn();
const enrollInCourseMock = vi.fn();
const getCourseBySlugMock = vi.fn();

vi.mock("@/lib/courses.functions", () => ({
  getCourseBySlug: (...args: unknown[]) => getCourseBySlugMock(...args),
  listMyEnrollments: (...args: unknown[]) => listMyEnrollmentsMock(...args),
  enrollInCourse: (...args: unknown[]) => enrollInCourseMock(...args),
}));

const getUserMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getUser: (...a: unknown[]) => getUserMock(...a) } },
}));

// ---------- Fixture ----------

type Lesson = {
  id: string;
  title: string;
  position: number;
  duration_seconds: number | null;
  is_preview: boolean;
  module_title: string | null;
};

function makeCourse(overrides: Record<string, unknown> = {}) {
  const lessons: Lesson[] = [
    { id: "l1", title: "Intro", position: 1, duration_seconds: 300, is_preview: true, module_title: "Getting started" },
    { id: "l2", title: "Deep dive", position: 2, duration_seconds: 900, is_preview: false, module_title: "Getting started" },
    { id: "l3", title: "Advanced", position: 3, duration_seconds: 600, is_preview: false, module_title: "Advanced topics" },
  ];
  return {
    id: "course-1",
    slug: "test-slug",
    title: "Learning Design Foundations",
    subtitle: "Ship better UI",
    category: "Design",
    icon_kind: "pencil",
    price_cents: 0,
    duration_label: "6h",
    rating: 4.5,
    likes: 12,
    description: "About this course",
    cover_url: null,
    level: "Beginner",
    language: "English",
    learn_outcomes: ["A", "B"],
    skills: ["Figma"],
    requirements: ["Curiosity"],
    audience: ["Everyone"],
    faq: [{ q: "Q1", a: "A1" }],
    students_count: 100,
    instructor_name: "Ada",
    instructor_title: "Designer",
    instructor_bio: "Bio",
    certificate: true,
    lessons,
    related: [
      {
        id: "c2",
        slug: "other",
        title: "Related Course",
        subtitle: null,
        category: "Design",
        icon_kind: null,
        price_cents: 1999,
        duration_label: null,
        rating: 4,
        likes: 0,
      },
    ],
    reviews_count: 3,
    rating_breakdown: [
      { stars: 5, count: 2 },
      { stars: 4, count: 1 },
      { stars: 3, count: 0 },
      { stars: 2, count: 0 },
      { stars: 1, count: 0 },
    ],
    ...overrides,
  };
}

async function renderRoute(course = makeCourse()) {
  // Import module AFTER mocks are registered.
  const mod = await import("@/routes/courses.$slug");
  const CoursePage = mod.CoursePage;
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  qc.setQueryData(["course", "test-slug"], course);
  const utils = render(
    <QueryClientProvider client={qc}>
      <CoursePage />
    </QueryClientProvider>,
  );
  return { ...utils, qc };
}

function resolvedAuth(userId: string | null) {
  getUserMock.mockResolvedValue({ data: { user: userId ? { id: userId } : null }, error: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  listMyEnrollmentsMock.mockResolvedValue([]);
  enrollInCourseMock.mockResolvedValue({ ok: true });
  // default: unresolved auth (never resolves) so tests must opt in
  getUserMock.mockImplementation(() => new Promise(() => {}));
});

// ---------- Tests ----------

describe("Course route rendering", () => {
  it("renders hero, curriculum, related courses from cached data", async () => {
    resolvedAuth(null);
    await renderRoute();
    expect(await screen.findByRole("heading", { level: 1, name: /Learning Design Foundations/i })).toBeInTheDocument();
    expect(screen.getByText(/Ship better UI/)).toBeInTheDocument();
    expect(screen.getByText(/Getting started/)).toBeInTheDocument();
    expect(screen.getByText(/Advanced topics/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Related courses/i })).toBeInTheDocument();
    const related = screen.getByText(/Related Course/);
    expect(related.closest("a")).toHaveAttribute("data-to", "/courses/$slug");
    expect(related.closest("a")).toHaveAttribute("data-slug", "other");
  });
});

describe("CTA state machine + auth resolution + enrollment resolution", () => {
  it("shows loading CTA while auth is pending", async () => {
    // getUserMock stays pending (default)
    await renderRoute();
    const ctas = await screen.findAllByRole("button", { name: /Checking enrollment/i });
    expect(ctas.length).toBeGreaterThan(0);
    ctas.forEach((el) => expect(el).toBeDisabled());
  });

  it("guest: shows 'Sign in to enroll' when auth resolves without a user", async () => {
    resolvedAuth(null);
    await renderRoute();
    const links = await screen.findAllByRole("link", { name: /Sign in to enroll/i });
    expect(links.length).toBeGreaterThan(0);
    links.forEach((a) => expect(a).toHaveAttribute("data-to", "/auth"));
  });

  it("known + not enrolled: shows Enroll now and calls mutation", async () => {
    resolvedAuth("user-1");
    listMyEnrollmentsMock.mockResolvedValue([]);
    await renderRoute();
    const btns = await screen.findAllByRole("button", { name: /Enroll now/i });
    await userEvent.click(btns[0]);
    await waitFor(() => expect(enrollInCourseMock).toHaveBeenCalledTimes(1));
    expect(enrollInCourseMock).toHaveBeenCalledWith({ data: { courseId: "course-1" } });
  });

  it("known + enrolled: shows Continue learning linking to /learn/$slug", async () => {
    resolvedAuth("user-1");
    listMyEnrollmentsMock.mockResolvedValue([{ course: { id: "course-1" }, progress: 10 }]);
    await renderRoute();
    const cont = await screen.findAllByRole("link", { name: /Continue learning/i });
    expect(cont[0]).toHaveAttribute("data-to", "/learn/$slug");
    expect(cont[0]).toHaveAttribute("data-slug", "test-slug");
  });

  it("auth returns error: fail-closed Retry CTA (never guest)", async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: { message: "boom" } });
    await renderRoute();
    const retryBtns = await screen.findAllByRole("button", { name: /Retry/i });
    expect(retryBtns.length).toBeGreaterThan(0);
    // must NOT show guest CTA
    expect(screen.queryByRole("link", { name: /Sign in to enroll/i })).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent(/Couldn't check your enrollment/i);
  });

  it("auth promise rejection: fail-closed Retry (never guest, never infinite loading)", async () => {
    getUserMock.mockRejectedValue(new Error("network"));
    await renderRoute();
    const retryBtns = await screen.findAllByRole("button", { name: /Retry/i });
    expect(retryBtns.length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: /Sign in to enroll/i })).toBeNull();
  });
});

describe("Retry behavior", () => {
  it("retry after auth error re-runs auth then enrollment resolution", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: null }, error: { message: "x" } });
    // Second call succeeds
    getUserMock.mockResolvedValueOnce({ data: { user: { id: "user-1" } }, error: null });
    listMyEnrollmentsMock.mockResolvedValue([]);
    await renderRoute();
    const retry = (await screen.findAllByRole("button", { name: /Retry/i }))[0];
    await userEvent.click(retry);
    await waitFor(() => {
      expect(getUserMock).toHaveBeenCalledTimes(2);
    });
    await screen.findAllByRole("button", { name: /Enroll now/i });
  });

  it("retry after enrollment error refetches enrollments", async () => {
    resolvedAuth("user-1");
    listMyEnrollmentsMock.mockRejectedValueOnce(new Error("db down"));
    listMyEnrollmentsMock.mockResolvedValueOnce([]);
    await renderRoute();
    const retry = (await screen.findAllByRole("button", { name: /Retry/i }))[0];
    await userEvent.click(retry);
    await screen.findAllByRole("button", { name: /Enroll now/i });
    expect(listMyEnrollmentsMock).toHaveBeenCalledTimes(2);
  });
});

describe("Curriculum expansion", () => {
  it("initial state is all-collapsed; expand-all opens every module; collapse-all closes; individual toggles work; no controlled/uncontrolled warning", async () => {
    const warnSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    resolvedAuth(null);
    await renderRoute();
    const triggers = screen.getAllByRole("button", { name: /Module \d/i });
    expect(triggers.length).toBe(2);
    triggers.forEach((t) => expect(t).toHaveAttribute("aria-expanded", "false"));

    const toggle = screen.getByRole("button", { name: /Expand all/i });
    await userEvent.click(toggle);
    triggers.forEach((t) => expect(t).toHaveAttribute("aria-expanded", "true"));

    const collapse = screen.getByRole("button", { name: /Collapse all/i });
    await userEvent.click(collapse);
    triggers.forEach((t) => expect(t).toHaveAttribute("aria-expanded", "false"));

    // individual toggle
    await userEvent.click(triggers[0]);
    expect(triggers[0]).toHaveAttribute("aria-expanded", "true");
    expect(triggers[1]).toHaveAttribute("aria-expanded", "false");

    // keyboard Enter / Space
    triggers[1].focus();
    await userEvent.keyboard("{Enter}");
    expect(triggers[1]).toHaveAttribute("aria-expanded", "true");
    await userEvent.keyboard(" ");
    expect(triggers[1]).toHaveAttribute("aria-expanded", "false");

    // no controlled/uncontrolled React warning
    const controlledWarns = warnSpy.mock.calls.filter((args) =>
      String(args[0] ?? "").includes("controlled") && String(args[0] ?? "").includes("uncontrolled"),
    );
    expect(controlledWarns).toEqual([]);
    warnSpy.mockRestore();
  });
});

describe("Share behavior", () => {
  let originalShare: unknown;
  let originalClipboard: unknown;

  beforeEach(() => {
    originalShare = (navigator as unknown as { share?: unknown }).share;
    originalClipboard = (navigator as unknown as { clipboard?: unknown }).clipboard;
  });
  afterEach(() => {
    Object.defineProperty(navigator, "share", { configurable: true, value: originalShare });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: originalClipboard });
  });

  async function clickShare() {
    const btn = screen.getAllByRole("button", { name: /^Share$/ })[0];
    await userEvent.click(btn);
  }

  it("calls navigator.share with title and URL when Web Share is available", async () => {
    resolvedAuth(null);
    const shareSpy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { configurable: true, value: shareSpy });
    await renderRoute();
    await clickShare();
    expect(shareSpy).toHaveBeenCalledTimes(1);
    const arg = shareSpy.mock.calls[0][0];
    expect(arg.title).toMatch(/Learning Design Foundations/);
    expect(typeof arg.url).toBe("string");
  });

  it("silently ignores AbortError from Web Share", async () => {
    resolvedAuth(null);
    const err = Object.assign(new Error("cancel"), { name: "AbortError" });
    const shareSpy = vi.fn().mockRejectedValue(err);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { configurable: true, value: shareSpy });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    await renderRoute();
    await clickShare();
    expect(shareSpy).toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.queryByTestId("share-fallback")).toBeNull();
  });

  it("falls back to clipboard when Web Share fails for non-abort reasons", async () => {
    resolvedAuth(null);
    const shareSpy = vi.fn().mockRejectedValue(new Error("nope"));
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { configurable: true, value: shareSpy });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    await renderRoute();
    await clickShare();
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it("clipboard-only environment copies and shows success feedback", async () => {
    resolvedAuth(null);
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const { toast } = await import("sonner");
    await renderRoute();
    await clickShare();
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/copied/i));
  });

  it("neither API available: renders informational fallback with selectable URL and no uncaught exception", async () => {
    resolvedAuth(null);
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    await renderRoute();
    await expect(clickShare()).resolves.toBeUndefined();
    const fallback = await screen.findByTestId("share-fallback");
    const input = within(fallback).getByRole("textbox") as HTMLInputElement;
    expect(input.value).toMatch(/^https?:\/\//);
  });
});

describe("Related courses", () => {
  it("renders each related course as a link to /courses/$slug", async () => {
    resolvedAuth(null);
    await renderRoute();
    const rel = await screen.findByText(/Related Course/);
    const link = rel.closest("a")!;
    expect(link).toHaveAttribute("data-to", "/courses/$slug");
    expect(link).toHaveAttribute("data-slug", "other");
    // price rendering
    expect(within(link).getByText(/\$19\.99/)).toBeInTheDocument();
  });
});

describe("Paid course fixture (P0 documented: no checkout gate)", () => {
  it("renders price and Enroll now copy; route remains stable (no direct-enrollment assertion)", async () => {
    resolvedAuth("user-1");
    listMyEnrollmentsMock.mockResolvedValue([]);
    await renderRoute(makeCourse({ price_cents: 4999 }));
    // price rendered
    expect(await screen.findAllByText(/\$49\.99/)).not.toHaveLength(0);
    // CTA copy
    const enroll = await screen.findAllByRole("button", { name: /Enroll now/i });
    expect(enroll.length).toBeGreaterThan(0);
    // NOTE: intentionally does NOT click and assert a successful enrollment outcome.
    // The missing checkout gate is tracked as P0 outside this suite.
  });
});