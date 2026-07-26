/**
 * P0C.1 corrections — static SQL parsing tests.
 *
 * These tests inspect the correction migration file on disk. They do NOT
 * execute SQL against a live database; live behavior is verified in the
 * hosted E2E matrix which remains parked.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");

function loadByMarker(marker: string): string {
  for (const f of readdirSync(MIGRATIONS_DIR).sort()) {
    const body = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
    if (body.includes(marker)) return body;
  }
  throw new Error(`Migration containing ${marker} not found`);
}

describe("P0C.1 corrections — readiness contract (static SQL)", () => {
  const sql = loadByMarker("P0C.1 Corrections");

  it("recreates evaluate_course_readiness with a jsonb blocker array", () => {
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS public\.evaluate_course_readiness\(uuid\)/i);
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.evaluate_course_readiness\(_course_id uuid\)\s+RETURNS TABLE\(is_ready boolean,\s*blockers jsonb\)/i,
    );
  });

  const courseBlockers: [string, RegExp][] = [
    ["title_too_short", /char_length\(btrim\(coalesce\(_r\.title[^)]*\)\)\)\s*<\s*5/i],
    ["slug_invalid", /slug_invalid/],
    ["subtitle_too_short", /char_length\(btrim\(coalesce\(_r\.subtitle[^)]*\)\)\)\s*<\s*10/i],
    ["description_too_short", /char_length\(btrim\(coalesce\(_r\.description[^)]*\)\)\)\s*<\s*200/i],
    ["category_missing", /category_missing/],
    ["level_missing", /level_missing/],
    ["language_missing", /language_missing/],
    ["duration_missing", /duration_missing/],
    ["cover_missing", /cover_missing/],
    ["cover_object_missing", /cover_object_missing/],
    ["instructor_name_missing", /instructor_name_missing/],
    ["instructor_title_missing", /instructor_title_missing/],
    ["instructor_bio_too_short", /char_length\(btrim\(coalesce\(_r\.instructor_bio[^)]*\)\)\)\s*<\s*80/i],
    ["learning_outcomes_insufficient", /cardinality\(coalesce\(_r\.learn_outcomes[^)]*\)\)\s*<\s*3/i],
    ["skills_missing", /cardinality\(coalesce\(_r\.skills[^)]*\)\)\s*<\s*1/i],
    ["requirements_missing", /cardinality\(coalesce\(_r\.requirements[^)]*\)\)\s*<\s*1/i],
    ["audience_missing", /cardinality\(coalesce\(_r\.audience[^)]*\)\)\s*<\s*1/i],
    ["not_free", /not_free/],
    ["certificate_unavailable", /certificate_unavailable/],
  ];
  for (const [code, pat] of courseBlockers) {
    it(`emits ${code} using the locked expression`, () => {
      expect(sql).toMatch(new RegExp(`'${code}'`));
      expect(sql).toMatch(pat);
    });
  }

  const curriculumBlockers = [
    "no_lessons",
    "lesson_module_missing",
    "lesson_position_invalid",
    "duplicate_lesson_position",
    "lesson_content_thin",
    "lesson_video_object_missing",
    "no_preview_lesson",
  ];
  for (const code of curriculumBlockers) {
    it(`emits curriculum blocker ${code}`, () => {
      expect(sql).toMatch(new RegExp(`'${code}'`));
    });
  }

  it("attaches lesson_id to per-lesson blockers", () => {
    for (const code of [
      "lesson_module_missing",
      "lesson_position_invalid",
      "lesson_content_thin",
      "lesson_video_object_missing",
    ]) {
      const re = new RegExp(`'${code}'[^)]*'lesson_id'[^)]*_lesson\\.id`);
      expect(sql, `${code} missing lesson_id`).toMatch(re);
    }
  });

  it("accepts written-only lessons: content ≥ 40 without video is not thin", () => {
    // Requires BOTH content < 40 AND video_storage_path IS NULL
    expect(sql).toMatch(
      /char_length\(btrim\(_lesson\.content\)\)\s*<\s*40\s+AND\s+_lesson\.video_storage_path\s+IS\s+NULL/i,
    );
  });

  it("accepts video-only lessons: no requirement that every lesson have video", () => {
    // No blocker literal for missing lesson video (except when a referenced
    // object is missing).
    expect(sql).not.toMatch(/'lessons_missing_video'/);
  });

  it("uses coalesce + cardinality parity between NULL and empty arrays", () => {
    for (const col of ["learn_outcomes", "skills", "requirements", "audience"]) {
      const re = new RegExp(`cardinality\\(coalesce\\(_r\\.${col},\\s*'\\{\\}'::text\\[\\]\\)\\)`, "i");
      expect(sql, `${col} not coalesced`).toMatch(re);
    }
  });

  it("checks referenced storage objects for cover and per-lesson video", () => {
    expect(sql).toMatch(
      /NOT EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+storage\.objects[\s\S]*bucket_id\s*=\s*'course-covers'[\s\S]*name\s*=\s*_r\.cover_storage_path/i,
    );
    expect(sql).toMatch(
      /NOT EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+storage\.objects[\s\S]*bucket_id\s*=\s*'course-videos'[\s\S]*name\s*=\s*_lesson\.video_storage_path/i,
    );
  });
});

describe("P0C.1 corrections — submission enforcement (static SQL)", () => {
  const sql = loadByMarker("P0C.1 Corrections");
  const fn = /CREATE OR REPLACE FUNCTION public\.submit_course_for_review[\s\S]*?\$\$;/i.exec(sql)!;

  it("recalculates readiness inside the same transaction", () => {
    expect(fn[0]).toMatch(
      /FROM\s+public\.evaluate_course_readiness\(_course_id\)/i,
    );
  });

  it("raises a stable course_not_ready error with structured blocker DETAIL", () => {
    expect(fn[0]).toMatch(/RAISE EXCEPTION\s+'course_not_ready'/i);
    expect(fn[0]).toMatch(/DETAIL\s*=\s*_blockers::text/i);
  });

  it("performs no governance mutation before the readiness check passes", () => {
    // Order: readiness check must precede UPDATE ... review_status
    const readyIdx = fn[0].search(/evaluate_course_readiness/i);
    const updateIdx = fn[0].search(/UPDATE\s+public\.courses/i);
    expect(readyIdx).toBeGreaterThan(0);
    expect(updateIdx).toBeGreaterThan(readyIdx);
  });

  it("does not comma-join blocker text into the error message", () => {
    expect(fn[0]).not.toMatch(/array_to_string/i);
  });
});

describe("P0C.1 corrections — storage upload restrictions (static SQL)", () => {
  const sql = loadByMarker("P0C.1 Corrections");

  it("removes video/quicktime from media_config", () => {
    expect(sql).toMatch(
      /UPDATE public\.media_config[\s\S]*ARRAY\['video\/mp4','video\/webm'\][\s\S]*WHERE\s+bucket\s*=\s*'course-videos'/i,
    );
    expect(sql).not.toMatch(/video\/quicktime/i);
  });

  it("INSERT policies enforce size against media_config at upload time", () => {
    for (const bucket of ["course-covers", "course-videos"]) {
      const re = new RegExp(
        `\\(metadata->>'size'\\)::bigint\\s*<=\\s*\\(SELECT\\s+file_size_limit\\s+FROM\\s+public\\.media_config\\s+WHERE\\s+bucket\\s*=\\s*'${bucket}'\\)`,
        "i",
      );
      expect(sql, `${bucket} INSERT policy missing size check`).toMatch(re);
    }
  });

  it("INSERT policies enforce MIME against media_config at upload time", () => {
    for (const bucket of ["course-covers", "course-videos"]) {
      const re = new RegExp(
        `\\(metadata->>'mimetype'\\)\\s+IN\\s*\\([\\s\\S]*unnest\\(allowed_mime_types\\)[\\s\\S]*bucket\\s*=\\s*'${bucket}'`,
        "i",
      );
      expect(sql, `${bucket} INSERT policy missing mime check`).toMatch(re);
    }
  });
});

describe("P0C.1 corrections — anonymous lesson closure (static SQL)", () => {
  const sql = loadByMarker("P0C.1 Corrections");

  it("revokes table-level SELECT from anon on lessons", () => {
    expect(sql).toMatch(/REVOKE\s+SELECT\s+ON\s+public\.lessons\s+FROM\s+anon/i);
  });

  it("restores only the safe preview column whitelist to anon", () => {
    const m = /GRANT\s+SELECT\s*\(([\s\S]*?)\)\s+ON\s+public\.lessons\s+TO\s+anon/i.exec(sql);
    expect(m, "column grant not found").not.toBeNull();
    const cols = m![1];
    for (const c of [
      "id",
      "course_id",
      '"position"',
      "title",
      "duration_seconds",
      "is_preview",
      "module_title",
    ]) {
      expect(cols, `whitelist missing ${c}`).toContain(c);
    }
    for (const forbidden of [
      "video_storage_path",
      "video_url",
      "content",
      "video_original_name",
      "video_mime_type",
      "video_size_bytes",
      "video_duration_seconds",
      "video_uploaded_at",
    ]) {
      expect(cols, `whitelist must not expose ${forbidden}`).not.toMatch(
        new RegExp(`\\b${forbidden}\\b`),
      );
    }
  });
});

describe("P0C.1 corrections — reorder overflow safety (static SQL)", () => {
  const sql = loadByMarker("P0C.1 Corrections");
  const fn = /CREATE OR REPLACE FUNCTION public\.reorder_lessons[\s\S]*?\$\$;/i.exec(sql)!;

  it("no longer relies on a +1_000_000 shuffle", () => {
    expect(fn[0]).not.toMatch(/"position"\s*\+\s*1000000/);
    expect(fn[0]).not.toMatch(/"position"\s*\+\s*1_?000_?000/);
  });

  it("defers and re-checks lessons_course_position_uniq inside the RPC", () => {
    expect(fn[0]).toMatch(/SET\s+CONSTRAINTS\s+lessons_course_position_uniq\s+DEFERRED/i);
    expect(fn[0]).toMatch(/SET\s+CONSTRAINTS\s+lessons_course_position_uniq\s+IMMEDIATE/i);
  });

  it("assigns positions directly from unnest WITH ORDINALITY", () => {
    expect(fn[0]).toMatch(/unnest\(_lesson_ids\)\s+WITH\s+ORDINALITY/i);
  });

  it("rejects null lesson ids and duplicates and enforces exact set", () => {
    expect(fn[0]).toMatch(/Null lesson id/i);
    expect(fn[0]).toMatch(/Duplicate lesson ids/i);
    expect(fn[0]).toMatch(/Lesson set mismatch/i);
  });

  it("keeps the shared course-scoped advisory lock", () => {
    expect(fn[0]).toMatch(
      /pg_advisory_xact_lock\(hashtext\('mozok\.course_lessons:'\s*\|\|\s*_course_id::text\)\)/i,
    );
  });
});

describe("P0C.1 corrections — helper function privilege closure (static SQL)", () => {
  const sql = loadByMarker("P0C.1 Corrections");

  for (const fname of [
    "lock_course_for_lesson_mutation",
    "protect_course_governance",
    "protect_final_admin",
    "enforce_course_content_lock",
    "enforce_lesson_content_lock",
    "enforce_course_delete",
    "enforce_lesson_delete",
    "set_updated_at",
    "notify_on_enrollment",
    "handle_new_user",
    "_learner_entitled",
  ]) {
    it(`revokes EXECUTE from anon/authenticated/PUBLIC on internal ${fname}`, () => {
      const re = new RegExp(
        `REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+public\\.${fname}[^;]*FROM\\s+PUBLIC,\\s*anon,\\s*authenticated`,
        "i",
      );
      expect(sql, `${fname} missing revoke`).toMatch(re);
    });
  }
});

describe("P0C.1 corrections — server function refetch (static)", () => {
  const src = readFileSync(join(process.cwd(), "src/lib/courses.functions.ts"), "utf8");

  it("submitCourseForReview refetches structured blockers on course_not_ready", () => {
    expect(src).toMatch(/course_not_ready/);
    expect(src).toMatch(/evaluate_course_readiness/);
    expect(src).not.toMatch(/blockers\.join\(/);
  });
});

describe("P0C.1 corrections — private cover architecture (static)", () => {
  it("no getPublicUrl call targets the course-covers bucket", async () => {
    const walk = async (dir: string): Promise<string[]> => {
      const entries = await import("node:fs").then((m) => m.promises.readdir(dir, { withFileTypes: true }));
      const out: string[] = [];
      for (const e of entries) {
        const p = join(dir, e.name);
        if (e.isDirectory()) out.push(...(await walk(p)));
        else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
      }
      return out;
    };
    const files = await walk(join(process.cwd(), "src"));
    const offenders: string[] = [];
    for (const f of files) {
      const body = readFileSync(f, "utf8");
      if (/getPublicUrl\([^)]*['"]course-covers['"]/i.test(body)) offenders.push(f);
      if (/from\(['"]course-covers['"]\)[\s\S]{0,80}getPublicUrl/i.test(body)) offenders.push(f);
    }
    expect(offenders, `getPublicUrl used on private bucket in: ${offenders.join(", ")}`).toHaveLength(0);
  });
});