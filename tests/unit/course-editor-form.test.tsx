/* @vitest-environment jsdom */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
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

// Cover section is exercised in its own suite; here it's a marker.
vi.mock("@/components/studio/CoverUploader", () => ({
  CoverUploader: (props: any) => <div data-testid="cover-uploader">cover:{String(props.isEditable)}</div>,
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
  getCourseReadiness.mockResolvedValue(
    initial.readiness ?? { is_ready: true, blockers: [] },
  );
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  qc.setQueryData(["my-course", COURSE_ID], { course, lessons });
  return render(
    <QueryClientProvider client={qc}>
      <React.Suspense fallback={null}>
        <CourseEditorForm courseId={COURSE_ID} />
      </React.Suspense>
    </QueryClientProvider>,
  );
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

describe("CourseEditorForm", () => {
  it("hydrates baseline fields from initial course", async () => {
    mount({});
    expect((await screen.findByLabelText("Title")) as HTMLInputElement).toHaveValue(
      "Existing title",
    );
    // Slug is rendered read-only; find it by its exact current value.
    expect(screen.getByDisplayValue("example-course")).toHaveAttribute("readonly");
  });

  it("marks unsaved changes on edit and clears back to clean when reverted", async () => {
    mount({});
    const title = (await screen.findByLabelText("Title")) as HTMLInputElement;
    fireEvent.change(title, { target: { value: "Existing title!" } });
    await waitFor(() =>
      expect(screen.getAllByText("Unsaved changes").length).toBeGreaterThan(0),
    );
    fireEvent.change(title, { target: { value: "Existing title" } });
    await waitFor(() =>
      expect(screen.queryAllByText("Unsaved changes")).toHaveLength(0),
    );
  });

  it("saves via the strict update whitelist and returns to saved state", async () => {
    updateCourse.mockResolvedValue(undefined);
    mount({});
    const title = (await screen.findByLabelText("Title")) as HTMLInputElement;
    fireEvent.change(title, { target: { value: "Renamed" } });
    await userEvent.click(screen.getByRole("button", { name: /Save changes/i }));
    await waitFor(() => expect(updateCourse).toHaveBeenCalledTimes(1));
    const payload = updateCourse.mock.calls[0][0].data;
    expect(payload.courseId).toBe(COURSE_ID);
    expect(payload.title).toBe("Renamed");
    expect(payload).not.toHaveProperty("slug");
    expect(payload).not.toHaveProperty("id");
    await waitFor(() =>
      expect(screen.getAllByText("Saved").length).toBeGreaterThan(0),
    );
  });

  it("collapses rapid Save clicks into a single in-flight request", async () => {
    let resolveUpdate: (() => void) | null = null;
    updateCourse.mockImplementation(
      () => new Promise<void>((r) => (resolveUpdate = () => r())),
    );
    mount({});
    const title = (await screen.findByLabelText("Title")) as HTMLInputElement;
    fireEvent.change(title, { target: { value: "Existing title!" } });
    const btn = screen.getByRole("button", { name: /Save changes/i });
    await userEvent.click(btn);
    // Additional clicks while saving must not re-fire updateCourse.
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(updateCourse).toHaveBeenCalledTimes(1);
    act(() => resolveUpdate!());
    await waitFor(() =>
      expect(screen.getAllByText("Saved").length).toBeGreaterThan(0),
    );
  });

  it("shows a failure banner and preserves the user's edits when save fails", async () => {
    updateCourse.mockRejectedValue(new Error("network down"));
    mount({});
    const title = (await screen.findByLabelText("Title")) as HTMLInputElement;
    fireEvent.change(title, { target: { value: "Dirty value" } });
    await userEvent.click(screen.getByRole("button", { name: /Save changes/i }));
    await waitFor(() => expect(screen.getAllByText(/Something went wrong|network|please try/i).length).toBeGreaterThan(0));
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Dirty value");
    expect(screen.getByRole("button", { name: /Save changes/i })).not.toBeDisabled();
  });

  it("disables Submit while dirty and enables once saved and ready", async () => {
    updateCourse.mockResolvedValue(undefined);
    mount({});
    const submit = screen.getByRole("button", { name: /Submit for review/i });
    await waitFor(() => expect(submit).not.toBeDisabled());
    const title = (await screen.findByLabelText("Title")) as HTMLInputElement;
    fireEvent.change(title, { target: { value: "Existing title!" } });
    expect(submit).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: /Save changes/i }));
    await waitFor(() => expect(submit).not.toBeDisabled());
  });

  it("renders backend readiness blockers when not ready", async () => {
    mount({
      readiness: {
        is_ready: false,
        blockers: [{ code: "missing_title", severity: "critical", message: "Add a title" }],
      },
    });
    await screen.findByLabelText("Title");
    expect(screen.getByRole("button", { name: /Submit for review/i })).toBeDisabled();
  });

  it("locks all inputs and hides Save when the course is pending review", async () => {
    mount({
      course: baseCourse({ review_status: "pending_review" }),
    });
    const title = (await screen.findByLabelText("Title")) as HTMLInputElement;
    expect(title).toBeDisabled();
    expect(screen.getByRole("button", { name: /Save changes/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Submit for review/i })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(/awaiting admin review/i);
  });

  it("passes editable state through to the CoverUploader section", async () => {
    mount({});
    expect(await screen.findByTestId("cover-uploader")).toHaveTextContent("cover:true");
  });

  it("does not send slug when saving (regression)", async () => {
    updateCourse.mockResolvedValue(undefined);
    mount({});
    const title = (await screen.findByLabelText("Title")) as HTMLInputElement;
    fireEvent.change(title, { target: { value: "Existing title!" } });
    await userEvent.click(screen.getByRole("button", { name: /Save changes/i }));
    await waitFor(() => expect(updateCourse).toHaveBeenCalled());
    const payload = updateCourse.mock.calls[0][0].data;
    expect(Object.keys(payload).sort()).toEqual(
      [
        "audience",
        "category",
        "courseId",
        "description",
        "duration_label",
        "faq",
        "instructor_bio",
        "instructor_name",
        "instructor_title",
        "language",
        "learn_outcomes",
        "level",
        "price_cents",
        "requirements",
        "skills",
        "subtitle",
        "title",
      ].sort(),
    );
  });

  it("shows a stable fail-closed banner when submit surfaces course_not_ready", async () => {
    submitCourseForReview.mockResolvedValue({
      ok: false,
      code: "course_not_ready",
      blockers: [
        {
          code: "missing_title",
          severity: "critical",
          group: "basics",
          message: "Add a title",
          target: "field-title",
        },
      ],
    });
    mount({});
    await screen.findByLabelText("Title");
    await userEvent.click(screen.getByRole("button", { name: /Submit for review/i }));
    await waitFor(() => expect(submitCourseForReview).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Submit for review/i })).toBeDisabled(),
    );
  });
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

describe("CourseEditorForm — lesson reorder (P0C.2c-1)", () => {
  it("renders lessons sorted by position and disables Move Up on the first, Move Down on the last", async () => {
    mount({
      lessons: [lesson("b", 2, "Second"), lesson("a", 1, "First"), lesson("c", 3, "Third")],
    });
    await screen.findByLabelText("Title");
    expect(screen.getByRole("button", { name: /Move First up/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Move First down/i })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /Move Third up/i })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /Move Third down/i })).toBeDisabled();
  });

  it("sends the complete lesson ID set in the requested order on Move Down", async () => {
    reorderLessons.mockResolvedValue({ ok: true });
    mount({
      lessons: [lesson("a", 1, "First"), lesson("b", 2, "Second"), lesson("c", 3, "Third")],
    });
    await screen.findByLabelText("Title");
    await userEvent.click(screen.getByRole("button", { name: /Move First down/i }));
    await waitFor(() => expect(reorderLessons).toHaveBeenCalledTimes(1));
    const payload = reorderLessons.mock.calls[0][0].data;
    expect(payload.courseId).toBe(COURSE_ID);
    expect(payload.lessonIds).toEqual(["b", "a", "c"]);
  });

  it("swaps neighbors on Move Up", async () => {
    reorderLessons.mockResolvedValue({ ok: true });
    mount({
      lessons: [lesson("a", 1, "First"), lesson("b", 2, "Second"), lesson("c", 3, "Third")],
    });
    await screen.findByLabelText("Title");
    await userEvent.click(screen.getByRole("button", { name: /Move Third up/i }));
    await waitFor(() => expect(reorderLessons).toHaveBeenCalledTimes(1));
    expect(reorderLessons.mock.calls[0][0].data.lessonIds).toEqual(["a", "c", "b"]);
  });

  it("does not send a permanent optimistic order — a failed reorder shows a stable error and does not repeat the mutation", async () => {
    reorderLessons.mockRejectedValue(new Error("network down"));
    mount({
      lessons: [lesson("a", 1, "First"), lesson("b", 2, "Second")],
    });
    await screen.findByLabelText("Title");
    await userEvent.click(screen.getByRole("button", { name: /Move First down/i }));
    await waitFor(() =>
      expect(
        screen.getAllByText(/Something went wrong|please try/i).length,
      ).toBeGreaterThan(0),
    );
    expect(reorderLessons).toHaveBeenCalledTimes(1);
  });

  it("collapses rapid Move clicks into a single in-flight reorder mutation", async () => {
    let resolve: (() => void) | null = null;
    reorderLessons.mockImplementation(
      () => new Promise<{ ok: true }>((r) => (resolve = () => r({ ok: true }))),
    );
    mount({
      lessons: [lesson("a", 1, "First"), lesson("b", 2, "Second"), lesson("c", 3, "Third")],
    });
    await screen.findByLabelText("Title");
    const btn = screen.getByRole("button", { name: /Move First down/i });
    await userEvent.click(btn);
    // Additional clicks while the reorder is in-flight must not re-fire.
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(reorderLessons).toHaveBeenCalledTimes(1);
    act(() => resolve!());
    await waitFor(() => expect(reorderLessons).toHaveBeenCalledTimes(1));
  });

  it("disables both move buttons on every row while a course is not editable", async () => {
    mount({
      course: baseCourse({ review_status: "pending_review" }),
      lessons: [lesson("a", 1, "First"), lesson("b", 2, "Second")],
    });
    await screen.findByLabelText("Title");
    expect(screen.getByRole("button", { name: /Move First down/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Move Second up/i })).toBeDisabled();
  });
});