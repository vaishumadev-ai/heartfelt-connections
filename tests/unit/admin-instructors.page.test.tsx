/* @vitest-environment jsdom */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ------- Router / server-fn mocks -------
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: any) => ({ options: config }),
  Link: ({ children, to, ...rest }: any) => (
    <a href={typeof to === "string" ? to : "#"} {...rest}>
      {children}
    </a>
  ),
}));

// useServerFn returns the fn as-is; mutations invoke the imported function directly.
vi.mock("@tanstack/react-start", () => ({
  useServerFn: (fn: any) => fn,
}));

// ------- Server-fn mocks -------
const list = vi.fn();
const approve = vi.fn();
const reject = vi.fn();
const revoke = vi.fn();

vi.mock("@/lib/courses.functions", async () => {
  return {
    listInstructorApplicationsAdmin: (...a: any[]) => list(...a),
    approveInstructorApplication: (...a: any[]) => approve(...a),
    rejectInstructorApplication: (...a: any[]) => reject(...a),
    revokeInstructorRole: (...a: any[]) => revoke(...a),
    mapInstructorGovernanceError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      if (/permission|forbidden|admin only/i.test(msg)) return "You are no longer an admin.";
      if (/not authenticated/i.test(msg)) return "Your session has expired. Please sign in again.";
      if (/not pending/i.test(msg)) return "This application was already decided.";
      if (/not found/i.test(msg)) return "This application no longer exists.";
      if (/final admin/i.test(msg)) return "You cannot revoke the last admin.";
      return "Something went wrong. Please try again.";
    },
  };
});

import { Route as AdminInstructorsRoute } from "@/routes/_authenticated/admin.instructors";

const AdminInstructors = (AdminInstructorsRoute.options as any).component as React.ComponentType;

function makeRow(overrides: Partial<any> = {}) {
  return {
    application_id: "app-1",
    user_id: "user-1",
    display_name: "Alice Applicant",
    avatar_url: null,
    status: "pending",
    application_reason: "I want to teach.",
    decision_reason: null,
    decided_by: null,
    decided_at: null,
    created_at: "2026-07-25T12:00:00Z",
    updated_at: "2026-07-25T12:00:00Z",
    is_current_instructor: false,
    ...overrides,
  };
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <AdminInstructors />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  list.mockReset();
  approve.mockReset();
  reject.mockReset();
  revoke.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("AdminInstructors page — default tab and states", () => {
  it("mounts on Pending tab and queries with status=pending, offset=0", async () => {
    list.mockResolvedValue({ rows: [], total: 0 });
    renderPage();
    await waitFor(() => expect(list).toHaveBeenCalled());
    const call = list.mock.calls[0][0];
    expect(call.data.status).toBe("pending");
    expect(call.data.offset).toBe(0);
    expect(call.data.limit).toBe(25);
  });

  it("shows loading state while the initial query is pending", async () => {
    let resolveList: (v: any) => void = () => {};
    list.mockImplementation(() => new Promise((r) => (resolveList = r)));
    renderPage();
    expect(await screen.findByText(/loading applications/i)).toBeTruthy();
    await act(async () => resolveList({ rows: [], total: 0 }));
  });

  it("renders empty-state copy when no rows", async () => {
    list.mockResolvedValue({ rows: [], total: 0 });
    renderPage();
    expect(await screen.findByText(/no pending applications/i)).toBeTruthy();
  });

  it("renders an alert with retry when the query fails and refetches on click", async () => {
    list
      .mockRejectedValueOnce(new Error("permission denied"))
      .mockResolvedValueOnce({ rows: [makeRow()], total: 1 });
    renderPage();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/no longer an admin/i);
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByText(/alice applicant/i)).toBeTruthy();
  });
});

describe("AdminInstructors page — tabs and pagination", () => {
  it("switching tabs resets page to 0 and refetches with new status", async () => {
    list.mockResolvedValue({ rows: [], total: 60 });
    renderPage();
    // Wait for the query to resolve and pagination controls to render.
    const next = await screen.findByRole("button", { name: /next/i });
    fireEvent.click(next);
    await waitFor(() =>
      expect(list.mock.calls.some((c) => c[0].data.offset === 25)).toBe(true),
    );
    fireEvent.click(screen.getByRole("tab", { name: /approved/i }));
    await waitFor(() => {
      const last = list.mock.calls[list.mock.calls.length - 1][0].data;
      expect(last.status).toBe("approved");
      expect(last.offset).toBe(0);
    });
  });

  it("hides pagination when total <= PAGE_SIZE", async () => {
    list.mockResolvedValue({ rows: [makeRow()], total: 1 });
    renderPage();
    await screen.findByText(/alice applicant/i);
    expect(screen.queryByRole("button", { name: /next/i })).toBeNull();
  });
});

describe("AdminInstructors page — Approve dialog", () => {
  it("opens accessible dialog, calls approve with trimmed reason and closes on success", async () => {
    list.mockResolvedValue({ rows: [makeRow()], total: 1 });
    approve.mockResolvedValue({ ok: true });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /approve/i }));
    const dialog = await screen.findByRole("dialog");
    // Radix sets aria-modal on the dialog content; tolerate either "true" or the
    // implicit dialog-role semantics if the attribute isn't reflected in jsdom.
    expect(["true", null]).toContain(dialog.getAttribute("aria-modal"));
    const note = within(dialog).getByLabelText(/optional internal approval note/i);
    fireEvent.change(note, { target: { value: "  looks good  " } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^approve$/i }));
    await waitFor(() => expect(approve).toHaveBeenCalledTimes(1));
    expect(approve.mock.calls[0][0].data).toEqual({
      applicationId: "app-1",
      reason: "looks good",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("rapid double-clicks issue only one approval mutation", async () => {
    list.mockResolvedValue({ rows: [makeRow()], total: 1 });
    let resolveApprove: (v: any) => void = () => {};
    approve.mockImplementation(() => new Promise((r) => (resolveApprove = r)));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /approve/i }));
    const dialog = await screen.findByRole("dialog");
    const submit = within(dialog).getByRole("button", { name: /^approve$/i });
    fireEvent.click(submit);
    await waitFor(() => expect(approve).toHaveBeenCalledTimes(1));
    fireEvent.click(submit);
    fireEvent.click(submit);
    // No additional invocations after the first one is in-flight.
    expect(approve).toHaveBeenCalledTimes(1);
    await act(async () => resolveApprove({ ok: true }));
  });

  it("shows mapped error copy and keeps dialog open on failure", async () => {
    list.mockResolvedValue({ rows: [makeRow()], total: 1 });
    approve.mockRejectedValue(new Error("Application not pending"));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /approve/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^approve$/i }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toMatch(/already decided/i);
    expect(screen.queryByRole("dialog")).not.toBeNull();
  });
});

describe("AdminInstructors page — Reject dialog", () => {
  it("submit is disabled without a reason and enabled once non-whitespace is entered", async () => {
    list.mockResolvedValue({ rows: [makeRow()], total: 1 });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /^reject$/i }));
    const dialog = await screen.findByRole("dialog");
    const submit = within(dialog).getByRole("button", { name: /^reject$/i });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    const textarea = within(dialog).getByLabelText(/reason \(required\)/i);
    fireEvent.change(textarea, { target: { value: "   " } });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(textarea, { target: { value: "Not enough experience." } });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it("sends the trimmed reason on submit and invalidates queries", async () => {
    list.mockResolvedValue({ rows: [makeRow()], total: 1 });
    reject.mockResolvedValue({ ok: true });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /^reject$/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/reason \(required\)/i), {
      target: { value: "  needs work  " },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /^reject$/i }));
    await waitFor(() =>
      expect(reject.mock.calls[0][0].data).toEqual({
        applicationId: "app-1",
        reason: "needs work",
      }),
    );
    // Post-success refetch triggered via invalidation.
    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThanOrEqual(2));
  });
});

describe("AdminInstructors page — Revoke dialog", () => {
  it("only appears for approved + current instructor rows", async () => {
    list.mockResolvedValue({
      rows: [
        makeRow({
          application_id: "a2",
          status: "approved",
          is_current_instructor: true,
          decided_at: "2026-07-24T12:00:00Z",
        }),
      ],
      total: 1,
    });
    renderPage();
    // Move to Approved tab
    await screen.findByRole("tab", { name: /approved/i });
    fireEvent.click(screen.getByRole("tab", { name: /approved/i }));
    expect(await screen.findByRole("button", { name: /revoke instructor/i })).toBeTruthy();
  });

  it("submits revoke with reason and closes on success", async () => {
    list.mockResolvedValue({
      rows: [
        makeRow({
          application_id: "a2",
          status: "approved",
          is_current_instructor: true,
        }),
      ],
      total: 1,
    });
    revoke.mockResolvedValue({ ok: true });
    renderPage();
    fireEvent.click(screen.getByRole("tab", { name: /approved/i }));
    fireEvent.click(await screen.findByRole("button", { name: /revoke instructor/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/reason \(required\)/i), {
      target: { value: "Policy violation" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /^revoke$/i }));
    await waitFor(() =>
      expect(revoke.mock.calls[0][0].data).toEqual({
        userId: "user-1",
        reason: "Policy violation",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("surfaces final-admin protection error via mapped copy", async () => {
    list.mockResolvedValue({
      rows: [
        makeRow({
          application_id: "a2",
          status: "approved",
          is_current_instructor: true,
        }),
      ],
      total: 1,
    });
    revoke.mockRejectedValue(new Error("Cannot remove the final admin"));
    renderPage();
    fireEvent.click(screen.getByRole("tab", { name: /approved/i }));
    fireEvent.click(await screen.findByRole("button", { name: /revoke instructor/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/reason \(required\)/i), {
      target: { value: "removing" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /^revoke$/i }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toMatch(/last admin/i);
  });
});

describe("AdminInstructors page — dialog interaction locking", () => {
  it("Escape and Cancel are ignored while a mutation is in flight", async () => {
    list.mockResolvedValue({ rows: [makeRow()], total: 1 });
    let resolveApprove: (v: any) => void = () => {};
    approve.mockImplementation(() => new Promise((r) => (resolveApprove = r)));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /approve/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^approve$/i }));
    // Wait for the mutation to actually be in-flight before probing lock state.
    await waitFor(() => expect(approve).toHaveBeenCalledTimes(1));
    // Cancel button is disabled while pending; clicking it must be a no-op.
    const cancel = within(dialog).getByRole("button", { name: /cancel/i });
    expect((cancel as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(cancel);
    expect(screen.queryByRole("dialog")).not.toBeNull();
    // Escape while pending
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeNull();
    await act(async () => resolveApprove({ ok: true }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});