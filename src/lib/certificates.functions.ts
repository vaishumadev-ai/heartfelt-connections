import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type CertificateDTO = {
  id: string;
  certificate_number: string;
  verification_code: string;
  learner_name: string;
  course_title: string;
  instructor_name: string;
  issued_at: string;
  revoked_at: string | null;
  revocation_reason: string | null;
  course_slug: string | null;
};

export type CertificateVerification = {
  found: boolean;
  certificate_number?: string;
  learner_name?: string;
  course_title?: string;
  instructor_name?: string;
  issued_at?: string;
  status?: "valid" | "revoked";
};

/**
 * Idempotently issue a completion certificate for the current learner.
 * Returns the certificate id (existing or newly created).
 */
export const issueCourseCertificate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { courseId: string }) => {
    if (!d || typeof d.courseId !== "string") throw new Error("invalid_course_id");
    return d;
  })
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { supabase } = context;
    const { data: id, error } = await supabase.rpc("issue_course_certificate", {
      _course_id: data.courseId,
    });
    if (error) throw new Error(error.message);
    if (!id || typeof id !== "string") throw new Error("Failed to issue certificate");
    return { id };
  });

/** Fetch one of the learner's own certificates by id. */
export const getMyCertificate = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => {
    if (!d || typeof d.id !== "string") throw new Error("invalid_id");
    return d;
  })
  .handler(async ({ data, context }): Promise<CertificateDTO | null> => {
    const { supabase } = context;
    const { data: row, error } = await supabase
      .from("certificates")
      .select(
        "id, certificate_number, verification_code, learner_name_snapshot, course_title_snapshot, instructor_name_snapshot, issued_at, revoked_at, revocation_reason, course_id",
      )
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return null;
    let course_slug: string | null = null;
    const { data: c } = await supabase
      .from("courses")
      .select("slug")
      .eq("id", row.course_id)
      .maybeSingle();
    course_slug = c?.slug ?? null;
    return {
      id: row.id,
      certificate_number: row.certificate_number,
      verification_code: row.verification_code,
      learner_name: row.learner_name_snapshot,
      course_title: row.course_title_snapshot,
      instructor_name: row.instructor_name_snapshot,
      issued_at: row.issued_at,
      revoked_at: row.revoked_at,
      revocation_reason: row.revocation_reason,
      course_slug,
    };
  });

/**
 * Public verification. Uses a publishable-key client (no session) so anon
 * visitors can verify by scanning/typing a code. The RPC is SECURITY DEFINER
 * and returns only presentation-safe columns.
 */
export const verifyCertificate = createServerFn({ method: "GET" })
  .inputValidator((d: { code: string }) => {
    if (!d || typeof d.code !== "string") throw new Error("invalid_code");
    return { code: d.code.trim() };
  })
  .handler(async ({ data }): Promise<CertificateVerification> => {
    // UUID sanity check — the DB parameter is uuid; a bad input would 400.
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuid.test(data.code)) return { found: false };
    const supabase = createClient<Database>(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
    );
    const { data: rows, error } = await supabase.rpc("verify_certificate", {
      _verification_code: data.code,
    });
    if (error) throw new Error(error.message);
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) return { found: false };
    return {
      found: true,
      certificate_number: row.certificate_number,
      learner_name: row.learner_name,
      course_title: row.course_title,
      instructor_name: row.instructor_name,
      issued_at: row.issued_at,
      status: row.status === "revoked" ? "revoked" : "valid",
    };
  });

/** Admin revocation with required reason (10–1000 chars). */
export const revokeCertificate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; reason: string }) => {
    if (!d || typeof d.id !== "string") throw new Error("invalid_id");
    if (typeof d.reason !== "string") throw new Error("invalid_reason");
    const r = d.reason.trim();
    if (r.length < 10 || r.length > 1000) throw new Error("reason_length");
    return { id: d.id, reason: r };
  })
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabase } = context;
    const { error } = await supabase.rpc("revoke_certificate", {
      _certificate_id: data.id,
      _reason: data.reason,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
