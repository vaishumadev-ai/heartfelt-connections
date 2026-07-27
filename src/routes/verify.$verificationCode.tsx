import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Award, CheckCircle2, ShieldAlert, XCircle } from "lucide-react";
import { verifyCertificate, type CertificateVerification } from "@/lib/certificates.functions";

function verifyQueryOptions(
  code: string,
  fn: (args: { data: { code: string } }) => Promise<CertificateVerification>,
) {
  return queryOptions({
    queryKey: ["verify-cert", code],
    queryFn: () => fn({ data: { code } }),
  });
}

export const Route = createFileRoute("/verify/$verificationCode")({
  head: () => ({
    meta: [
      { title: "Verify certificate — Mozok" },
      {
        name: "description",
        content: "Verify the authenticity of a Mozok completion certificate.",
      },
      { property: "og:title", content: "Verify certificate — Mozok" },
      {
        property: "og:description",
        content: "Verify the authenticity of a Mozok completion certificate.",
      },
    ],
  }),
  component: VerifyPage,
  errorComponent: () => (
    <VerifyShell>
      <NotFound />
    </VerifyShell>
  ),
});

function VerifyShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen bg-background p-6 md:p-10"
      style={{ fontFamily: "Poppins, sans-serif" }}
    >
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex items-center gap-2 text-sm">
          <Link to="/" className="inline-flex items-center gap-2 font-bold">
            <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-black">
              <div className="h-2.5 w-2.5 rounded-full bg-black" />
            </div>
            Mozok
          </Link>
        </div>
        {children}
      </div>
    </div>
  );
}

function NotFound() {
  return (
    <div className="rounded-3xl bg-card p-8 ring-1 ring-border">
      <div className="flex items-start gap-3">
        <XCircle className="mt-1 h-6 w-6 text-destructive" />
        <div>
          <h1 className="text-2xl font-bold">Certificate not found</h1>
          <p className="mt-2 text-muted-foreground">
            We couldn't find a Mozok certificate for this verification code.
          </p>
        </div>
      </div>
    </div>
  );
}

function formatDate(iso?: string) {
  if (!iso) return "";
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

function VerifyPage() {
  const { verificationCode } = Route.useParams();
  const fetch = useServerFn(verifyCertificate);
  const { data } = useSuspenseQuery(verifyQueryOptions(verificationCode, fetch));

  if (!data.found) {
    return (
      <VerifyShell>
        <NotFound />
      </VerifyShell>
    );
  }
  const revoked = data.status === "revoked";
  return (
    <VerifyShell>
      <div className="rounded-3xl bg-card p-8 ring-1 ring-border">
        <div className="flex items-center gap-3">
          {revoked ? (
            <ShieldAlert className="h-8 w-8 text-destructive" aria-hidden />
          ) : (
            <CheckCircle2 className="h-8 w-8 text-foreground" aria-hidden />
          )}
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {revoked ? "Revoked" : "Verified"}
            </div>
            <h1 className="text-2xl font-bold">
              {revoked ? "This certificate has been revoked." : "This certificate is authentic."}
            </h1>
          </div>
        </div>

        <div className="mt-8 space-y-4">
          <Row label="Learner" value={data.learner_name!} />
          <Row label="Course" value={data.course_title!} />
          <Row label="Instructor" value={data.instructor_name!} />
          <Row label="Issued on" value={formatDate(data.issued_at)} />
          <Row label="Certificate number" value={data.certificate_number!} mono />
        </div>

        <div className="mt-8 flex items-center gap-2 text-xs text-muted-foreground">
          <Award className="h-4 w-4" />
          Verified by Mozok
        </div>
      </div>
    </VerifyShell>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[140px_1fr] items-baseline gap-3 text-sm">
      <div className="text-muted-foreground">{label}</div>
      <div className={mono ? "font-mono" : "font-semibold text-foreground"}>{value}</div>
    </div>
  );
}