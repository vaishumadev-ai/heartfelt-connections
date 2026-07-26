import { createFileRoute } from "@tanstack/react-router";
import { getMyCourse, mapCourseGovernanceError } from "@/lib/courses.functions";
import { CourseEditorForm } from "@/components/studio/CourseEditorForm";
import { UnsavedGuardProvider } from "@/components/lesson-tools/UnsavedGuard";
import { StudioNavGuard } from "@/components/studio/StudioNavGuard";

export const Route = createFileRoute("/_authenticated/studio/$courseId")({
  head: () => ({
    meta: [{ title: "Edit course — Mozok Studio" }, { name: "robots", content: "noindex" }],
  }),
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData({
      queryKey: ["my-course", params.courseId],
      queryFn: () => getMyCourse({ data: { courseId: params.courseId } }),
    }),
  component: EditCourseRoute,
  errorComponent: ({ error }) => (
    <div className="p-8" role="alert">
      {mapCourseGovernanceError(error)}
    </div>
  ),
  notFoundComponent: () => <div className="p-8">Course not found.</div>,
});

function EditCourseRoute() {
  const { courseId } = Route.useParams();
  return (
    <UnsavedGuardProvider>
      <StudioNavGuard />
      <CourseEditorForm courseId={courseId} />
    </UnsavedGuardProvider>
  );
}
