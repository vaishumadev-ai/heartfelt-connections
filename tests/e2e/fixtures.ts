import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assertTestProject } from "@/lib/testing/production-guard";

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
    { testSupabaseUrl: url, fixtureClientUrl: url, supabaseUrl: process.env.SUPABASE_URL },
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
  const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 6);
  return `pw-${stamp}-${rand}`;
}

/** Insert a deterministic set of fixtures and return the identifying slugs. */
export async function createFixtures(): Promise<FixtureSlugs> {
  const namespace = process.env.PW_FIXTURE_NAMESPACE || nsPrefix();
  process.env.PW_FIXTURE_NAMESPACE = namespace;

  const supabase = adminClient();

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

  const { data: free, error: freeErr } = await supabase
    .from("courses")
    .insert({
      ...baseCourse,
      slug: freeSlug,
      title: `[${namespace}] Free Course Fixture`,
      subtitle: "A deterministic free course used by the Playwright E2E suite.",
      description: "This course is created by the E2E fixture bootstrap and cleaned up in teardown.",
      category: "fixtures",
      price_cents: 0,
    })
    .select("id")
    .single();
  if (freeErr || !free) throw new Error(`fixture free course insert failed: ${freeErr?.message}`);

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
  if (paidErr || !paid) throw new Error(`fixture paid course insert failed: ${paidErr?.message}`);

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
  if (lessonsErr) throw new Error(`fixture lessons insert failed: ${lessonsErr.message}`);

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
  if (paidLessonsErr) throw new Error(`fixture paid lessons insert failed: ${paidLessonsErr.message}`);

  return {
    namespace,
    freeSlug,
    paidSlug,
    freeCourseId: free.id,
    paidCourseId: paid.id,
  };
}

/**
 * Delete only rows belonging to the namespace. Uses category='fixtures' AND
 * slug prefix match to double-guard. FK cascade on lessons/reviews/enrollments
 * removes descendants.
 */
export async function destroyFixtures(namespace: string): Promise<{ deletedCourses: number }> {
  if (!namespace) return { deletedCourses: 0 };
  const supabase = adminClient();
  // Safety: refuse to delete anything without a namespace prefix filter.
  const { data, error } = await supabase
    .from("courses")
    .delete()
    .eq("category", "fixtures")
    .like("slug", `${namespace}-%`)
    .select("id");
  if (error) throw new Error(`fixture teardown failed: ${error.message}`);
  return { deletedCourses: data?.length ?? 0 };
}