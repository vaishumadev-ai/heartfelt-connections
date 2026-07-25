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
process env before spawning `bun run build && bun run preview`.

## Production guard

Every entry point runs the same guard from `src/lib/testing/production-guard.ts`:

- `playwright.config.ts` — rejects at config load
- `scripts/test-preview.ts` — rejects before build and preview
- `tests/e2e/global-setup.ts` — rejects before any fixture insert
- `tests/e2e/fixtures.ts` — rejects on every service-role client creation

The guard inspects the production ref `snfqvaoclktprpouubie` in
`TEST_SUPABASE_URL`, `SUPABASE_URL`, `VITE_SUPABASE_URL`, project ID / ref,
and any fixture-client URL. The launcher also prints only the resolved test
project ref (never keys) before build.

## Fixtures

`tests/e2e/global-setup.ts` seeds one free and one paid published course
under a unique namespace, plus modules and lessons (at least one preview and
one protected), outcomes, skills, FAQ, instructor, and related-course data.
The state file `.e2e-fixture-state.json` (git-ignored) carries the slugs to
workers. `global-teardown.ts` deletes only rows tagged with the namespace.

## Commands

```bash
bun run test           # unit / component
bun run test:watch     # watch mode
bun run test:e2e       # Playwright E2E (requires TEST_SUPABASE_*)
```

Reports and traces are written to `playwright-report/` and `test-results/`
(both git-ignored).
