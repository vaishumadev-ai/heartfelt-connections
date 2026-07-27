/**
 * Migration-contract tests for approve_course / reject_course.
 *
 * Static SQL parse — asserts the governance concurrency contract on the
 * P0D migration. Does not prove hosted state matches; hosted verification
 * remains part of golden-path QA.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");

function loadApproveRejectMigration(): string {
  const files = readdirSync(MIGRATIONS_DIR).sort().reverse();
  for (const f of files) {
    const body = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
    if (/approve_course/.test(body) && /reject_course/.test(body)) return body;
  }
  throw new Error("Migration defining approve_course + reject_course not found");
}

function extractFunction(sql: string, name: string): string {
  const re = new RegExp(
    `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${name}[\\s\\S]*?\\$function\\$;`,
    "i",
  );
  const m = sql.match(re);
  if (!m) throw new Error(`Function ${name} not found in migration`);
  return m[0];
}

describe("approve_course / reject_course governance concurrency contract", () => {
  const sql = loadApproveRejectMigration();
  const approve = extractFunction(sql, "approve_course");
  const reject = extractFunction(sql, "reject_course");

  it("both functions are SECURITY DEFINER with pinned search_path", () => {
    for (const body of [approve, reject]) {
      expect(body).toMatch(/SECURITY\s+DEFINER/i);
      expect(body).toMatch(/SET\s+search_path\s+TO\s+'public'/i);
    }
  });

  it("both gate on admin role via current_user_has_role('admin')", () => {
    for (const body of [approve, reject]) {
      expect(body).toMatch(/current_user_has_role\('admin'\)/);
    }
  });

  it("both acquire the same course-scoped row lock via SELECT ... FOR UPDATE", () => {
    for (const body of [approve, reject]) {
      expect(body).toMatch(/FROM\s+public\.courses\s+WHERE\s+id\s*=\s*_course_id\s+FOR\s+UPDATE/i);
    }
  });

  it("both require current status = pending_review", () => {
    for (const body of [approve, reject]) {
      expect(body).toMatch(/_status\s*<>\s*'pending_review'/);
    }
  });

  it("approve performs readiness recheck AFTER the row lock", () => {
    const lockIdx = approve.search(/FOR\s+UPDATE/i);
    const readyIdx = approve.search(/evaluate_course_readiness/);
    expect(lockIdx).toBeGreaterThan(0);
    expect(readyIdx).toBeGreaterThan(lockIdx);
  });

  it("approve raises course_not_ready before any UPDATE / INSERT", () => {
    const readyIdx = approve.search(/course_not_ready/);
    const updateIdx = approve.search(/UPDATE\s+public\.courses/i);
    const auditIdx = approve.search(/INSERT\s+INTO\s+public\.audit_events/i);
    const notifIdx = approve.search(/INSERT\s+INTO\s+public\.notifications/i);
    expect(readyIdx).toBeGreaterThan(0);
    expect(readyIdx).toBeLessThan(updateIdx);
    expect(readyIdx).toBeLessThan(auditIdx);
    expect(readyIdx).toBeLessThan(notifIdx);
  });

  it("reject requires a non-empty trimmed reason before any write", () => {
    expect(reject).toMatch(/trim\(_reason\)\s*=\s*''/);
    const guardIdx = reject.search(/Reason required/);
    const updateIdx = reject.search(/UPDATE\s+public\.courses/i);
    expect(guardIdx).toBeGreaterThan(0);
    expect(guardIdx).toBeLessThan(updateIdx);
  });

  it("both emit an audit_events row and an instructor notification", () => {
    for (const body of [approve, reject]) {
      expect(body).toMatch(/INSERT\s+INTO\s+public\.audit_events/i);
      expect(body).toMatch(/INSERT\s+INTO\s+public\.notifications/i);
    }
  });

  it("approve transitions to approved + is_published = true", () => {
    expect(approve).toMatch(/review_status\s*=\s*'approved'/);
    expect(approve).toMatch(/is_published\s*=\s*true/);
  });

  it("reject transitions to rejected and does not publish", () => {
    expect(reject).toMatch(/review_status\s*=\s*'rejected'/);
    expect(reject).not.toMatch(/is_published\s*=\s*true/);
  });
});