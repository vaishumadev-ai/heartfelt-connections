/**
 * Pure lesson-player selection & progress helpers.
 *
 * No I/O, no framework dependencies. Consumed by both the server function
 * (getLessonPlayer) and the client route so behavior is provably identical
 * and unit-testable.
 */

export type Entitlement = "none" | "preview" | "full";

export interface LessonLike {
  id: string;
  position: number;
}

/**
 * Canonical lesson ordering: position ASC, then id ASC as a stable tiebreaker
 * so two lessons at the same position never swap on refetch.
 */
export function orderLessons<T extends LessonLike>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

export type SelectionReason =
  | "explicit"
  | "resume-last"
  | "resume-next-after-last"
  | "first-incomplete"
  | "first"
  | "all-complete";

export type SelectionResult<T extends LessonLike> =
  | { kind: "selected"; lesson: T; reason: SelectionReason }
  | { kind: "requested-invalid" }
  | { kind: "empty" };

export interface SelectionInput<T extends LessonLike> {
  lessons: readonly T[]; // must already be canonically ordered
  requestedLessonId?: string | null;
  lastLessonId?: string | null;
  completedIds?: readonly string[];
}

/**
 * Choose which lesson opens for a learner. Precedence:
 *   1. Explicit valid `requestedLessonId` (wins even when already complete).
 *   2. Explicit but unknown → requested-invalid (never silently swap).
 *   3. `lastLessonId` if it is present and not complete → resume-last.
 *   4. `lastLessonId` complete → first incomplete after it.
 *   5. Otherwise → first incomplete (wrapping from the start).
 *   6. If every lesson is complete → the stored last lesson when still valid,
 *      otherwise the final canonical lesson. Never resume a completed course
 *      at lesson one merely because every id is complete.
 */
export function selectCurrentLesson<T extends LessonLike>(
  input: SelectionInput<T>,
): SelectionResult<T> {
  const { lessons, requestedLessonId, lastLessonId, completedIds } = input;
  if (lessons.length === 0) return { kind: "empty" };

  if (requestedLessonId) {
    const found = lessons.find((l) => l.id === requestedLessonId);
    if (!found) return { kind: "requested-invalid" };
    return { kind: "selected", lesson: found, reason: "explicit" };
  }

  const done = new Set(completedIds ?? []);
  const lastIdx = lastLessonId ? lessons.findIndex((l) => l.id === lastLessonId) : -1;
  const last = lastIdx >= 0 ? lessons[lastIdx] : null;

  if (last) {
    if (!done.has(last.id)) {
      return { kind: "selected", lesson: last, reason: "resume-last" };
    }
    const nextIncomplete = lessons.slice(lastIdx + 1).find((l) => !done.has(l.id));
    if (nextIncomplete) {
      return { kind: "selected", lesson: nextIncomplete, reason: "resume-next-after-last" };
    }
    const wrap = lessons.find((l) => !done.has(l.id));
    if (wrap) return { kind: "selected", lesson: wrap, reason: "first-incomplete" };
    // Course fully complete: honor the stored last lesson.
    return { kind: "selected", lesson: last, reason: "all-complete" };
  }

  const firstIncomplete = lessons.find((l) => !done.has(l.id));
  if (firstIncomplete) {
    return { kind: "selected", lesson: firstIncomplete, reason: "first-incomplete" };
  }
  // Course fully complete with no valid stored last lesson: land on the
  // final canonical lesson, never lesson one.
  return { kind: "selected", lesson: lessons[lessons.length - 1], reason: "all-complete" };
}

/**
 * Prev/next lesson ids by canonical position. Returns null on first/last so
 * the UI never wraps around.
 */
export function neighborIds<T extends LessonLike>(
  lessons: readonly T[],
  currentId: string,
): { prevId: string | null; nextId: string | null } {
  const idx = lessons.findIndex((l) => l.id === currentId);
  if (idx < 0) return { prevId: null, nextId: null };
  return {
    prevId: idx > 0 ? lessons[idx - 1].id : null,
    nextId: idx < lessons.length - 1 ? lessons[idx + 1].id : null,
  };
}

/**
 * Defensive clamp for a database-supplied progress value in [0..100].
 * The single production authority is `enrollments.progress`, maintained by
 * the `complete_lesson` RPC. This helper NEVER computes from completion
 * counts; it only rounds and clamps whatever the database returned.
 */
export function clampProgress(value: number | null | undefined): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function canTrackProgress(input: {
  entitlement: Entitlement;
  isEnrolled: boolean;
  priceCents: number;
  isPublished: boolean;
}): boolean {
  return (
    input.entitlement === "full" && input.isEnrolled && input.priceCents === 0 && input.isPublished
  );
}
