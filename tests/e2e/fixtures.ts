import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  assertTestProject,
  assertValidFixtureNamespace,
  isValidFixtureNamespace,
} from "@/lib/testing/production-guard";

/**
 * Deterministic E2E fixtures. All rows created here are tagged with a
 * per-run namespace so teardown removes only the suite's own rows.
 *
 * Never call this from browser or app code. Service-role only, Node-only.
 */

export type FixtureSlugs = {
  namespace: string;
  freeSlug: string;
  paidSlug: string;
  freeCourseId: string;
  paidCourseId: string;
};

function isNewKey(v: string) {
  return v.startsWith("sb_publishable_") || v.startsWith("sb_secret_");
}

function adminClient(): SupabaseClient {
  const url = process.env.TEST_SUPABASE_URL!;
  const key = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!;
  assertTestProject(
    {
      testSupabaseUrl: url,
      fixtureClientUrl: url,
      supabaseUrl: process.env.SUPABASE_URL,
      viteSupabaseUrl: process.env.VITE_SUPABASE_URL,
      projectId: process.env.SUPABASE_PROJECT_ID,
      viteProjectId: process.env.VITE_SUPABASE_PROJECT_ID,
    },
    "fixtures",
  );
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (isNewKey(key) && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
}

function nsPrefix(): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 6);
  return `pw-${stamp}-${rand}`;
}

/**
 * Preflight — confirm the dedicated test project actually has the Mozok
 * schema before we attempt any fixture insert. A blank Supabase project has
 * no tables and would surface as a confusing 500 during setup.
 *
 * We probe with `select ... limit 0` on each required table/column. Any
 * error is treated as "schema missing" and we emit an actionable message
 * telling the operator to apply repository migrations to the test project.
 */
const REQUIRED_TABLE_COLUMNS: Record<string, string[]> = {
  courses: [
    "id",
    "slug",
    "price_cents",
    "is_published",
    "category",
    "learn_outcomes",
    "skills",
    "requirements",
    "audience",
    "faq",
    "certificate",
  ],
  lessons: ["id", "course_id", "module_title", "is_preview", "content", "position"],
  enrollments: ["id", "user_id", "course_id"],
  lesson_completions: ["id", "user_id", "course_id", "lesson_id"],
  reviews: ["id", "user_id", "course_id", "rating"],
  notifications: ["id", "user_id", "title"],
  user_roles: ["id", "user_id", "role"],
};

async function verifyTestSchema(supabase: SupabaseClient): Promise<void> {
  const failures: string[] = [];
  for (const [table, cols] of Object.entries(REQUIRED_TABLE_COLUMNS)) {
    const { error } = await supabase.from(table).select(cols.join(",")).limit(0);
    if (error) failures.push(`${table}: ${error.message}`);
  }
  if (failures.length > 0) {
    throw new Error(
      [
        "[fixtures/preflight] The dedicated test Supabase project is missing required schema.",
        "Apply every migration under supabase/migrations to the test project in order,",
        "then re-run bun run test:e2e.",
        "Missing or incompatible objects:",
        ...failures.map((f) => `  - ${f}`),
      ].join("\n"),
    );
  }
}

/** Insert a deterministic set of fixtures and return the identifying slugs. */
export async function createFixtures(): Promise<FixtureSlugs> {
  const rawNs = process.env.PW_FIXTURE_NAMESPACE || nsPrefix();
  const namespace = assertValidFixtureNamespace(rawNs, "fixtures");
  process.env.PW_FIXTURE_NAMESPACE = namespace;

  const supabase = adminClient();
  await verifyTestSchema(supabase);

  const freeSlug = `${namespace}-free`;
  const paidSlug = `${namespace}-paid`;

  const baseCourse = {
    is_published: true,
    level: "Beginner",
    language: "English",
    duration_label: "6 hours",
    rating: 4.7,
    likes: 128,
    students_count: 512,
    icon_kind: "book",
    learn_outcomes: [
      "Understand the core fundamentals",
      "Apply concepts to a real project",
      "Ship with confidence",
    ],
    skills: ["React", "TanStack", "Testing"],
    requirements: ["A computer", "Basic JavaScript"],
    audience: ["Beginners", "Curious learners"],
    faq: [
      { q: "Do I need prior experience?", a: "No — beginners welcome." },
      { q: "Is there a certificate?", a: "Yes, upon completion." },
    ],
    instructor_name: "Fixture Instructor",
    instructor_title: "Senior Fixture Engineer",
    instructor_bio: "Deterministic instructor for the E2E suite.",
    certificate: true,
  } as const;

  // Track every successfully-created course id so we can perform exact-ID
  // cleanup if a later step fails.
  const createdCourseIds: string[] = [];
  const abortWithCleanup = async (originalErr: Error): Promise<never> => {
    if (createdCourseIds.length === 0) throw originalErr;
    try {
      await destroyFixturesByIds({
        namespace,
        courseIds: createdCourseIds,
        expectedSlugs: [freeSlug, paidSlug],
      });
    } catch (cleanupErr) {
      const cause = (cleanupErr as Error).message;
      const err = new Error(
        `${originalErr.message}\n[fixtures/setup] partial-cleanup also failed: ${cause}`,
      );
      (err as Error & { cause?: unknown }).cause = originalErr;
      throw err;
    }
    throw originalErr;
  };

  const { data: free, error: freeErr } = await supabase
    .from("courses")
    .insert({
      ...baseCourse,
      slug: freeSlug,
      title: `[${namespace}] Free Course Fixture`,
      subtitle: "A deterministic free course used by the Playwright E2E suite.",
      description:
        "This course is created by the E2E fixture bootstrap and cleaned up in teardown.",
      category: "fixtures",
      price_cents: 0,
    })
    .select("id")
    .single();
  if (freeErr || !free) {
    return abortWithCleanup(new Error(`fixture free course insert failed: ${freeErr?.message}`));
  }
  createdCourseIds.push(free.id);

  const { data: paid, error: paidErr } = await supabase
    .from("courses")
    .insert({
      ...baseCourse,
      slug: paidSlug,
      title: `[${namespace}] Paid Course Fixture`,
      subtitle: "A deterministic paid course used by the Playwright E2E suite.",
      description: "This paid course is used to verify price-rendering and guest CTA copy.",
      category: "fixtures",
      price_cents: 4900,
    })
    .select("id")
    .single();
  if (paidErr || !paid) {
    return abortWithCleanup(new Error(`fixture paid course insert failed: ${paidErr?.message}`));
  }
  createdCourseIds.push(paid.id);

  // Insert modules/lessons for the free course (preview + protected).
  const lessons = [
    {
      course_id: free.id,
      position: 1,
      title: "Welcome & tour",
      duration_seconds: 240,
      module_title: "Module 1 — Getting started",
      is_preview: true,
      content: "Preview lesson visible to guests.",
    },
    {
      course_id: free.id,
      position: 2,
      title: "Setting up your environment",
      duration_seconds: 600,
      module_title: "Module 1 — Getting started",
      is_preview: false,
      content: "Protected lesson content.",
    },
    {
      course_id: free.id,
      position: 3,
      title: "Your first project",
      duration_seconds: 1200,
      module_title: "Module 2 — Building",
      is_preview: false,
      content: "Protected lesson content.",
    },
    {
      course_id: free.id,
      position: 4,
      title: "Testing basics",
      duration_seconds: 900,
      module_title: "Module 2 — Building",
      is_preview: false,
      content: "Protected lesson content.",
    },
  ];
  const { error: lessonsErr } = await supabase.from("lessons").insert(lessons);
  if (lessonsErr) {
    return abortWithCleanup(new Error(`fixture lessons insert failed: ${lessonsErr.message}`));
  }

  // Add one preview lesson on the paid course too so both course pages render
  // a curriculum block during tests.
  const paidLessons = [
    {
      course_id: paid.id,
      position: 1,
      title: "Paid preview",
      duration_seconds: 300,
      module_title: "Module 1 — Overview",
      is_preview: true,
      content: "Preview lesson visible to guests.",
    },
    {
      course_id: paid.id,
      position: 2,
      title: "Behind the paywall",
      duration_seconds: 1500,
      module_title: "Module 1 — Overview",
      is_preview: false,
      content: "Protected lesson content.",
    },
  ];
  const { error: paidLessonsErr } = await supabase.from("lessons").insert(paidLessons);
  if (paidLessonsErr) {
    return abortWithCleanup(
      new Error(`fixture paid lessons insert failed: ${paidLessonsErr.message}`),
    );
  }

  return {
    namespace,
    freeSlug,
    paidSlug,
    freeCourseId: free.id,
    paidCourseId: paid.id,
  };
}

/**
 * Exact-ID cleanup. Never uses a LIKE-based delete. The caller supplies the
 * verified UUIDs (from fixture state) and the validated namespace. Before
 * deleting, each course row is loaded and verified:
 *   - category is 'fixtures'
 *   - slug starts with the validated namespace + '-'
 *   - id matches the caller-supplied list
 * If any verification fails, we abort without deleting.
 */
export async function destroyFixturesByIds(input: {
  namespace: string;
  courseIds: string[];
  expectedSlugs?: string[];
}): Promise<{ deletedCourses: number }> {
  const namespace = assertValidFixtureNamespace(input.namespace, "teardown");
  const ids = Array.from(new Set(input.courseIds.filter((v) => typeof v === "string" && v.length > 0)));
  if (ids.length === 0) return { deletedCourses: 0 };

  const supabase = adminClient();

  // Load exact rows and verify each before deletion.
  const { data: rows, error: findErr } = await supabase
    .from("courses")
    .select("id,slug,category")
    .in("id", ids);
  if (findErr) throw new Error(`fixture teardown lookup failed: ${findErr.message}`);
  const found = new Map((rows ?? []).map((r) => [r.id as string, r] as const));

  for (const id of ids) {
    const row = found.get(id);
    if (!row) {
      // A row that no longer exists is not an error, but we skip it.
      continue;
    }
    if (row.category !== "fixtures") {
      throw new Error(
        `[fixtures/teardown] refusing to delete course id=${id}: category '${row.category}' is not 'fixtures'.`,
      );
    }
    const slug = row.slug as string;
    if (!slug || !slug.startsWith(`${namespace}-`)) {
      throw new Error(
        `[fixtures/teardown] refusing to delete course id=${id}: slug '${slug}' does not start with namespace '${namespace}-'.`,
      );
    }
    if (input.expectedSlugs && !input.expectedSlugs.includes(slug)) {
      throw new Error(
        `[fixtures/teardown] refusing to delete course id=${id}: slug '${slug}' not in expected list.`,
      );
    }
  }

  const verifiedIds = Array.from(found.keys());
  if (verifiedIds.length === 0) return { deletedCourses: 0 };

  const cascades: { table: "lessons" | "reviews" | "enrollments" | "lesson_completions" }[] = [
    { table: "lesson_completions" },
    { table: "enrollments" },
    { table: "reviews" },
    { table: "lessons" },
  ];
  for (const { table } of cascades) {
    const { error } = await supabase.from(table).delete().in("course_id", verifiedIds);
    if (error) throw new Error(`fixture teardown ${table} failed: ${error.message}`);
  }
  const { error: delErr } = await supabase.from("courses").delete().in("id", verifiedIds);
  if (delErr) throw new Error(`fixture teardown courses failed: ${delErr.message}`);
  return { deletedCourses: verifiedIds.length };
}

/** Back-compat helper — refuses to run without exact IDs. */
export async function destroyFixtures(): Promise<{ deletedCourses: number }> {
  throw new Error(
    "[fixtures] destroyFixtures() is removed. Use destroyFixturesByIds({ namespace, courseIds }) with exact fixture state.",
  );
}

export { isValidFixtureNamespace };
