import { promises as fs } from "node:fs";
import path from "node:path";
import { test, expect, type Page, type Request, type Response } from "@playwright/test";

/**
 * Production-preview E2E for the course route.
 *
 * Runs against the test-preview launcher (see playwright.config.ts webServer)
 * across three viewports (360x800, 390x844, 1366x768). Fixtures are seeded by
 * tests/e2e/global-setup.ts against the dedicated test Supabase project; the
 * production ref is rejected before build, preview, fixture setup, and here.
 *
 * All specs collect and assert on browser failure signals: pageerror,
 * console.error, hydration warnings, failed requests, HTTP responses >= 400,
 * and redirect loops. A narrow allowlist covers only the intentional
 * unknown-slug 404.
 */

type Failures = {
  pageErrors: string[];
  consoleErrors: string[];
  failedRequests: { url: string; failure: string | null }[];
  badResponses: { url: string; status: number }[];
  redirects: Map<string, number>;
};

type Allow = {
  status4xxUrlPatterns?: RegExp[];
  consoleTextPatterns?: RegExp[];
};

function attach(page: Page): Failures {
  const f: Failures = {
    pageErrors: [],
    consoleErrors: [],
    failedRequests: [],
    badResponses: [],
    redirects: new Map(),
  };
  page.on("pageerror", (err) => f.pageErrors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") f.consoleErrors.push(msg.text());
    if (msg.type() === "warning" && /hydrat/i.test(msg.text())) {
      f.consoleErrors.push(`[warning] ${msg.text()}`);
    }
  });
  page.on("requestfailed", (req: Request) =>
    f.failedRequests.push({ url: req.url(), failure: req.failure()?.errorText ?? null }),
  );
  page.on("response", (res: Response) => {
    if (res.status() >= 400) f.badResponses.push({ url: res.url(), status: res.status() });
    if (res.status() >= 300 && res.status() < 400) {
      const n = f.redirects.get(res.url()) ?? 0;
      f.redirects.set(res.url(), n + 1);
    }
  });
  return f;
}

function assertNoFailures(f: Failures, allow: Allow = {}) {
  expect(f.pageErrors, "pageerror").toEqual([]);
  const hydration = f.consoleErrors.filter((t) => /hydrat/i.test(t));
  expect(hydration, "hydration warnings").toEqual([]);
  const unexpectedConsole = f.consoleErrors.filter(
    (t) => !(allow.consoleTextPatterns ?? []).some((re) => re.test(t)),
  );
  expect(unexpectedConsole, "console.error").toEqual([]);
  const unexpectedBad = f.badResponses.filter(
    (r) => !(allow.status4xxUrlPatterns ?? []).some((re) => re.test(r.url)),
  );
  expect(unexpectedBad, "http >=400").toEqual([]);
  expect(f.failedRequests, "failed requests").toEqual([]);
  for (const [url, n] of f.redirects) {
    expect(n, `redirect loop on ${url}`).toBeLessThanOrEqual(2);
  }
}

async function readSlugs(): Promise<{ freeSlug: string; paidSlug: string }> {
  const p = path.resolve(process.cwd(), ".e2e-fixture-state.json");
  const raw = await fs.readFile(p, "utf8");
  const parsed = JSON.parse(raw) as { freeSlug?: string; paidSlug?: string };
  if (!parsed.freeSlug || !parsed.paidSlug) {
    throw new Error("Fixture state file is missing slugs. globalSetup did not seed correctly.");
  }
  return { freeSlug: parsed.freeSlug, paidSlug: parsed.paidSlug };
}

const MOBILE_BAR = "div.fixed.inset-x-0.bottom-0";

test.describe("Course route – redirects & not-found", () => {
  test("/courses redirects once to /browse", async ({ page }) => {
    const f = attach(page);
    const res = await page.goto("/courses", { waitUntil: "domcontentloaded" });
    expect(res).not.toBeNull();
    await expect(page).toHaveURL(/\/browse$/);
    assertNoFailures(f);
  });

  test("/courses/ redirects once to /browse", async ({ page }) => {
    const f = attach(page);
    await page.goto("/courses/", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/browse$/);
    assertNoFailures(f);
  });

  test("unknown slug renders the not-found experience", async ({ page }) => {
    const f = attach(page);
    await page.goto("/courses/definitely-not-a-real-course-xyz-1a-tests", {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("heading", { name: /Course not found/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Browse courses/i })).toBeVisible();
    // Documented intentional 404 for the not-found data fetch only.
    assertNoFailures(f, {
      status4xxUrlPatterns: [/\/_serverFn\//, /getCourseBySlug/],
    });
  });
});

test.describe("Course route – valid fixture course", () => {
  test("free fixture: heading, curriculum, guest CTA, one primary CTA, no overflow, no errors", async ({
    page,
  }, testInfo) => {
    const { freeSlug } = await readSlugs();
    const f = attach(page);
    await page.goto(`/courses/${freeSlug}`, { waitUntil: "networkidle" });

    const isDesktop = testInfo.project.name.startsWith("desktop");

    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toBeVisible();
    await expect(h1).toContainText(/Free Course Fixture/i);

    await expect(page.getByRole("heading", { name: /Course curriculum/i })).toBeVisible();
    await expect(page.getByText(/Welcome & tour/i).first()).toBeVisible();

    const guestCta = page.getByRole("link", { name: /Sign in to enroll/i });
    await expect(guestCta.first()).toBeVisible();

    const ctas = await guestCta.all();
    let visibleCount = 0;
    for (const el of ctas) if (await el.isVisible()) visibleCount++;
    expect(visibleCount).toBe(1);

    const mobileBar = page.locator(MOBILE_BAR);
    if (isDesktop) {
      await expect(page.locator("aside").first()).toBeVisible();
      await expect(mobileBar).toBeHidden();
    } else {
      await expect(mobileBar).toBeVisible();
      const lastLesson = page.getByText(/Testing basics/i).first();
      await lastLesson.scrollIntoViewIfNeeded();
      const barBox = await mobileBar.boundingBox();
      const targetBox = await lastLesson.boundingBox();
      expect(barBox && targetBox, "layout boxes").toBeTruthy();
      if (barBox && targetBox) {
        expect(
          targetBox.y + targetBox.height,
          "final content bottom vs mobile bar top",
        ).toBeLessThan(barBox.y);
      }
    }

    const related = page.getByRole("link", { name: /Paid Course Fixture/i });
    await expect(related.first()).toBeVisible();

    const overflow = await page.evaluate(() => ({
      dw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
    }));
    expect(overflow.dw, "no horizontal overflow").toBeLessThanOrEqual(overflow.cw + 1);

    const firstModuleTrigger = page.getByRole("button", { name: /Module 1/i }).first();
    await firstModuleTrigger.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");

    const faqTrigger = page
      .getByRole("button", { name: /Do I need prior experience\?/i })
      .first();
    if (await faqTrigger.isVisible().catch(() => false)) {
      await faqTrigger.focus();
      await page.keyboard.press("Enter");
      await page.keyboard.press("Enter");
    }

    expect(page.url()).toContain(`/courses/${freeSlug}`);
    assertNoFailures(f);
  });

  test("paid fixture: price rendered; guest CTA copy is 'Sign in to enroll'; no errors", async ({
    page,
  }) => {
    const { paidSlug } = await readSlugs();
    const f = attach(page);
    await page.goto(`/courses/${paidSlug}`, { waitUntil: "networkidle" });

    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Paid Course Fixture/i);
    await expect(page.getByText(/\$49/).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Sign in to enroll/i }).first()).toBeVisible();

    assertNoFailures(f);
  });
});
