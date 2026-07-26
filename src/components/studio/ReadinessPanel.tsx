import {
  groupReadinessBlockers,
  type CourseReadinessBlocker,
} from "@/lib/course-readiness";
import { CheckCircle2, AlertCircle } from "lucide-react";

export type LessonMeta = { id: string; title: string };

export type ReadinessPanelProps = {
  isReady: boolean;
  blockers: CourseReadinessBlocker[];
  lessons: LessonMeta[];
  onFocus: (target: string, lessonId: string | null) => void;
  loading?: boolean;
};

/**
 * Read-only display of the P0C.1 authoritative RPC. Never marks a course
 * ready from client state alone — `isReady` comes from the server.
 */
export function ReadinessPanel({
  isReady,
  blockers,
  lessons,
  onFocus,
  loading,
}: ReadinessPanelProps) {
  const groups = groupReadinessBlockers(blockers);
  const lessonById = new Map(lessons.map((l) => [l.id, l.title]));

  return (
    <section
      id="section-readiness"
      aria-labelledby="readiness-title"
      className="rounded-3xl bg-card p-6 md:p-8"
    >
      <div className="flex items-start gap-3">
        {isReady ? (
          <CheckCircle2 className="mt-0.5 h-6 w-6" aria-hidden />
        ) : (
          <AlertCircle className="mt-0.5 h-6 w-6" aria-hidden />
        )}
        <div>
          <h2 id="readiness-title" className="text-xl font-bold">
            {isReady ? "Ready to submit" : "Not ready yet"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {isReady
              ? "All required sections are complete. You can submit for review."
              : loading
                ? "Checking course readiness…"
                : `${blockers.length} item${blockers.length === 1 ? "" : "s"} to resolve before submission.`}
          </p>
        </div>
      </div>

      {!isReady && groups.length > 0 && (
        <div className="mt-6 space-y-5">
          {groups.map((g) => (
            <div key={g.group}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {g.label}
              </h3>
              <ul className="mt-2 space-y-2">
                {g.blockers.map((b, i) => {
                  const lessonTitle = b.lesson_id ? lessonById.get(b.lesson_id) : null;
                  return (
                    <li key={`${b.code}-${b.lesson_id ?? "c"}-${i}`}>
                      <button
                        type="button"
                        onClick={() => onFocus(b.target, b.lesson_id)}
                        className="flex w-full items-start gap-2 rounded-2xl bg-background p-3 text-left text-sm ring-1 ring-transparent transition hover:ring-foreground focus:outline-none focus:ring-foreground"
                      >
                        <span aria-hidden className="mt-0.5">
                          •
                        </span>
                        <span className="flex-1">
                          {b.message}
                          {lessonTitle && (
                            <span className="ml-1 text-muted-foreground">
                              — “{lessonTitle}”
                            </span>
                          )}
                          {b.target === "section-cover" && (
                            <span className="ml-1 text-muted-foreground">
                              (Cover upload arrives in the next Studio release.)
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}