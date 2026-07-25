# Mozok tests

Two suites:

- **Vitest (unit/component)** — `bun run test` — runs against jsdom, mocks
  the Supabase client and server functions. No network. Includes production
  guard unit tests (`tests/unit/production-guard.test.ts`).
- **Playwright (E2E)** — `bun run test:e2e` — builds the app via the test
  preview launcher and runs three viewport projects (360×800, 390×844,
  1366×768) against a dedicated test Supabase project.

## Required environment for E2E

All three must be set. The suite refuses to load without them.

| Variable                         | Purpose                                                   |
| -------------------------------- | --------------------------------------------------------- |
| `TEST_SUPABASE_URL`              | `https://<test-ref>.supabase.co` — dedicated test project |
| `TEST_SUPABASE_PUBLISHABLE_KEY`  | Test project publishable/anon key                         |
| `TEST_SUPABASE_SERVICE_ROLE_KEY` | Test project service-role key (Node fixtures only)        |

Optional:

- `PW_HOST` (default `127.0.0.1`), `PW_PORT` (default `4173`)
- `PW_FIXTURE_NAMESPACE` — pin a namespace prefix; otherwise auto-generated

The service-role key must belong to the test project and never appear in
`VITE_*` variables. The test-preview launcher strips it from the child
process env before spawning `bun run build` and `bun run preview` directly
(no bash, no shell chaining, no `.env.local` writes).

## Preparing the dedicated test Supabase project

The E2E suite refuses to run against a blank project. Before your first run:

1. Create a dedicated Supabase test project (never share it with production).
2. Apply **every** migration under `supabase/migrations/` in filename order.
3. Copy the test project's URL, publishable key, and service-role key.
4. Store them as sandbox secrets:
   - `TEST_SUPABASE_URL`
   - `TEST_SUPABASE_PUBLISHABLE_KEY`
   - `TEST_SUPABASE_SERVICE_ROLE_KEY`
5. Run `bun run test:e2e`.

`tests/e2e/fixtures.ts` runs a schema preflight before any insert. If any
required table or column is missing you'll get an actionable failure — the
E2E setup will NOT modify schema on your behalf.

## Production guard

Every entry point runs the same guard from `src/lib/testing/production-guard.ts`:

- `playwright.config.ts` — rejects at config load
- `scripts/test-preview.ts` — rejects before build and preview
- `tests/e2e/global-setup.ts` — rejects before any fixture insert
- `tests/e2e/fixtures.ts` — rejects on every service-role client creation

The guard inspects the production ref `snfqvaoclktprpouubie` in
`TEST_SUPABASE_URL`, `SUPABASE_URL`, `VITE_SUPABASE_URL`, project ID / ref,
and any fixture-client URL, AND requires every non-empty URL/ref to match
the ref extracted from `TEST_SUPABASE_URL`. A preview server or fixture
client pointing at a different non-production project is rejected as a
mismatch. The launcher also prints only the resolved test project ref
(never keys) before build.

## Fixtures

`tests/e2e/global-setup.ts` seeds one free and one paid published course
under a validated namespace (`^pw-[a-z0-9-]+$`), plus modules and lessons
(preview + protected), outcomes, skills, FAQ, instructor, and related-course
data. Setup is failure-atomic: if any insert fails, previously-created
course IDs are cleaned up before the error is rethrown, and the state file
is written atomically (tmp + rename) only after all inserts succeed.

`global-teardown.ts` reads exact `freeCourseId` / `paidCourseId` from
`.e2e-fixture-state.json` (git-ignored) and deletes ONLY those IDs after
verifying each row's `category = 'fixtures'` and slug prefix against the
validated namespace. No LIKE-based deletes are ever issued. The state file
is removed only after verified cleanup succeeds.

## Commands

```bash
bun run test           # unit / component
bun run test:watch     # watch mode
bun run test:e2e       # Playwright E2E (requires TEST_SUPABASE_*)
```

Reports and traces are written to `playwright-report/` and `test-results/`
(both git-ignored).
