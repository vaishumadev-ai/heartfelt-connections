# Mozok — Next Level Plan

Three tracks, shipped in order so each builds on the last.

## Track 1 — Live backend + auth

Enable Lovable Cloud and wire the dashboard to real data.

- Enable Cloud (Postgres + Auth + Storage).
- Auth: email/password + Google sign-in. Public `/auth` route with sign-in / sign-up tabs. Managed `_authenticated` gate protects the dashboard.
- Data model (with RLS + grants):
  - `profiles` (id → auth.users, display_name, avatar_url, score, coins, followers)
  - `user_roles` + `has_role()` (admin / instructor / student)
  - `courses` (title, slug, subtitle, cover_url, category, price, rating, instructor_id)
  - `lessons` (course_id, order, title, duration, video_url)
  - `enrollments` (user_id, course_id, progress, last_lesson_id)
  - `reviews` (user_id, course_id, rating, body)
- Auto-create profile on signup via trigger.
- Seed a handful of demo courses in the migration so the UI has content immediately.
- Replace hardcoded cards on `/` with live queries (TanStack Query + `ensureQueryData`).

## Track 2 — Full page set

Every section becomes its own route (own `head()` for SEO/OG).

```text
/                       public landing (marketing hero + featured courses)
/auth                   sign-in / sign-up
/browse                 course catalog with search + category filters
/courses/$slug          course detail (syllabus, instructor, reviews, enroll CTA)
/_authenticated/
  dashboard             the current Mozok dashboard (live data)
  learn/$courseId       lesson player with sidebar + progress
  my-learning           enrolled courses + progress
  profile               edit profile, avatar upload
  settings              account settings
  instructor/           (role-gated) course create/edit + lesson manager
```

- `<Link>` navigation everywhere (no `<a href>`).
- Header reflects session state (avatar menu + sign out; "Sign in" when logged out).
- Search bar on the dashboard becomes real (Postgres `ilike` on title/category).

## Track 3 — Visual polish + motion

Keep the current Mozok aesthetic, sharpen it.

- Design tokens in `src/styles.css`: brand blue, soft pink, mint, sand — as semantic tokens (`--brand`, `--surface`, `--surface-alt`, `--accent-pink`, etc.). No hardcoded hex in components.
- Typography: keep Poppins, add a display weight for hero numbers.
- Dark mode toggle wired to `class="dark"` with matching tokens.
- Motion (Framer Motion):
  - Staggered fade/slide-in for course cards on mount.
  - Hover lift + subtle tilt on cards.
  - Animated progress rings (count-up).
  - Page transitions on route change.
  - Search bar focus expand.
- Skeleton loaders for every async section (cards, sidebar, calendar).
- Responsive pass: dashboard collapses gracefully <1024px, sidebar becomes a sheet.
- Empty states + toasts (`sonner`) for auth, enroll, errors.
- SEO: unique `head()` per route with title / description / og:title / og:description; og:image on leaf routes where a cover exists.

## Suggested build order (one turn each, roughly)

1. Enable Cloud → schema + RLS + seed → auth pages → header session state.
2. Dashboard wired to live queries + skeletons.
3. `/browse` + `/courses/$slug` + enroll flow.
4. `/_authenticated/learn/$courseId` + `my-learning` + `profile`.
5. Design token pass + dark mode + motion + responsive polish.
6. Instructor role-gated area.

## Technical notes

- Loaders use `context.queryClient.ensureQueryData(queryOptions)`; components use `useSuspenseQuery`. Public route loaders never call `requireSupabaseAuth` fns.
- Google sign-in via `lovable.auth.signInWithOAuth('google', ...)` (not raw Supabase OAuth). Configure via `supabase--configure_social_auth` in the same turn.
- All mutations are `createServerFn` + `useServerFn` + `useMutation` with cache invalidation.
- Roles in `user_roles` table (never on profiles); instructor gate uses `has_role()`.

Approve and I'll start with step 1 (Cloud + schema + auth + header).