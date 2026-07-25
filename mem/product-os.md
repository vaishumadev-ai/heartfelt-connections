---
name: Mozok Product & Delivery Operating System
description: Core positioning, pillars, personas, JTBD, north-star + supporting metrics, integrity rules, delivery process, and definition of done. Applies to every feature.
type: feature
---
# Mozok Product & Delivery Operating System

## Positioning
Premium **curated** learning platform — not an open marketplace. Every course is selected, reviewed, outcome-designed, quality-scored, admin-approved before publication. Promise: fewer courses, better selected, applied learning, verified outcomes. Bar: Coursera (trust/outcomes), Brilliant (active learning), Maven (credibility), LinkedIn Learning (career/notes/exercises/paths), Reforge (curated expertise/artifacts). Feel simpler and more personal.

## Pillars
1. Curated confidence — why selected, for whom, what taught, difficulty, what learner will produce.
2. Active learning — practice, assessments, reflection, projects. Video-only ≠ mastery.
3. Visible momentum — where I am, what's next, why it matters, distance to outcome, what I've mastered.
4. Verified outcomes — progress, reviews, certificates, learner counts all server-verified.
5. Editorial quality — explicit rubric + admin review per publish.
6. Trustworthy commerce — payment, entitlements, refunds, access secure/auditable/server-enforced.

## Personas
Primary learner, Returning learner, Career learner, Curator/Admin, Vetted Instructor.

## JTBD
Choose confidently; build ability not consume; resume without memory; get credible evidence; trustworthy payment/access/refund/ownership.

## North-Star
**Weekly Mastery Learners** = unique learners completing ≥1 server-verified mastery activity in 7 days. Mastery = passing quiz, evaluated exercise, submitted project, module checkpoint, or explicitly configured mastery activity. Video seconds ≠ mastery.

## Supporting Metrics
Acquisition: detail visitors, signup conv, checkout-start, purchase conv.
Activation: %purchasers starting <24h, %first meaningful activity, median purchase→first action.
Learning: lesson/module completion, assessment pass, retry, project submission, course completion, time-to-mastery.
Retention: 7d/30d, resume, WML, path continuation.
Trust: refund, support contacts, verified review score, content problem reports, cert verifications.
Content quality: activation, lesson drop-off, assessment quality, completion, outcome attainment, complaints.

## Design Rule (non-negotiable)
Preserve current Mozok identity (Paper & Ink palette, Poppins, doodles, cards, spacing, nav language). Do NOT redesign colors/typography/illustrations/composition/cards/nav/spacing/brand. Extend existing patterns. A11y fixes only if visually consistent.

## Product Integrity Rules (never violate)
- No fake learners/followers/scores/reviews/counts/social proof.
- No certificate unless actually issued.
- No "verified" label without server-verifiable evidence.
- No paid access based only on frontend state.
- No enrollment from button click alone — server-enforced entitlement.
- No progress from opening a page.
- No unsupported refund/guarantee claims.
- No instructor self-approval.
- No published course without quality approval.
- No security decision made only in the browser.

## Delivery Process (every epic)
**Before implementation:** inspect repo+schema; explain current behavior; users+JTBD; assumptions; functional requirements; non-goals; data+access-control model; error/loading/empty/recovery states; analytics events; acceptance criteria; test plan (unit/integration/e2e/usability); migration/rollout/rollback risks. **Stop and request plan approval.**
**During:** small independently testable changes; forward-only migrations; server-side input validation; authorization via server logic + Supabase RLS; no placeholder production data; preserve existing behavior unless plan replaces it; observability on critical ops.
**After:** build, lint (0), typecheck, unit, integration, e2e, Lovable security scan; report evidence. Do NOT claim completion while any check fails.

## Definition of Done
Not done because happy-path renders. Done requires: business rules implemented; authorization server-enforced; RLS tested; loading/empty/error/recovery states; keyboard + screen-reader usable; mobile+desktop verified; analytics events verified; automated tests pass; usability acceptance passes; docs updated; rollout+rollback procedures exist.
