import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { ArrowLeft, ShieldCheck, UserCheck, UserX, Ban, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  listInstructorApplicationsAdmin,
  approveInstructorApplication,
  rejectInstructorApplication,
  revokeInstructorRole,
  mapInstructorGovernanceError,
  type AdminApplicationStatus,
  type AdminInstructorApplication,
  type AdminInstructorApplicationsPage,
} from "@/lib/courses.functions";

const TABS: { key: AdminApplicationStatus; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "withdrawn", label: "Withdrawn" },
];

const PAGE_SIZE = 25;

const listQO = (status: AdminApplicationStatus, page: number) =>
  queryOptions({
    queryKey: ["admin-instructor-apps", status, page],
    queryFn: () =>
      listInstructorApplicationsAdmin({
        data: { status, limit: PAGE_SIZE, offset: page * PAGE_SIZE },
      }),
  });

export const Route = createFileRoute("/_authenticated/admin/instructors")({
  head: () => ({
    meta: [
      { title: "Admin · Instructor applications — Mozok" },
      { name: "description", content: "Review and decide instructor applications." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminInstructors,
});

function AdminInstructors() {
  const [tab, setTab] = useState<AdminApplicationStatus>("pending");
  const [page, setPage] = useState(0);
  const query = useQuery(listQO(tab, page));

  return (
    <div className="min-h-screen bg-background" style={{ fontFamily: "Poppins, sans-serif" }}>
      <div className="mx-auto max-w-6xl p-4 md:p-8">
        <div className="mb-6 flex items-center justify-between">
          <Link
            to="/dashboard"
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-black"
          >
            <ArrowLeft className="h-4 w-4" /> Dashboard
          </Link>
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            <ShieldCheck className="h-4 w-4" /> Admin console
          </div>
        </div>

        <nav
          aria-label="Admin sections"
          className="mb-6 flex flex-wrap gap-2 text-xs font-semibold"
        >
          <Link
            to="/admin/courses"
            className="rounded-full bg-card px-4 py-1.5 ring-1 ring-border hover:bg-foreground/5"
          >
            Courses
          </Link>
          <span className="rounded-full bg-foreground px-4 py-1.5 text-primary-foreground">
            Instructors
          </span>
        </nav>

        <div className="rounded-3xl bg-card p-4 md:p-8 ring-1 ring-border">
          <h1 className="text-2xl font-bold">Instructor applications</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review each request and decide whether to grant instructor access.
          </p>

          <div
            role="tablist"
            aria-label="Application status"
            className="mt-6 flex flex-wrap gap-2 border-b border-border pb-3"
          >
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => {
                  setTab(t.key);
                  setPage(0);
                }}
                className={`rounded-full px-4 py-1.5 text-xs font-semibold ${
                  tab === t.key
                    ? "bg-foreground text-primary-foreground"
                    : "bg-background text-muted-foreground ring-1 ring-border"
                }`}
              >
                {t.label}
                {tab === t.key && query.data ? ` · ${query.data.total}` : ""}
              </button>
            ))}
          </div>

          <div className="mt-6" aria-live="polite">
            {query.isLoading ? (
              <div className="flex items-center gap-2 rounded-2xl bg-background p-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading applications…
              </div>
            ) : query.isError ? (
              <div className="rounded-2xl bg-background p-6 text-sm" role="alert">
                <p className="font-semibold">{mapInstructorGovernanceError(query.error)}</p>
                <button
                  onClick={() => query.refetch()}
                  className="mt-3 rounded-full bg-foreground px-4 py-1.5 text-xs font-semibold text-primary-foreground"
                >
                  Retry
                </button>
              </div>
            ) : !query.data || query.data.rows.length === 0 ? (
              <EmptyState tab={tab} />
            ) : (
              <div className="space-y-3">
                {query.data.rows.map((row) => (
                  <ApplicationRow key={row.application_id} row={row} tab={tab} page={page} />
                ))}
              </div>
            )}
          </div>

          {query.data && query.data.total > PAGE_SIZE && (
            <Pagination
              page={page}
              total={query.data.total}
              onPage={setPage}
              isFetching={query.isFetching}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ tab }: { tab: AdminApplicationStatus }) {
  const msg: Record<AdminApplicationStatus, string> = {
    pending: "No pending applications right now.",
    approved: "No approved applications yet.",
    rejected: "No rejected applications.",
    withdrawn: "No withdrawn applications.",
  };
  return (
    <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
      {msg[tab]}
    </div>
  );
}

function Pagination({
  page,
  total,
  onPage,
  isFetching,
}: {
  page: number;
  total: number;
  onPage: (p: number) => void;
  isFetching: boolean;
}) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <div className="mt-6 flex items-center justify-between text-xs text-muted-foreground">
      <div>
        Page {page + 1} of {pages}
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => onPage(Math.max(0, page - 1))}
          disabled={page === 0 || isFetching}
          className="rounded-full bg-background px-4 py-1.5 font-semibold ring-1 ring-border disabled:opacity-50"
        >
          Previous
        </button>
        <button
          onClick={() => onPage(Math.min(pages - 1, page + 1))}
          disabled={page >= pages - 1 || isFetching}
          className="rounded-full bg-foreground px-4 py-1.5 font-semibold text-primary-foreground disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </div>
  );
}

function ApplicationRow({
  row,
  tab,
  page,
}: {
  row: AdminInstructorApplication;
  tab: AdminApplicationStatus;
  page: number;
}) {
  const [openAction, setOpenAction] = useState<null | "approve" | "reject" | "revoke">(null);
  const initials = (row.display_name ?? "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <div className="rounded-2xl bg-background p-4 ring-1 ring-border md:p-5">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div
            aria-hidden
            className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-foreground/10 text-sm font-semibold"
          >
            {row.avatar_url ? (
              <img src={row.avatar_url} alt="" className="h-10 w-10 rounded-full object-cover" />
            ) : (
              initials
            )}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <div className="truncate text-sm font-semibold">
                {row.display_name ?? "Unnamed learner"}
              </div>
              {row.is_current_instructor && (
                <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-[10px] font-semibold">
                  Current instructor
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              Submitted {new Date(row.created_at).toLocaleDateString()}
              {row.decided_at && (
                <>
                  {" · Decided "}
                  {new Date(row.decided_at).toLocaleDateString()}
                </>
              )}
            </div>
            {row.application_reason && (
              <p className="mt-2 line-clamp-4 whitespace-pre-wrap rounded-2xl bg-card p-3 text-xs">
                {row.application_reason}
              </p>
            )}
            {row.decision_reason && (
              <p className="mt-2 line-clamp-4 whitespace-pre-wrap rounded-2xl bg-card p-3 text-xs">
                <span className="text-[10px] font-semibold uppercase text-muted-foreground">
                  Decision reason
                </span>
                <br />
                {row.decision_reason}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {row.status === "pending" && (
            <>
              <button
                onClick={() => setOpenAction("approve")}
                className="flex items-center gap-1 rounded-full bg-foreground px-4 py-1.5 text-xs font-semibold text-primary-foreground"
              >
                <UserCheck className="h-3.5 w-3.5" /> Approve
              </button>
              <button
                onClick={() => setOpenAction("reject")}
                className="flex items-center gap-1 rounded-full bg-card px-4 py-1.5 text-xs font-semibold ring-1 ring-border"
              >
                <UserX className="h-3.5 w-3.5" /> Reject
              </button>
            </>
          )}
          {row.status === "approved" && row.is_current_instructor && (
            <button
              onClick={() => setOpenAction("revoke")}
              className="flex items-center gap-1 rounded-full bg-destructive/10 px-4 py-1.5 text-xs font-semibold text-destructive"
            >
              <Ban className="h-3.5 w-3.5" /> Revoke instructor
            </button>
          )}
          {row.status !== "pending" &&
            !(row.status === "approved" && row.is_current_instructor) && (
              <span className="rounded-full bg-card px-3 py-1 text-[10px] font-semibold uppercase text-muted-foreground ring-1 ring-border">
                {row.status}
              </span>
            )}
        </div>
      </div>

      {openAction === "approve" && (
        <ApproveDialog row={row} tab={tab} page={page} onClose={() => setOpenAction(null)} />
      )}
      {openAction === "reject" && (
        <RejectDialog row={row} tab={tab} page={page} onClose={() => setOpenAction(null)} />
      )}
      {openAction === "revoke" && (
        <RevokeDialog row={row} tab={tab} page={page} onClose={() => setOpenAction(null)} />
      )}
    </div>
  );
}

function useAdminInvalidators() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["admin-instructor-apps"] });
    qc.invalidateQueries({ queryKey: ["my-roles"] });
    qc.invalidateQueries({ queryKey: ["my-instructor-app"] });
  };
}

function ActionShell({
  title,
  description,
  pending,
  onClose,
  children,
}: {
  title: string;
  description: string;
  pending: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !pending) onClose();
      }}
    >
      <DialogContent
        className="max-w-md rounded-3xl bg-card ring-1 ring-border"
        onEscapeKeyDown={(e) => {
          if (pending) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (pending) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (pending) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

function ApproveDialog({
  row,
  onClose,
}: {
  row: AdminInstructorApplication;
  tab: AdminApplicationStatus;
  page: number;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const inFlight = useRef(false);
  const approveFn = useServerFn(approveInstructorApplication);
  const invalidate = useAdminInvalidators();
  const mutation = useMutation({
    mutationFn: (r: string | undefined) =>
      approveFn({ data: { applicationId: row.application_id, reason: r ?? null } }),
    onSuccess: () => {
      inFlight.current = false;
      invalidate();
      onClose();
    },
    onError: (e) => {
      inFlight.current = false;
      setErrorMsg(mapInstructorGovernanceError(e));
    },
  });
  return (
    <ActionShell
      title={`Approve ${row.display_name ?? "applicant"}?`}
      description="This grants the instructor role and lets them create courses."
      pending={mutation.isPending}
      onClose={onClose}
    >
      <textarea
        rows={3}
        value={reason}
        onChange={(e) => setReason(e.target.value.slice(0, 1000))}
        placeholder="Optional internal note"
        className="mt-4 w-full resize-none rounded-2xl bg-background p-3 text-sm outline-none ring-1 ring-border focus:ring-foreground"
        aria-label="Optional internal approval note"
      />
      {errorMsg && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {errorMsg}
        </p>
      )}
      <DialogFooter className="mt-5 gap-2">
        <button
          onClick={() => {
            if (!mutation.isPending) onClose();
          }}
          disabled={mutation.isPending}
          className="rounded-full bg-background px-4 py-2 text-sm font-semibold ring-1 ring-border"
        >
          Cancel
        </button>
        <button
          disabled={mutation.isPending}
          onClick={() => {
            if (inFlight.current) return;
            inFlight.current = true;
            setErrorMsg(null);
            mutation.mutate(reason.trim() || undefined);
          }}
          className="rounded-full bg-foreground px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {mutation.isPending ? "Approving…" : "Approve"}
        </button>
      </DialogFooter>
    </ActionShell>
  );
}

function RejectDialog({
  row,
  onClose,
}: {
  row: AdminInstructorApplication;
  tab: AdminApplicationStatus;
  page: number;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const inFlight = useRef(false);
  const rejectFn = useServerFn(rejectInstructorApplication);
  const invalidate = useAdminInvalidators();
  const trimmed = reason.trim();
  const disabled = trimmed.length === 0;
  const mutation = useMutation({
    mutationFn: (r: string) => rejectFn({ data: { applicationId: row.application_id, reason: r } }),
    onSuccess: () => {
      inFlight.current = false;
      invalidate();
      onClose();
    },
    onError: (e) => {
      inFlight.current = false;
      setErrorMsg(mapInstructorGovernanceError(e));
    },
  });
  const remaining = 1000 - reason.length;
  return (
    <ActionShell
      title={`Reject ${row.display_name ?? "applicant"}?`}
      description="The applicant will see your reason. They may apply again."
      pending={mutation.isPending}
      onClose={onClose}
    >
      <label
        htmlFor="reject-reason"
        className="mt-4 block text-xs font-semibold text-muted-foreground"
      >
        Reason (required)
      </label>
      <textarea
        id="reject-reason"
        rows={4}
        value={reason}
        onChange={(e) => setReason(e.target.value.slice(0, 1000))}
        className="mt-1 w-full resize-none rounded-2xl bg-background p-3 text-sm outline-none ring-1 ring-border focus:ring-foreground"
      />
      <div
        className={`mt-1 text-right text-[11px] ${
          remaining <= 100 ? "text-destructive" : "text-muted-foreground"
        }`}
      >
        {remaining} characters remaining
      </div>
      {errorMsg && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {errorMsg}
        </p>
      )}
      <DialogFooter className="mt-5 gap-2">
        <button
          onClick={() => {
            if (!mutation.isPending) onClose();
          }}
          disabled={mutation.isPending}
          className="rounded-full bg-background px-4 py-2 text-sm font-semibold ring-1 ring-border"
        >
          Cancel
        </button>
        <button
          disabled={disabled || mutation.isPending}
          onClick={() => {
            if (inFlight.current || disabled) return;
            inFlight.current = true;
            setErrorMsg(null);
            mutation.mutate(trimmed);
          }}
          className="rounded-full bg-foreground px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {mutation.isPending ? "Rejecting…" : "Reject"}
        </button>
      </DialogFooter>
    </ActionShell>
  );
}

function RevokeDialog({
  row,
  onClose,
}: {
  row: AdminInstructorApplication;
  tab: AdminApplicationStatus;
  page: number;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const inFlight = useRef(false);
  const revokeFn = useServerFn(revokeInstructorRole);
  const invalidate = useAdminInvalidators();
  const trimmed = reason.trim();
  const disabled = trimmed.length === 0;
  const mutation = useMutation({
    mutationFn: (r: string) => revokeFn({ data: { userId: row.user_id, reason: r } }),
    onSuccess: () => {
      inFlight.current = false;
      invalidate();
      onClose();
    },
    onError: (e) => {
      inFlight.current = false;
      setErrorMsg(mapInstructorGovernanceError(e));
    },
  });
  return (
    <ActionShell
      title={`Revoke instructor from ${row.display_name ?? "user"}?`}
      description="Existing courses and audit history are preserved. The user immediately loses Studio authoring access; any courses they own remain in place and can be transferred separately."
      pending={mutation.isPending}
      onClose={onClose}
    >
      <label
        htmlFor="revoke-reason"
        className="mt-4 block text-xs font-semibold text-muted-foreground"
      >
        Reason (required)
      </label>
      <textarea
        id="revoke-reason"
        rows={4}
        value={reason}
        onChange={(e) => setReason(e.target.value.slice(0, 1000))}
        className="mt-1 w-full resize-none rounded-2xl bg-background p-3 text-sm outline-none ring-1 ring-border focus:ring-foreground"
      />
      {errorMsg && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {errorMsg}
        </p>
      )}
      <DialogFooter className="mt-5 gap-2">
        <button
          onClick={() => {
            if (!mutation.isPending) onClose();
          }}
          disabled={mutation.isPending}
          className="rounded-full bg-background px-4 py-2 text-sm font-semibold ring-1 ring-border"
        >
          Cancel
        </button>
        <button
          disabled={disabled || mutation.isPending}
          onClick={() => {
            if (inFlight.current || disabled) return;
            inFlight.current = true;
            setErrorMsg(null);
            mutation.mutate(trimmed);
          }}
          className="rounded-full bg-destructive px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {mutation.isPending ? "Revoking…" : "Revoke"}
        </button>
      </DialogFooter>
    </ActionShell>
  );
}
