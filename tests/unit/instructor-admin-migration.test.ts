/**
 * Migration-contract tests for list_instructor_applications_admin.
 *
 * These parse the migration SQL directly and assert governance-critical
 * properties. They are local static checks; they do NOT prove the hosted
 * database matches this SQL (that remains a hosted-matrix item).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");

function loadInstructorAdminMigration(): string {
  const files = readdirSync(MIGRATIONS_DIR).sort();
  for (const f of files) {
    const body = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
    if (body.includes("list_instructor_applications_admin")) return body;
  }
  throw new Error("Migration adding list_instructor_applications_admin not found");
}

describe("list_instructor_applications_admin migration contract", () => {
  const sql = loadInstructorAdminMigration();

  it("declares SECURITY DEFINER", () => {
    expect(sql).toMatch(/SECURITY\s+DEFINER/i);
  });

  it("declares STABLE", () => {
    expect(sql).toMatch(/\bSTABLE\b/i);
  });

  it("pins search_path to public", () => {
    expect(sql).toMatch(/SET\s+search_path\s*=\s*public/i);
  });

  it("checks auth.uid() presence", () => {
    expect(sql).toMatch(/auth\.uid\(\)\s+IS\s+NULL/i);
  });

  it("checks admin role via has_role", () => {
    expect(sql).toMatch(/has_role\s*\(\s*auth\.uid\(\)\s*,\s*'admin'/i);
  });

  it("revokes EXECUTE from PUBLIC and anon", () => {
    const revoke = sql.match(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.list_instructor_applications_admin[\s\S]*?;/i);
    expect(revoke).not.toBeNull();
    expect(revoke![0]).toMatch(/FROM\s+PUBLIC/i);
    expect(revoke![0]).toMatch(/\banon\b/i);
  });

  it("grants EXECUTE to authenticated only", () => {
    const grant = sql.match(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.list_instructor_applications_admin[\s\S]*?;/i);
    expect(grant).not.toBeNull();
    expect(grant![0]).toMatch(/TO\s+authenticated/i);
    // service_role bypasses privileges anyway; explicit grant to it is not required and not present.
    expect(grant![0]).not.toMatch(/\banon\b/i);
    expect(grant![0]).not.toMatch(/\bPUBLIC\b/i);
  });

  it("returns no email or auth credential columns", () => {
    const returnsBlock = sql.match(/RETURNS\s+TABLE\s*\(([\s\S]*?)\)\s*LANGUAGE/i);
    expect(returnsBlock).not.toBeNull();
    const cols = returnsBlock![1].toLowerCase();
    expect(cols).not.toMatch(/\bemail\b/);
    expect(cols).not.toMatch(/\bpassword\b/);
    expect(cols).not.toMatch(/\btoken\b/);
    expect(cols).not.toMatch(/\bphone\b/);
    expect(cols).not.toMatch(/\bencrypted/);
  });

  it("adds user_id FK to auth.users(id) ON DELETE CASCADE", () => {
    expect(sql).toMatch(/FOREIGN\s+KEY\s*\(\s*user_id\s*\)\s*REFERENCES\s+auth\.users\s*\(\s*id\s*\)\s+ON\s+DELETE\s+CASCADE/i);
  });

  it("does not drop or weaken owner-only SELECT policy on instructor_applications", () => {
    // Owner-only policy remains from prior migration; this one must not touch it.
    expect(sql).not.toMatch(/DROP\s+POLICY[\s\S]*instructor_applications/i);
    expect(sql).not.toMatch(/ALTER\s+POLICY[\s\S]*instructor_applications/i);
    expect(sql).not.toMatch(/DISABLE\s+ROW\s+LEVEL\s+SECURITY[\s\S]*instructor_applications/i);
  });
});

describe("no service-role client in instructor-governance surfaces", () => {
  it("admin.instructors.tsx does not reference the service-role client", () => {
    const body = readFileSync(
      join(process.cwd(), "src/routes/_authenticated/admin.instructors.tsx"),
      "utf8",
    );
    expect(body).not.toMatch(/@\/integrations\/supabase\/client\.server/);
    expect(body).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(body).not.toMatch(/supabaseAdmin/);
  });

  it("listInstructorApplicationsAdmin body has no service-role dependency", () => {
    const body = readFileSync(join(process.cwd(), "src/lib/courses.functions.ts"), "utf8");
    // Extract only the export block for listInstructorApplicationsAdmin.
    const start = body.indexOf("export const listInstructorApplicationsAdmin");
    expect(start).toBeGreaterThan(-1);
    // Locate the next top-level export or end of file.
    const rest = body.slice(start);
    const nextExport = rest.slice(1).search(/\nexport\s+(const|function|type)\s+/);
    const block = nextExport === -1 ? rest : rest.slice(0, nextExport + 1);
    expect(block).not.toMatch(/client\.server/);
    expect(block).not.toMatch(/supabaseAdmin/);
    expect(block).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
  });
});