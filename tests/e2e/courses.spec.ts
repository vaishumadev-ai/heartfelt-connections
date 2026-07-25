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
  navigations: string[];
};

type Allow = {
  allowResponses?: { status: number; urlPattern: RegExp; min: number; max: number }[];
  consoleTextPatterns?: RegExp[];
};

function attach(page: Page): Failures {
  const f: Failures = {
    pageErrors: [],
    consoleErrors: [],
    failedRequests: [],
    badResponses: [],
    redirects: new Map(),
    navigations: [],
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
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) f.navigations.push(frame.url());
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
  // Narrow allowlist: only exact (status, urlPattern) tuples up to `max`
  // occurrences are permitted; everything else is a failure.
  const rules = allow.allowResponses ?? [];
  const usage = rules.map(() => 0);
  const unexpectedBad = f.badResponses.filter((r) => {
    for (let i = 0; i < rules.length; i++) {
      if (r.status === rules[i].status && rules[i].urlPattern.test(r.url)) {
        usage[i] += 1;
        return false;
      }
    }
    return true;
  });
  expect(unexpectedBad, "http >=400").toEqual([]);
  rules.forEach((rule, i) => {
    expect(
      usage[i],
      `allowed response ${rule.status} ${rule.urlPattern} under expected minimum`,
    ).toBeGreaterThanOrEqual(rule.min);
    expect(
      usage[i],
      `allowed response ${rule.status} ${rule.urlPattern} over budget`,
    ).toBeLessThanOrEqual(rule.max);
  });
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
  for (const start of ["/courses", "/courses/"]) {
    test(`${start} redirects to /browse without cycles`, async ({ page }) => {
      const f = attach(page);
      await page.goto(start, { waitUntil: "networkidle" });
      await expect(page).toHaveURL(/\/browse$/);
      // Final route renders the browse heading (public content assertion).
      await expect(page.getByRole("heading", { name: /Browse/i }).first()).toBeVisible();

      // Path-only navigation trace — assert /browse reached and no URL
      // revisited more than once across the whole trace.
      const paths = f.navigations.map((u) => {
        try {
          return new URL(u).pathname.replace(/\/$/, "") || "/";
        } catch {
          return u;
        }
      });
      expect(paths, "reached /browse").toContain("/browse");
      const counts = new Map<string, number>();
      for (const p of paths) counts.set(p, (counts.get(p) ?? 0) + 1);
      for (const [p, n] of counts) {
        expect(n, `navigation cycle for ${p}`).toBeLessThanOrEqual(1);
      }
      assertNoFailures(f);
    });
  }

  test("unknown slug renders the not-found experience", async ({ page }) => {
    const f = attach(page);
    const unknown = "definitely-not-a-real-course-xyz-1a-tests";
    await page.goto(`/courses/${unknown}`, { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: /Course not found/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Browse courses/i })).toBeVisible();
    // Documented intentional 404: exactly one getCourseBySlug server-fn call
    // for this specific unknown slug returning status 404. The URL pattern
    // pins the server-fn name AND either the raw or URL-encoded slug so an
    // unrelated 404 elsewhere cannot satisfy the allowance. Any 401/403/429/
    // 5xx or unrelated server-fn 4xx fails.
    const slugPart = new RegExp(`(${unknown}|${encodeURIComponent(unknown)})`);
    assertNoFailures(f, {
      allowResponses: [
        {
          status: 404,
          urlPattern: new RegExp(
            `getCourseBySlug.*${slugPart.source}|${slugPart.source}.*getCourseBySlug`,
          ),
          min: 1,
          max: 1,
        },
      ],
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

      // Open curriculum + FAQ so their expanded height is included in the
      // overflow / bottom-usability checks.
      const firstModule = page.getByRole("button", { name: /Module 1/i }).first();
      if (await firstModule.isVisible().catch(() => false)) await firstModule.click();
      const faq = page.getByRole("button", { name: /Do I need prior experience\?/i }).first();
      if (await faq.isVisible().catch(() => false)) await faq.click();

      // Verify the TRUE bottom of the document (past curriculum: reviews,
      // FAQ, related courses) is reachable and none of it is obscured by
      // the sticky bar.
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      const related = page.getByRole("link", { name: /Paid Course Fixture/i }).first();
      await related.scrollIntoViewIfNeeded();
      const barBox = await mobileBar.boundingBox();
      const relatedBox = await related.boundingBox();
      expect(barBox && relatedBox, "layout boxes").toBeTruthy();
      if (barBox && relatedBox) {
        expect(
          relatedBox.y + relatedBox.height,
          "related-course link fully above sticky bar",
        ).toBeLessThanOrEqual(barBox.y);
      }
      await related.focus();
      const focused = await page.evaluate(() => document.activeElement?.textContent ?? "");
      expect(focused).toMatch(/Paid Course Fixture/i);
    }

    const related = page.getByRole("link", { name: /Paid Course Fixture/i });
    await expect(related.first()).toBeVisible();

    // Horizontal overflow check runs AFTER curriculum + FAQ are toggled
    // open (see above on mobile) so any oversized expanded content shows up.
    if (!isDesktop) {
      const firstModule = page.getByRole("button", { name: /Module 1/i }).first();
      if (await firstModule.isVisible().catch(() => false)) await firstModule.click();
    }
    const overflow = await page.evaluate(() => ({
      dw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
    }));
    expect(overflow.dw, "no horizontal overflow").toBeLessThanOrEqual(overflow.cw + 1);

    const firstModuleTrigger = page.getByRole("button", { name: /Module 1/i }).first();
    await firstModuleTrigger.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");

    const faqTrigger = page.getByRole("button", { name: /Do I need prior experience\?/i }).first();
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
