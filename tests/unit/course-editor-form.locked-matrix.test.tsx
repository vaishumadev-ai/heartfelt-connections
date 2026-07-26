/* @vitest-environment jsdom */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...rest }: any) => <a {...rest}>{children}</a>,
  useNavigate: () => vi.fn(),
}));
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, useServerFn: (fn: any) => fn };
});
vi.mock("@/components/studio/CoverUploader", () => ({
  CoverUploader: (props: any) => (
    <div data-testid="cover-uploader">cover:{String(props.isEditable)}</div>
  ),
}));

const getMyCourse = vi.fn();
const updateCourse = vi.fn();
const submitCourseForReview = vi.fn();
const getCourseReadiness = vi.fn();
const upsertLesson = vi.fn();
const deleteLesson = vi.fn();
const reorderLessons = vi.fn();

vi.mock("@/lib/courses.functions", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/lib/courses.functions");
  return {
    ...actual,
    getMyCourse: (...a: any[]) => getMyCourse(...a),
    updateCourse: (...a: any[]) => updateCourse(...a),
    submitCourseForReview: (...a: any[]) => submitCourseForReview(...a),
    getCourseReadiness: (...a: any[]) => getCourseReadiness(...a),
    upsertLesson: (...a: any[]) => upsertLesson(...a),
    deleteLesson: (...a: any[]) => deleteLesson(...a),
    reorderLessons: (...a: any[]) => reorderLessons(...a),
  };
});

import { CourseEditorForm } from "@/components/studio/CourseEditorForm";

const COURSE_ID = "c-1";

function baseCourse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: COURSE_ID,
    slug: "example-course",
    title: "Existing title",
    subtitle: "Sub",
    description: "Desc",
    category: "Development",
    level: "Beginner",
    language: "English",
    duration_label: "3h",
    price_cents: 0,
    instructor_name: "Ada",
    instructor_title: "Author",
    instructor_bio: "Bio",
    learn_outcomes: ["a"],
    skills: ["b"],
    requirements: [],
    audience: [],
    faq: [],
    is_published: false,
    review_status: "draft",
    cover_storage_path: null,
    cover_url: null,
    ...overrides,
  };
}

function mount(initial: {
  course?: Record<string, unknown>;
  lessons?: Array<Record<string, unknown>>;
  readiness?: { is_ready: boolean; blockers: unknown[] };
}) {
  const course = initial.course ?? baseCourse();
  const lessons = initial.lessons ?? [];
  getMyCourse.mockResolvedValue({ course, lessons });
  getCourseReadiness.mockResolvedValue(initial.readiness ?? { is_ready: true, blockers: [] });
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  qc.setQueryData(["my-course", COURSE_ID], { course, lessons });
  return {
    qc,
    ...render(
      <QueryClientProvider client={qc}>
        <React.Suspense fallback={null}>
          <CourseEditorForm courseId={COURSE_ID} />
        </React.Suspense>
      </QueryClientProvider>,
    ),
  };
}

beforeEach(() => {
  getMyCourse.mockReset();
  updateCourse.mockReset();
  submitCourseForReview.mockReset();
  getCourseReadiness.mockReset();
  upsertLesson.mockReset();
  deleteLesson.mockReset();
  reorderLessons.mockReset();
});

function lesson(id: string, position: number, title = `L${id}`) {
  return {
    id,
    title,
    position,
    duration_seconds: null,
    content: null,
    video_url: null,
    is_preview: false,
    module_title: null,
  };
}

describe("Locked-state matrix", () => {
  it("draft: fields, Save (dirty), lesson controls enabled; rejection banner absent", async () => {
    mount({});
    const title = (await screen.findByLabelText("Title")) as HTMLInputElement;
    expect(title).not.toBeDisabled();
    fireEvent.change(title, { target: { value: "Renamed" } });
    expect(screen.getByRole("button", { name: /Save changes/i })).not.toBeDisabled();
    expect(screen.queryByText(/Reviewer feedback/i)).toBeNull();
    expect(screen.getByTestId("cover-uploader")).toHaveTextContent("cover:true");
  });

  it("rejected: editable and shows reviewer feedback", async () => {
    mount({
      course: baseCourse({
        review_status: "rejected",
        review_decision_reason: "Please expand description.",
      }),
    });
    const title = (await screen.findByLabelText("Title")) as HTMLInputElement;
    expect(title).not.toBeDisabled();
    expect(screen.getByText(/Reviewer feedback/i)).toBeInTheDocument();
    expect(screen.getByText(/Please expand description/i)).toBeInTheDocument();
    expect(screen.getByTestId("cover-uploader")).toHaveTextContent("cover:true");
  });

  it("pending_review: all mutations disabled, locked banner visible", async () => {
    mount({ course: baseCourse({ review_status: "pending_review" }) });
    const title = (await screen.findByLabelText("Title")) as HTMLInputElement;
    expect(title).toBeDisabled();
    expect(screen.getByLabelText("Category")).toBeDisabled();
    expect(screen.getByRole("button", { name: /Save changes/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Submit for review/i })).toBeDisabled();
    expect(screen.getByTestId("cover-uploader")).toHaveTextContent("cover:false");
    expect(screen.getByRole("status")).toHaveTextContent(/awaiting admin review/i);
  });

  it("approved (not yet published): locked with unpublish-for-edit banner", async () => {
    mount({ course: baseCourse({ review_status: "approved", is_published: false }) });
    await screen.findByLabelText("Title");
    expect(screen.getByLabelText("Title")).toBeDisabled();
    expect(screen.getByRole("button", { name: /Save changes/i })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(/unpublish it for edit/i);
  });

  it("published (approved + live): locked with unpublish-for-edit banner and controls disabled", async () => {
    mount({ course: baseCourse({ review_status: "approved", is_published: true }) });
    await screen.findByLabelText("Title");
    expect(screen.getByLabelText("Title")).toBeDisabled();
    expect(screen.getByRole("button", { name: /Save changes/i })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(/unpublish it for edit/i);
    expect(screen.getByTestId("cover-uploader")).toHaveTextContent("cover:false");
  });

  it("inconsistent (rejected + published) still shows a locked banner (fallback copy)", async () => {
    mount({ course: baseCourse({ review_status: "rejected", is_published: true }) });
    await screen.findByLabelText("Title");
    // isCourseEditable returns false for this inconsistent state → fallback banner.
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toBeDisabled();
  });

  it("locked state disables lesson Move Up/Down and Delete on every row", async () => {
    mount({
      course: baseCourse({ review_status: "pending_review" }),
      lessons: [lesson("a", 1, "First"), lesson("b", 2, "Second")],
    });
    await screen.findByLabelText("Title");
    expect(screen.getByRole("button", { name: /Move First down/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Move Second up/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Delete First/i })).toBeDisabled();
  });
});

describe("Readiness invalidation matrix", () => {
  it("invalidates course-readiness after a successful save", async () => {
    updateCourse.mockResolvedValue(undefined);
    const { qc } = mount({});
    const spy = vi.spyOn(qc, "invalidateQueries");
    const title = (await screen.findByLabelText("Title")) as HTMLInputElement;
    fireEvent.change(title, { target: { value: "New" } });
    await userEvent.click(screen.getByRole("button", { name: /Save changes/i }));
    await waitFor(() => expect(updateCourse).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        spy.mock.calls.some((c) => {
          const key = (c[0] as { queryKey?: unknown[] } | undefined)?.queryKey;
          return Array.isArray(key) && key[0] === "course-readiness";
        }),
      ).toBe(true),
    );
  });

  it("does NOT invalidate on failed save", async () => {
    updateCourse.mockRejectedValue(new Error("boom"));
    const { qc } = mount({});
    const spy = vi.spyOn(qc, "invalidateQueries");
    const title = (await screen.findByLabelText("Title")) as HTMLInputElement;
    fireEvent.change(title, { target: { value: "New" } });
    await userEvent.click(screen.getByRole("button", { name: /Save changes/i }));
    await waitFor(() =>
      expect(screen.getAllByText(/Something went wrong|please try/i).length).toBeGreaterThan(0),
    );
    expect(
      spy.mock.calls.some((c) => {
        const key = (c[0] as { queryKey?: unknown[] } | undefined)?.queryKey;
        return Array.isArray(key) && key[0] === "course-readiness";
      }),
    ).toBe(false);
  });

  it("invalidates course-readiness after successful lesson reorder", async () => {
    reorderLessons.mockResolvedValue({ ok: true });
    const { qc } = mount({
      lessons: [lesson("a", 1, "First"), lesson("b", 2, "Second")],
    });
    const spy = vi.spyOn(qc, "invalidateQueries");
    await screen.findByLabelText("Title");
    await userEvent.click(screen.getByRole("button", { name: /Move First down/i }));
    await waitFor(() => expect(reorderLessons).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        spy.mock.calls.some((c) => {
          const key = (c[0] as { queryKey?: unknown[] } | undefined)?.queryKey;
          return Array.isArray(key) && key[0] === "course-readiness";
        }),
      ).toBe(true),
    );
  });

  it("preserves dirty local edits when the course query refetches", async () => {
    const { qc } = mount({});
    const title = (await screen.findByLabelText("Title")) as HTMLInputElement;
    fireEvent.change(title, { target: { value: "Local dirty" } });
    // Background refetch delivers a different remote value; unsaved local
    // edit must NOT be clobbered.
    qc.setQueryData(["my-course", COURSE_ID], {
      course: baseCourse({ title: "Remote wins?" }),
      lessons: [],
    });
    await new Promise((r) => setTimeout(r, 20));
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Local dirty");
    expect(screen.getAllByText("Unsaved changes").length).toBeGreaterThan(0);
  });
});

describe("Responsive lesson row structure", () => {
  it("wraps long lesson titles with min-w-0 + break-words containers", async () => {
    mount({
      lessons: [
        lesson(
          "a",
          1,
          "An extraordinarily long lesson title that would otherwise horizontally overflow the mobile viewport at 360px",
        ),
      ],
    });
    await screen.findByLabelText("Title");
    const titleEl = screen.getByText(/extraordinarily long lesson title/i);
    expect(titleEl.className).toMatch(/break-words/);
    expect(titleEl.className).toMatch(/min-w-0/);
  });

  it("keeps the lesson row action cluster wrappable on narrow viewports", async () => {
    mount({
      lessons: [lesson("a", 1, "First"), lesson("b", 2, "Second")],
    });
    await screen.findByLabelText("Title");
    const moveUp = screen.getByRole("button", { name: /Move First up/i });
    // The immediate parent is the action cluster; the grandparent is the
    // row itself. Both must wrap on narrow widths.
    const actionRow = moveUp.parentElement!;
    expect(actionRow.className).toMatch(/flex-wrap/);
    expect(actionRow.parentElement!.className).toMatch(/flex-wrap/);
  });
});
