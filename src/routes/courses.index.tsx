import { createFileRoute, redirect } from "@tanstack/react-router";

// Consolidation stub: legacy `/courses` / `/courses/` URLs redirect to /browse.
// The canonical course-detail route is `/courses/$slug`.
export const Route = createFileRoute("/courses/")({
  beforeLoad: () => {
    throw redirect({ to: "/browse" });
  },
});