/* @vitest-environment jsdom */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// --- Mocks ---------------------------------------------------------------

const approveMock = vi.fn();
const rejectMock = vi.fn();
const unpublishMock = vi.fn();

vi.mock("@tanstack/react-start", () => ({
  useServerFn: (fn: any) => fn,
}));

vi.mock("@tanstack/react-router", async () => {
  const React = await import("react");
  return {
    createFileRoute: () => (config: any) => ({
      options: config,
      useParams: () => ({ courseId: "c1" }),
    }),
    Link: ({ children, to, params, search, ...rest }: any) =>
      React.createElement(
        "a",
        {
          href: typeof to === "string" ? to : "#",
          "data-to": typeof to === "string" ? to : "",
          "data-slug": params?.slug ?? "",
          "data-search": search ? JSON.stringify(search) : "",
          ...rest,
        },
        children,
      ),
    useNavigate: () => vi.fn(),
  };
});

vi.mock("@/lib/courses.functions", () => ({
  getAdminCourse: vi.fn(async () => course),
  unpublishForEdit: (...a: any[]) => unpublishMock(...a),
  approveCourse: (...a: any[]) => approveMock(...a),
  rejectCourse: (...a: any[]) => rejectMock(...a),
  mapCourseGovernanceError: (e: any) => e?.message ?? "err",
}));

let course: any;

import { Route as AdminRoute } from "@/routes/_authenticated/admin.courses.$courseId";

function renderWith(qc: QueryClient) {
  const Component: any = (AdminRoute as any).options.component;
  return render(
    React.createElement(QueryClientProvider, { client: qc }, React.createElement(Component, null)),
  );
}

function makeQc() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["admin-course", "c1"], course);
  return qc;
}

beforeEach(() => {
  approveMock.mockReset();
  rejectMock.mockReset();
  unpublishMock.mockReset();
  course = {
    id: "c1",
    slug: "sample-course",
    title: "Sample course",
    subtitle: null,
    category: "Development",
    description: null,
    instructor_id: "i1",
    instructor_name: "Ada",
    is_published: false,
    review_status: "pending_review",
    review_decision_reason: null,
    price_cents: 0,
    enrollments_count: 0,
    completions_count: 0,
    reviews_count: 0,
    can_unpublish: false,
    updated_at: new Date().toISOString(),
    lessons: [],
  };
});

describe("Admin course detail — P0D review actions", () => {
  it("shows pending-review actions and both View public page + Preview lessons links", () => {
    renderWith(makeQc());
    expect(screen.getAllByText(/Pending review/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Approve & publish/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Reject with reason/i })).toBeTruthy();
    const publicLink = screen.getByRole("link", { name: /View public page/i }) as HTMLAnchorElement;
    expect(publicLink.getAttribute("target")).toBe("_blank");
    expect(publicLink.getAttribute("data-to")).toBe("/courses/$slug");
    expect(publicLink.getAttribute("data-slug")).toBe("sample-course");
    const learnLink = screen.getByRole("link", { name: /Preview lessons/i }) as HTMLAnchorElement;
    expect(learnLink.getAttribute("target")).toBe("_blank");
    expect(learnLink.getAttribute("data-to")).toBe("/learn/$slug");
    expect(learnLink.getAttribute("data-slug")).toBe("sample-course");
    // Preview-lessons contract: explicit search with lesson=undefined so the
    // player resolves the resume/first-preview lesson server-side.
    expect(learnLink.getAttribute("data-search")).toBe(JSON.stringify({}));
  });

  it("approve requires confirmation and single-flights the call", async () => {
    approveMock.mockResolvedValue({ ok: true });
    renderWith(makeQc());
    fireEvent.click(screen.getByRole("button", { name: /Approve & publish/i }));
    const dialog = await screen.findByRole("dialog", { name: /Confirm approval/i });
    const confirm = within(dialog).getByRole("button", { name: /Yes, publish/i });
    // Rapid clicks must collapse to one mutation via synchronous ref guard.
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(approveMock).toHaveBeenCalled());
    expect(approveMock).toHaveBeenCalledTimes(1);
    expect(approveMock).toHaveBeenCalledWith({ data: { courseId: "c1" } });
  });

  it("surfaces readiness blockers when approval is refused", async () => {
    approveMock.mockResolvedValue({
      ok: false,
      code: "course_not_ready",
      blockers: [{ code: "missing_lessons", message: "Add at least one lesson." }],
    });
    renderWith(makeQc());
    fireEvent.click(screen.getByRole("button", { name: /Approve & publish/i }));
    const dialog = await screen.findByRole("dialog", { name: /Confirm approval/i });
    fireEvent.click(within(dialog).getByRole("button", { name: /Yes, publish/i }));
    await waitFor(() => expect(screen.getByText(/Add at least one lesson\./i)).toBeTruthy());
    expect(screen.getByText(/readiness regressed/i)).toBeTruthy();
  });

  it("reject requires a trimmed reason of at least 10 characters", async () => {
    rejectMock.mockResolvedValue({ ok: true });
    renderWith(makeQc());
    fireEvent.click(screen.getByRole("button", { name: /Reject with reason/i }));
    const dialog = screen.getByRole("dialog", { name: /Reject course/i });
    const submit = within(dialog).getByRole("button", { name: /^Reject$/i }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    const textarea = within(dialog).getByPlaceholderText(/What must the instructor change/i);
    // Whitespace only stays disabled.
    fireEvent.change(textarea, { target: { value: "         " } });
    expect(submit.disabled).toBe(true);
    // Too short stays disabled.
    fireEvent.change(textarea, { target: { value: "too" } });
    expect(submit.disabled).toBe(true);
    // Valid trimmed reason enables submit.
    fireEvent.change(textarea, { target: { value: "  Needs better outline  " } });
    expect(submit.disabled).toBe(false);
    // Rapid clicks collapse to one mutation.
    fireEvent.click(submit);
    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => expect(rejectMock).toHaveBeenCalledTimes(1));
    expect(rejectMock).toHaveBeenCalledWith({
      data: { courseId: "c1", reason: "Needs better outline" },
    });
  });

  it("reject failure preserves the reason and remains retryable", async () => {
    rejectMock.mockRejectedValueOnce(new Error("boom"));
    renderWith(makeQc());
    fireEvent.click(screen.getByRole("button", { name: /Reject with reason/i }));
    const dialog = screen.getByRole("dialog", { name: /Reject course/i });
    const textarea = within(dialog).getByPlaceholderText(
      /What must the instructor change/i,
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Needs better outline" } });
    const submit = within(dialog).getByRole("button", { name: /^Reject$/i }) as HTMLButtonElement;
    fireEvent.click(submit);
    await waitFor(() => expect(rejectMock).toHaveBeenCalledTimes(1));
    // Reason preserved after failure; button still enabled for retry.
    expect(textarea.value).toBe("Needs better outline");
    expect(submit.disabled).toBe(false);
    rejectMock.mockResolvedValueOnce(undefined);
    fireEvent.click(submit);
    await waitFor(() => expect(rejectMock).toHaveBeenCalledTimes(2));
  });
});
