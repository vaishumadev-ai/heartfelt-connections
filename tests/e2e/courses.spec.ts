import { test, expect, type Page } from "@playwright/test";

/**
 * Production-preview E2E for the course route.
 *
 * These specs run against `bun run preview` (see playwright.config.ts webServer)
 * across three viewports (360x800, 390x844, 1366x768).
 *
 * Fixture policy: this suite MUST run against a dedicated test Supabase
 * project. The global-setup rejects the production project ref before any
 * spec starts, so specs may assume a safe environment.
 *
 * The suite verifies public-guest behavior only; authenticated flows and
 * paid checkout are out of scope for Phase 1A.
 */

const KNOWN_SLUG = process.env.PW_KNOWN_SLUG ?? "";

async function collectPageErrors(page: Page) {
  const errors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  return { errors, consoleErrors };
}

test.describe("Course route – public/guest behavior", () => {
  test("/courses redirects to /browse", async ({ page }) => {
    const { errors } = await collectPageErrors(page);
    const res = await page.goto("/courses", { waitUntil: "domcontentloaded" });
    expect(res, "response").not.toBeNull();
    await expect(page).toHaveURL(/\/browse$/);
    expect(errors).toEqual([]);
  });

  test("/courses/ redirects to /browse", async ({ page }) => {
    const { errors } = await collectPageErrors(page);
    await page.goto("/courses/", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/browse$/);
    expect(errors).toEqual([]);
  });

  test("unknown slug renders the not-found experience", async ({ page }) => {
    const { errors } = await collectPageErrors(page);
    await page.goto("/courses/definitely-not-a-real-course-xyz-1a-tests", {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("heading", { name: /Course not found/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Browse courses/i })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test.describe("valid slug", () => {
    test.skip(!KNOWN_SLUG, "PW_KNOWN_SLUG env not provided; skipping valid-slug smoke");
    test("renders rich page with correct guest CTA and no unexpected errors", async ({
      page,
    }, testInfo) => {
      const { errors, consoleErrors } = await collectPageErrors(page);
      await page.goto(`/courses/${KNOWN_SLUG}`, { waitUntil: "networkidle" });

      // rich page landmarks
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("heading", { name: /Course curriculum/i })).toBeVisible();

      // Guest CTA
      await expect(
        page.getByRole("link", { name: /Sign in to enroll/i }).first(),
      ).toBeVisible();

      const viewportName = testInfo.project.name;
      const isDesktop = viewportName.startsWith("desktop");

      if (isDesktop) {
        // Desktop: purchase rail visible; mobile sticky bar hidden.
        await expect(page.locator("aside").first()).toBeVisible();
        const mobileBar = page.locator("div.fixed.inset-x-0.bottom-0");
        await expect(mobileBar).toBeHidden();
      } else {
        // Mobile: sticky action bar visible; desktop aside hidden.
        const mobileBar = page.locator("div.fixed.inset-x-0.bottom-0");
        await expect(mobileBar).toBeVisible();
        // Mobile bar must not fully cover the H1 (viewport not obscured).
        const barBox = await mobileBar.boundingBox();
        const h1Box = await page.getByRole("heading", { level: 1 }).boundingBox();
        expect(barBox && h1Box && h1Box.y < barBox.y).toBeTruthy();
      }

      // Only one visible actionable primary CTA at this breakpoint.
      const visibleCtas = await page
        .getByRole("link", { name: /Sign in to enroll/i })
        .filter({ has: page.locator(":scope") })
        .all();
      const visible = [] as typeof visibleCtas;
      for (const el of visibleCtas) if (await el.isVisible()) visible.push(el);
      expect(visible.length).toBe(1);

      // no page errors / hydration warnings / redirect loop
      expect(errors, "pageerror").toEqual([]);
      const hydrationWarnings = consoleErrors.filter((t) => /hydrat/i.test(t));
      expect(hydrationWarnings, "hydration warnings").toEqual([]);
      expect(page.url()).toContain(`/courses/${KNOWN_SLUG}`);
    });
  });
});