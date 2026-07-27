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
    Link: ({ children, to, params, ...rest }: any) =>
      React.createElement("a", { href: typeof to === "string" ? to : "#", ...rest }, children),
    useNavigate: () => vi.fn(),
  };
});

vi.mock("@/lib/courses.functions", () => ({
  getAdminCourse: vi.fn(async () => course),
  unpublishForEdit: (...a: any[]) => unpublishMock(...a),
  approveCourse: (...a: any[]) => approveMock(...a),
  rejectCourse: (...a: any[]) => rejectMock(...a),
  mapCourseGovernanceError: (e: any) => (e?.message ?? "err"),
}));

let course: any;

import { Route as AdminRoute } from "@/routes/_authenticated/admin.courses.$courseId";

function renderWith(qc: QueryClient) {
  const Component: any = (AdminRoute as any).options.component;
  return render(
    React.createElement(
      QueryClientProvider,
      { client: qc },
      React.createElement(Component, null),
    ),
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
  it("shows pending-review actions and a Preview-as-learner link", () => {
    renderWith(makeQc());
    expect(screen.getAllByText(/Pending review/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Approve & publish/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Reject with reason/i })).toBeTruthy();
    const preview = screen.getByRole("link", { name: /Preview as learner/i }) as HTMLAnchorElement;
    expect(preview.getAttribute("target")).toBe("_blank");
  });

  it("approve requires confirmation and single-flights the call", async () => {
    approveMock.mockResolvedValue({ ok: true });
    renderWith(makeQc());
    fireEvent.click(screen.getByRole("button", { name: /Approve & publish/i }));
    const dialog = await screen.findByRole("dialog", { name: /Confirm approval/i });
    const confirm = within(dialog).getByRole("button", { name: /Yes, publish/i });
    fireEvent.click(confirm);
    await waitFor(() => expect(approveMock).toHaveBeenCalled());
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
    await waitFor(() =>
      expect(screen.getByText(/Add at least one lesson\./i)).toBeTruthy(),
    );
    expect(screen.getByText(/readiness regressed/i)).toBeTruthy();
  });

  it("reject requires a non-empty reason before firing", async () => {
    rejectMock.mockResolvedValue({ ok: true });
    renderWith(makeQc());
    fireEvent.click(screen.getByRole("button", { name: /Reject with reason/i }));
    const dialog = screen.getByRole("dialog", { name: /Reject course/i });
    const submit = within(dialog).getByRole("button", { name: /^Reject$/i }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    const textarea = within(dialog).getByPlaceholderText(/What must the instructor change/i);
    fireEvent.change(textarea, { target: { value: "  Needs better outline  " } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(rejectMock).toHaveBeenCalledTimes(1));
    expect(rejectMock).toHaveBeenCalledWith({
      data: { courseId: "c1", reason: "Needs better outline" },
    });
  });
});