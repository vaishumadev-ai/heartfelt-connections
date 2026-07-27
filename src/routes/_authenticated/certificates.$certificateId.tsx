import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Award, Printer, Share2, ShieldAlert } from "lucide-react";
import { getMyCertificate, type CertificateDTO } from "@/lib/certificates.functions";

function certQueryOptions(
  id: string,
  fn: (args: { data: { id: string } }) => Promise<CertificateDTO | null>,
) {
  return queryOptions({
    queryKey: ["certificate", id],
    queryFn: () => fn({ data: { id } }),
  });
}

export const Route = createFileRoute("/_authenticated/certificates/$certificateId")({
  head: () => ({
    meta: [
      { title: "Certificate — Mozok" },
      { name: "description", content: "Your Mozok completion certificate." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CertificatePage,
  errorComponent: ({ error }) => (
    <div className="p-8" role="alert">
      {error instanceof Error ? error.message : "Certificate unavailable"}
    </div>
  ),
});

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function CertificatePage() {
  const { certificateId } = Route.useParams();
  const fetch = useServerFn(getMyCertificate);
  const { data } = useSuspenseQuery(certQueryOptions(certificateId, fetch));
  const navigate = useNavigate();

  if (!data) {
    return (
      <div className="min-h-screen bg-background p-8" style={{ fontFamily: "Poppins, sans-serif" }}>
        <div className="mx-auto max-w-2xl rounded-3xl bg-card p-8 ring-1 ring-border text-center">
          <h1 className="text-2xl font-bold">Certificate not found</h1>
          <p className="mt-2 text-muted-foreground">
            This certificate doesn't exist or isn't visible to your account.
          </p>
          <button
            onClick={() => navigate({ to: "/dashboard" })}
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-background"
          >
            <ArrowLeft className="h-4 w-4" /> Back to dashboard
          </button>
        </div>
      </div>
    );
  }

  const verifyUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/verify/${data.verification_code}`
      : `/verify/${data.verification_code}`;

  async function share() {
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await (navigator as Navigator & { share: (d: ShareData) => Promise<void> }).share({
          title: `Mozok — ${data!.course_title}`,
          text: `I earned a certificate for "${data!.course_title}" on Mozok.`,
          url: verifyUrl,
        });
        return;
      } catch {
        /* fall through */
      }
    }
    try {
      await navigator.clipboard.writeText(verifyUrl);
    } catch {
      /* ignore */
    }
  }

  return (
    <div
      className="min-h-screen bg-background p-4 md:p-8"
      style={{ fontFamily: "Poppins, sans-serif" }}
    >
      <div className="mx-auto max-w-4xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Back to dashboard
          </Link>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 rounded-full bg-card px-4 py-2.5 text-sm font-semibold ring-1 ring-border"
            >
              <Printer className="h-4 w-4" /> Print / Save PDF
            </button>
            <button
              type="button"
              onClick={share}
              className="inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-2.5 text-sm font-semibold text-background"
            >
              <Share2 className="h-4 w-4" /> Share
            </button>
          </div>
        </div>

        {data.revoked_at && (
          <div
            role="alert"
            className="mb-4 flex items-start gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
          >
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <div className="font-semibold">This certificate has been revoked.</div>
              {data.revocation_reason && <div className="mt-1">{data.revocation_reason}</div>}
            </div>
          </div>
        )}

        <div
          className="relative overflow-hidden rounded-3xl bg-card p-8 ring-1 ring-border md:p-14 print:rounded-none print:ring-0"
          style={{
            backgroundImage:
              "radial-gradient(circle at 0% 0%, hsl(var(--secondary)) 0, transparent 40%), radial-gradient(circle at 100% 100%, hsl(var(--secondary)) 0, transparent 40%)",
          }}
        >
          <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
            <span className="flex items-center gap-2">
              <Award className="h-4 w-4" /> Mozok
            </span>
            <span>Certificate of completion</span>
          </div>

          <div className="mt-10 text-center">
            <p className="text-sm uppercase tracking-widest text-muted-foreground">
              This certifies that
            </p>
            <h1 className="mt-3 text-3xl font-bold leading-tight md:text-5xl">
              {data.learner_name}
            </h1>
            <p className="mt-6 text-sm uppercase tracking-widest text-muted-foreground">
              has successfully completed
            </p>
            <h2 className="mt-3 text-xl font-semibold md:text-3xl">{data.course_title}</h2>
            <p className="mt-6 text-sm text-muted-foreground">
              Instructor:{" "}
              <span className="font-semibold text-foreground">{data.instructor_name}</span>
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Issued on{" "}
              <span className="font-semibold text-foreground">{formatDate(data.issued_at)}</span>
            </p>
          </div>

          <div className="mt-12 grid gap-6 border-t border-border pt-6 text-xs text-muted-foreground md:grid-cols-2">
            <div>
              <div className="font-semibold uppercase tracking-widest">Certificate number</div>
              <div className="mt-1 font-mono text-foreground">{data.certificate_number}</div>
            </div>
            <div className="md:text-right">
              <div className="font-semibold uppercase tracking-widest">Verify at</div>
              <div className="mt-1 break-all font-mono text-foreground">{verifyUrl}</div>
            </div>
          </div>
        </div>

        {data.course_slug && (
          <div className="mt-4 text-center print:hidden">
            <Link
              to="/courses/$slug"
              params={{ slug: data.course_slug }}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              View course page →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
