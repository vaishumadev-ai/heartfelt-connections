/**
 * P0C.1 migration-contract tests.
 *
 * Static SQL parsing of the media-foundation and privilege-closure
 * migrations. Local checks only; hosted verification of the applied
 * database remains a separate matrix item.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");

function allMigrationSql(): string {
  return readdirSync(MIGRATIONS_DIR)
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"))
    .join("\n\n");
}

function loadByMarker(marker: string): string {
  const files = readdirSync(MIGRATIONS_DIR).sort();
  for (const f of files) {
    const body = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
    if (body.includes(marker)) return body;
  }
  throw new Error(`Migration containing ${marker} not found`);
}

describe("P0C.1 privilege closure", () => {
  const sql = loadByMarker("P0C.1 — Media Foundation");

  it("revokes ALL from PUBLIC/anon/authenticated across every public table", () => {
    expect(sql).toMatch(/REVOKE\s+ALL\s+ON\s+public\.%I\s+FROM\s+PUBLIC/i);
    expect(sql).toMatch(/REVOKE\s+ALL\s+ON\s+public\.%I\s+FROM\s+anon/i);
    expect(sql).toMatch(/REVOKE\s+ALL\s+ON\s+public\.%I\s+FROM\s+authenticated/i);
  });

  it("does not re-grant TRUNCATE/REFERENCES/TRIGGER/MAINTAIN anywhere", () => {
    expect(sql).not.toMatch(/GRANT[^;]*\bTRUNCATE\b[^;]*TO\s+(anon|authenticated|PUBLIC)/i);
    expect(sql).not.toMatch(/GRANT[^;]*\bREFERENCES\b[^;]*TO\s+(anon|authenticated|PUBLIC)/i);
    expect(sql).not.toMatch(/GRANT[^;]*\bTRIGGER\b[^;]*TO\s+(anon|authenticated|PUBLIC)/i);
    expect(sql).not.toMatch(/GRANT[^;]*\bMAINTAIN\b[^;]*TO\s+(anon|authenticated|PUBLIC)/i);
  });

  it("locks cover_url and certificate against direct UPDATE", () => {
    expect(sql).toMatch(
      /REVOKE\s+UPDATE\s*\([^)]*cover_url[^)]*certificate[^)]*\)\s+ON\s+public\.courses\s+FROM\s+authenticated/i,
    );
  });

  it("gives learner-history tables SELECT only for authenticated", () => {
    for (const t of [
      "enrollments",
      "lesson_completions",
      "lesson_notes",
      "lesson_bookmarks",
      "instructor_applications",
    ]) {
      const re = new RegExp(`GRANT\\s+SELECT\\s+ON\\s+public\\.${t}\\s+TO\\s+authenticated`, "i");
      expect(sql, `expected SELECT-only grant for ${t}`).toMatch(re);
      const bad = new RegExp(
        `GRANT[^;]*\\b(INSERT|UPDATE|DELETE)\\b[^;]*ON\\s+public\\.${t}\\s+TO\\s+(anon|authenticated|PUBLIC)`,
        "i",
      );
      expect(sql, `unexpected write grant for ${t}`).not.toMatch(bad);
    }
  });

  it("never grants anything on audit_events to anon/authenticated/PUBLIC", () => {
    expect(sql).not.toMatch(
      /GRANT[^;]+ON\s+public\.audit_events\s+TO\s+(anon|authenticated|PUBLIC)/i,
    );
  });
});

describe("P0C.1 media schema + RPCs", () => {
  const sql = loadByMarker("P0C.1 — Media Foundation");

  it("adds cover_storage_path and video_storage_path", () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS cover_storage_path text/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS video_storage_path text/i);
  });

  it("does not grant INSERT/UPDATE on the new storage-path columns", () => {
    expect(sql).not.toMatch(
      /GRANT[^;]*\b(INSERT|UPDATE)\b[^;]*cover_storage_path[^;]*TO\s+(anon|authenticated)/i,
    );
    expect(sql).not.toMatch(
      /GRANT[^;]*\b(INSERT|UPDATE)\b[^;]*video_storage_path[^;]*TO\s+(anon|authenticated)/i,
    );
  });

  it("declares media_config as the single limits source", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.media_config/i);
    expect(sql).toMatch(/'course-covers'\s*,\s*5242880/);
    expect(sql).toMatch(/'course-videos'\s*,\s*52428800/);
  });

  it("get_media_limits reads from media_config (not storage.buckets)", () => {
    const fn = sql.match(
      /CREATE OR REPLACE FUNCTION public\.get_media_limits[\s\S]*?\$\$;/i,
    );
    expect(fn).not.toBeNull();
    expect(fn![0]).toMatch(/FROM\s+public\.media_config/i);
    expect(fn![0]).not.toMatch(/FROM\s+storage\.buckets/i);
  });

  for (const fname of [
    "attach_course_cover",
    "detach_course_cover",
    "attach_lesson_video",
    "detach_lesson_video",
    "reorder_lessons",
    "evaluate_course_readiness",
    "get_media_limits",
  ]) {
    it(`${fname} is SECURITY DEFINER with pinned search_path and EXECUTE only for authenticated`, () => {
      const fn = new RegExp(
        `CREATE OR REPLACE FUNCTION public\\.${fname}[\\s\\S]*?\\$\\$;`,
        "i",
      ).exec(sql);
      expect(fn, `function ${fname} missing`).not.toBeNull();
      expect(fn![0]).toMatch(/SECURITY\s+DEFINER/i);
      expect(fn![0]).toMatch(/SET\s+search_path\s*=\s*public/i);
      const revoke = new RegExp(
        `REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+public\\.${fname}[^;]*FROM\\s+PUBLIC`,
        "i",
      );
      const grant = new RegExp(
        `GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${fname}[^;]*TO\\s+authenticated`,
        "i",
      );
      expect(sql, `${fname} missing REVOKE FROM PUBLIC`).toMatch(revoke);
      expect(sql, `${fname} missing GRANT to authenticated`).toMatch(grant);
    });
  }

  it("finalization RPCs compare size against media_config, not a hardcoded literal", () => {
    for (const fname of ["attach_course_cover", "attach_lesson_video"]) {
      const fn = new RegExp(
        `CREATE OR REPLACE FUNCTION public\\.${fname}[\\s\\S]*?\\$\\$;`,
        "i",
      ).exec(sql)!;
      expect(fn[0]).toMatch(/FROM\s+public\.media_config/i);
      expect(fn[0]).toMatch(/_size\s*>\s*_limit/);
      expect(fn[0]).not.toMatch(/\b52428800\b/);
      expect(fn[0]).not.toMatch(/\b5242880\b/);
    }
  });

  it("finalization RPCs verify owner + course editability + path prefix", () => {
    for (const fname of ["attach_course_cover", "attach_lesson_video"]) {
      const fn = new RegExp(
        `CREATE OR REPLACE FUNCTION public\\.${fname}[\\s\\S]*?\\$\\$;`,
        "i",
      ).exec(sql)!;
      expect(fn[0]).toMatch(/course_is_editable/i);
      expect(fn[0]).toMatch(/_object_course_id\(_path\)/i);
      expect(fn[0]).toMatch(/_owner\s*<>\s*_uid/);
    }
  });
});

describe("P0C.1 reorder concurrency", () => {
  const sql = loadByMarker("P0C.1 — Media Foundation");

  it("adds UNIQUE(course_id, position) on lessons", () => {
    expect(sql).toMatch(
      /ADD\s+CONSTRAINT\s+lessons_course_position_uniq\s+UNIQUE\s*\(\s*course_id\s*,\s*"position"\s*\)/i,
    );
  });

  it("declares a course-scoped BEFORE trigger covering INSERT/UPDATE/DELETE", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.lock_course_for_lesson_mutation/i);
    expect(sql).toMatch(
      /CREATE TRIGGER lessons_lock_course_before[\s\S]*BEFORE\s+INSERT\s+OR\s+UPDATE\s+OR\s+DELETE[\s\S]*ON\s+public\.lessons/i,
    );
  });

  it("uses pg_advisory_xact_lock with a course-scoped key in the trigger and reorder RPC", () => {
    const trg = sql.match(
      /CREATE OR REPLACE FUNCTION public\.lock_course_for_lesson_mutation[\s\S]*?\$\$;/i,
    )!;
    const rpc = sql.match(
      /CREATE OR REPLACE FUNCTION public\.reorder_lessons[\s\S]*?\$\$;/i,
    )!;
    for (const block of [trg[0], rpc[0]]) {
      expect(block).toMatch(
        /pg_advisory_xact_lock\(hashtext\('mozok\.course_lessons:'\s*\|\|/,
      );
    }
  });

  it("trigger has no session-marker or system-role bypass", () => {
    const trg = sql.match(
      /CREATE OR REPLACE FUNCTION public\.lock_course_for_lesson_mutation[\s\S]*?\$\$;/i,
    )!;
    expect(trg[0]).not.toMatch(/current_setting\s*\(/i);
    expect(trg[0]).not.toMatch(/current_user\s+IN/i);
    expect(trg[0]).not.toMatch(/session_user/i);
  });

  it("trigger prohibits course reassignment on UPDATE", () => {
    const trg = sql.match(
      /CREATE OR REPLACE FUNCTION public\.lock_course_for_lesson_mutation[\s\S]*?\$\$;/i,
    )!;
    expect(trg[0]).toMatch(/course_id\s+IS\s+DISTINCT\s+FROM\s+OLD\.course_id/i);
    expect(trg[0]).toMatch(/Lesson cannot be reassigned/i);
  });

  it("reorder_lessons enforces exact-set membership and rejects duplicates", () => {
    const rpc = sql.match(
      /CREATE OR REPLACE FUNCTION public\.reorder_lessons[\s\S]*?\$\$;/i,
    )!;
    expect(rpc[0]).toMatch(/Duplicate lesson ids/i);
    expect(rpc[0]).toMatch(/Lesson set mismatch/i);
    expect(rpc[0]).toMatch(/course_is_editable/i);
    expect(rpc[0]).toMatch(/"position"\s*\+\s*1000000/);
    expect(rpc[0]).not.toMatch(/"position"\s*\*\s*-1/);
  });
});

describe("P0C.1 storage RLS policies", () => {
  const sql = loadByMarker("P0C.1 — Media Foundation");

  it("uploads require caller-owned editable course", () => {
    for (const name of [
      "covers_insert_own_editable_course",
      "videos_insert_own_editable_course",
    ]) {
      const p = new RegExp(`CREATE POLICY\\s+"${name}"[\\s\\S]*?\\);`, "i").exec(sql);
      expect(p, `policy ${name} missing`).not.toBeNull();
      expect(p![0]).toMatch(/owner\s*=\s*auth\.uid\(\)/i);
      expect(p![0]).toMatch(/course_is_editable/i);
      expect(p![0]).toMatch(/instructor_id\s*=\s*auth\.uid\(\)/i);
    }
  });

  it("video read is limited to owning instructor or entitled learner", () => {
    const p = /CREATE POLICY\s+"videos_read_entitled"[\s\S]*?\);/i.exec(sql)!;
    expect(p[0]).toMatch(/instructor_id\s*=\s*auth\.uid\(\)/i);
    expect(p[0]).toMatch(/enrollments/i);
    expect(p[0]).toMatch(/is_published\s*=\s*true/i);
    expect(p[0]).toMatch(/price_cents\s*=\s*0/i);
    expect(p[0]).toMatch(/l\.video_storage_path\s*=\s*storage\.objects\.name/i);
  });

  it("delete policies forbid deletion of attached media", () => {
    const covers = /CREATE POLICY\s+"covers_delete_own_unattached"[\s\S]*?\);/i.exec(sql)!;
    expect(covers[0]).toMatch(
      /NOT EXISTS\s*\([\s\S]*cover_storage_path\s*=\s*storage\.objects\.name/i,
    );
    const videos = /CREATE POLICY\s+"videos_delete_own_unattached"[\s\S]*?\);/i.exec(sql)!;
    expect(videos[0]).toMatch(
      /NOT EXISTS\s*\([\s\S]*video_storage_path\s*=\s*storage\.objects\.name/i,
    );
  });
});

describe("P0C.1 column-grant restoration hotfix", () => {
  const sql = loadByMarker("Fix column grants inadvertently removed");

  it("restores INSERT/UPDATE column grants on courses but not cover_url/certificate/cover_storage_path", () => {
    expect(sql).toMatch(/GRANT\s+INSERT\s*\([^)]*\btitle\b[^)]*\)\s+ON\s+public\.courses\s+TO\s+authenticated/i);
    expect(sql).toMatch(/GRANT\s+UPDATE\s*\([^)]*\bdescription\b[^)]*\)\s+ON\s+public\.courses\s+TO\s+authenticated/i);
    const grants = sql.match(/GRANT\s+(INSERT|UPDATE)\s*\([^)]*\)\s+ON\s+public\.courses\s+TO\s+authenticated/gi) || [];
    for (const g of grants) {
      expect(g).not.toMatch(/\bcover_url\b/);
      expect(g).not.toMatch(/\bcertificate\b/);
      expect(g).not.toMatch(/\bcover_storage_path\b/);
    }
  });

  it("restores lesson INSERT/UPDATE column grants but not video_storage_path", () => {
    const grants = sql.match(/GRANT\s+(INSERT|UPDATE)\s*\([^)]*\)\s+ON\s+public\.lessons\s+TO\s+authenticated/gi) || [];
    expect(grants.length).toBeGreaterThanOrEqual(2);
    for (const g of grants) {
      expect(g).not.toMatch(/\bvideo_storage_path\b/);
    }
    expect(grants.join("\n")).toMatch(/\bvideo_url\b/);
  });
});
