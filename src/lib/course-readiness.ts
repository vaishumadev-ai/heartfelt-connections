/**
 * Authoritative course-readiness contract.
 *
 * The database RPC `evaluate_course_readiness` is the single source of truth
 * for whether a course may be submitted for review. This module:
 *   1. Normalises the raw jsonb payload safely (fail-closed on any malformed
 *      shape).
 *   2. Maps each known blocker code to stable instructor-facing copy, a
 *      grouping bucket, and a DOM focus target so the Studio can scroll
 *      offending fields into view.
 *   3. Treats unknown codes as blocking, so a database that gains new
 *      blockers never appears "ready" by accident on an old client.
 *
 * Raw `detail` strings are NEVER surfaced. Only the stable curated copy is
 * shown to instructors.
 */

export const READINESS_GROUPS = [
  "basics",
  "description",
  "instructor",
  "curriculum",
  "media",
  "pricing",
] as const;

export type ReadinessGroup = (typeof READINESS_GROUPS)[number];

export const READINESS_GROUP_LABELS: Record<ReadinessGroup, string> = {
  basics: "Course basics",
  description: "Description & learning",
  instructor: "Instructor presentation",
  curriculum: "Curriculum",
  media: "Cover artwork",
  pricing: "Pricing & delivery",
};

export type CourseReadinessBlocker = {
  /** Original database code, e.g. `title_too_short`. `unknown` if unmapped. */
  code: string;
  /** Optional lesson identifier for lesson-scoped blockers. */
  lesson_id: string | null;
  /** Curated instructor-facing sentence. Safe to render. */
  message: string;
  /** Broad section this blocker belongs to. */
  group: ReadinessGroup;
  /** DOM id (or reserved section id) the UI should focus/scroll to. */
  target: string;
  /** False when the code was not recognised by this client build. */
  known: boolean;
};

export type CourseReadinessResult = {
  is_ready: boolean;
  blockers: CourseReadinessBlocker[];
};

type Mapping = {
  message: string;
  group: ReadinessGroup;
  target: string;
};

/**
 * The full mapper. Every code raised by
 * `supabase/migrations/…_p0c1-corrections.sql :: evaluate_course_readiness`
 * must be listed here. Adding a new server-side code without updating this
 * mapper is safe: the unknown-code branch keeps the course blocked with a
 * neutral message so submission cannot slip through.
 */
const BLOCKER_MAP: Record<string, Mapping> = {
  title_too_short: {
    message: "Give your course a clear title of at least 6 characters.",
    group: "basics",
    target: "field-title",
  },
  slug_invalid: {
    message: "The course URL identifier is invalid. Contact support if this persists.",
    group: "basics",
    target: "field-slug",
  },
  subtitle_too_short: {
    message: "Add a short subtitle that summarises the course in one sentence.",
    group: "basics",
    target: "field-subtitle",
  },
  description_too_short: {
    message: "Expand the course description so learners know what to expect.",
    group: "description",
    target: "field-description",
  },
  category_missing: {
    message: "Choose a category so the course can be discovered.",
    group: "basics",
    target: "field-category",
  },
  level_missing: {
    message: "Pick a difficulty level.",
    group: "basics",
    target: "field-level",
  },
  language_missing: {
    message: "Pick the primary language of instruction.",
    group: "basics",
    target: "field-language",
  },
  duration_missing: {
    message: "Add an approximate course duration (for example: 6h 30m).",
    group: "basics",
    target: "field-duration",
  },
  cover_missing: {
    message: "Upload a course cover image.",
    group: "media",
    target: "section-cover",
  },
  cover_object_missing: {
    message: "Cover file is unavailable. Re-upload the cover image.",
    group: "media",
    target: "section-cover",
  },
  instructor_name_missing: {
    message: "Add the instructor's display name.",
    group: "instructor",
    target: "field-instructor-name",
  },
  instructor_title_missing: {
    message: "Add a short instructor title, for example: Senior Frontend Engineer.",
    group: "instructor",
    target: "field-instructor-title",
  },
  instructor_bio_too_short: {
    message: "Write an instructor bio of at least 40 characters.",
    group: "instructor",
    target: "field-instructor-bio",
  },
  learning_outcomes_insufficient: {
    message: "List at least three learning outcomes learners will gain.",
    group: "description",
    target: "field-learn-outcomes",
  },
  skills_missing: {
    message: "List the skills learners will practice.",
    group: "description",
    target: "field-skills",
  },
  requirements_missing: {
    message: "Describe any prerequisites or requirements.",
    group: "description",
    target: "field-requirements",
  },
  audience_missing: {
    message: "Describe the intended audience for this course.",
    group: "description",
    target: "field-audience",
  },
  not_free: {
    message: "Submission currently requires the course price to be Free.",
    group: "pricing",
    target: "field-price",
  },
  no_lessons: {
    message: "Add at least one lesson to the curriculum.",
    group: "curriculum",
    target: "section-curriculum",
  },
  lesson_module_missing: {
    message: "Assign a module title to this lesson.",
    group: "curriculum",
    target: "section-curriculum",
  },
  lesson_position_invalid: {
    message: "This lesson has an invalid position. Reorder the curriculum.",
    group: "curriculum",
    target: "section-curriculum",
  },
  lesson_content_thin: {
    message: "Add more content to this lesson before submitting.",
    group: "curriculum",
    target: "section-curriculum",
  },
  lesson_video_object_missing: {
    message: "Upload the video for this lesson.",
    group: "curriculum",
    target: "section-curriculum",
  },
  duplicate_lesson_position: {
    message: "Two lessons share the same position. Reorder the curriculum.",
    group: "curriculum",
    target: "section-curriculum",
  },
  no_preview_lesson: {
    message: "Mark at least one lesson as a free preview.",
    group: "curriculum",
    target: "section-curriculum",
  },
};

const UNKNOWN_MAPPING: Mapping = {
  message: "This course is not ready to submit. Update to the latest Studio to see details.",
  group: "basics",
  target: "section-readiness",
};

function normalizeLessonId(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 ? s : null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Parse a raw database blocker payload into the typed contract. Any
 * malformed shape (non-array, non-object items, missing/blank `code`) is
 * rejected fail-closed with `is_ready: false` and a single synthetic
 * blocker so the UI never claims readiness on a broken payload.
 */
export function normalizeReadinessBlockers(input: unknown): CourseReadinessBlocker[] {
  if (!Array.isArray(input)) return [];
  const out: CourseReadinessBlocker[] = [];
  for (const item of input) {
    if (!isPlainObject(item)) continue;
    const rawCode = item.code;
    if (typeof rawCode !== "string" || rawCode.trim() === "") continue;
    const code = rawCode.trim();
    const known = Object.prototype.hasOwnProperty.call(BLOCKER_MAP, code);
    const map = known ? BLOCKER_MAP[code] : UNKNOWN_MAPPING;
    out.push({
      code,
      lesson_id: normalizeLessonId(item.lesson_id),
      message: map.message,
      group: map.group,
      target: map.target,
      known,
    });
  }
  return out;
}

/**
 * Build the full readiness result from an RPC payload row (or the raw
 * first element of the RPC response). Fail-closed on any malformed shape.
 *
 * Accepted shapes:
 *   - `{ is_ready: boolean, blockers: any[] }`
 *   - `[ { is_ready, blockers } ]` (single-row TABLE response)
 *   - `null` / `undefined` — treated as fail-closed.
 */
export function normalizeReadinessResult(input: unknown): CourseReadinessResult {
  const row = Array.isArray(input) ? input[0] : input;
  if (!isPlainObject(row)) {
    return {
      is_ready: false,
      blockers: [
        {
          code: "readiness_unavailable",
          lesson_id: null,
          message: "Readiness could not be determined. Try again in a moment.",
          group: "basics",
          target: "section-readiness",
          known: false,
        },
      ],
    };
  }
  const blockers = normalizeReadinessBlockers(row.blockers);
  const isReady = row.is_ready === true && blockers.length === 0;
  return { is_ready: isReady, blockers };
}

/**
 * Group blockers by section, preserving server order within each group.
 * Returns groups in the canonical `READINESS_GROUPS` order.
 */
export function groupReadinessBlockers(
  blockers: CourseReadinessBlocker[],
): Array<{ group: ReadinessGroup; label: string; blockers: CourseReadinessBlocker[] }> {
  const buckets = new Map<ReadinessGroup, CourseReadinessBlocker[]>();
  for (const g of READINESS_GROUPS) buckets.set(g, []);
  for (const b of blockers) buckets.get(b.group)!.push(b);
  return READINESS_GROUPS.filter((g) => buckets.get(g)!.length > 0).map((g) => ({
    group: g,
    label: READINESS_GROUP_LABELS[g],
    blockers: buckets.get(g)!,
  }));
}

/** Test hook: expose the code list so future codes can be asserted-on. */
export function knownReadinessCodes(): string[] {
  return Object.keys(BLOCKER_MAP);
}
