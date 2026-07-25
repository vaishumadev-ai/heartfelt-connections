import { useEffect, useState } from "react";
import { queryOptions, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  listCourseReviews,
  submitReview,
  deleteMyReview,
  type ReviewItem,
} from "@/lib/courses.functions";

const reviewsQO = (courseId: string) =>
  queryOptions({
    queryKey: ["reviews", courseId],
    queryFn: () => listCourseReviews({ data: { courseId } }),
  });

export function CourseReviews({ courseId }: { courseId: string }) {
  const { data: reviews = [] } = useQuery(reviewsQO(courseId));
  const qc = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  const submitFn = useServerFn(submitReview);
  const deleteFn = useServerFn(deleteMyReview);

  const mine = userId ? reviews.find((r) => r.user_id === userId) ?? null : null;
  const others = userId ? reviews.filter((r) => r.user_id !== userId) : reviews;

  const avg =
    reviews.length
      ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10
      : 0;

  const submit = useMutation({
    mutationFn: (v: { rating: number; body: string }) =>
      submitFn({ data: { courseId, rating: v.rating, body: v.body } }),
    onSuccess: () => {
      toast.success("Review posted");
      qc.invalidateQueries({ queryKey: ["reviews", courseId] });
      qc.invalidateQueries({ queryKey: ["course"] });
      qc.invalidateQueries({ queryKey: ["courses"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: () => deleteFn({ data: { courseId } }),
    onSuccess: () => {
      toast.success("Review deleted");
      qc.invalidateQueries({ queryKey: ["reviews", courseId] });
      qc.invalidateQueries({ queryKey: ["course"] });
      qc.invalidateQueries({ queryKey: ["courses"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <section className="mt-10">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Reviews</h2>
        <div className="flex items-center gap-2 text-sm">
          <StarRow value={Math.round(avg)} readOnly />
          <span className="font-semibold">{avg.toFixed(1)}</span>
          <span className="text-gray-500">({reviews.length})</span>
        </div>
      </div>

      {userId ? (
        <ReviewForm
          existing={mine}
          onSubmit={(v) => submit.mutate(v)}
          onDelete={() => {
            if (confirm("Delete your review?")) remove.mutate();
          }}
          pending={submit.isPending || remove.isPending}
        />
      ) : (
        <div className="mt-4 rounded-2xl bg-[#f9f9f9] p-4 text-sm text-gray-600">
          Sign in to leave a review.
        </div>
      )}

      <ul className="mt-6 space-y-3">
        {others.length === 0 && !mine && (
          <li className="rounded-2xl bg-[#f9f9f9] p-4 text-sm text-gray-500">
            No reviews yet. Be the first!
          </li>
        )}
        {others.map((r) => (
          <ReviewCard key={r.id} r={r} />
        ))}
      </ul>
    </section>
  );
}

function ReviewForm({
  existing,
  onSubmit,
  onDelete,
  pending,
}: {
  existing: ReviewItem | null;
  onSubmit: (v: { rating: number; body: string }) => void;
  onDelete: () => void;
  pending: boolean;
}) {
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [hover, setHover] = useState(0);
  const [body, setBody] = useState(existing?.body ?? "");
  const MAX = 2000;

  useEffect(() => {
    setRating(existing?.rating ?? 0);
    setBody(existing?.body ?? "");
  }, [existing?.id, existing?.rating, existing?.body]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (rating < 1) return toast.error("Pick a star rating");
        onSubmit({ rating, body: body.trim().slice(0, MAX) });
      }}
      className="mt-4 rounded-2xl bg-[#f9f9f9] p-5"
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">{existing ? "Update your review" : "Write a review"}</div>
          <div className="mt-2 flex items-center gap-1" onMouseLeave={() => setHover(0)}>
            {[1, 2, 3, 4, 5].map((n) => {
              const active = (hover || rating) >= n;
              return (
                <button
                  type="button"
                  key={n}
                  onMouseEnter={() => setHover(n)}
                  onClick={() => setRating(n)}
                  className="p-0.5"
                  aria-label={`Rate ${n} star${n > 1 ? "s" : ""}`}
                >
                  <Star
                    className={`h-6 w-6 transition ${
                      active ? "fill-[#ffb547] text-[#ffb547]" : "text-gray-300"
                    }`}
                  />
                </button>
              );
            })}
            <span className="ml-2 text-xs text-gray-500">
              {rating ? `${rating} / 5` : "Tap a star"}
            </span>
          </div>
        </div>
        {existing && (
          <button
            type="button"
            onClick={onDelete}
            className="flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 ring-1 ring-gray-300 hover:text-red-500"
          >
            <Trash2 className="h-3 w-3" /> Delete
          </button>
        )}
      </div>

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value.slice(0, MAX))}
        rows={3}
        placeholder="Share what you liked or what could improve..."
        className="mt-3 w-full resize-none rounded-2xl bg-white p-4 text-sm outline-none ring-1 ring-transparent focus:ring-[#ff5a6a]"
      />
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-gray-400">{body.length}/{MAX}</span>
        <button
          type="submit"
          disabled={pending || rating < 1}
          className="rounded-full bg-[#ff5a6a] px-5 py-2.5 text-sm font-semibold text-white/30 disabled:opacity-60"
        >
          {pending ? "Saving…" : existing ? "Update review" : "Post review"}
        </button>
      </div>
    </form>
  );
}

function ReviewCard({ r }: { r: ReviewItem }) {
  const name = r.author?.display_name || "Learner";
  const initial = name.charAt(0).toUpperCase();
  return (
    <li className="rounded-2xl bg-white p-5 ring-1 ring-gray-300">
      <div className="flex items-center gap-3">
        {r.author?.avatar_url ? (
          <img src={r.author.avatar_url} alt="" className="h-9 w-9 rounded-full object-cover" />
        ) : (
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#ff5a6a]/10 text-sm font-bold text-[#ff5a6a]">
            {initial}
          </div>
        )}
        <div className="flex-1">
          <div className="text-sm font-semibold">{name}</div>
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <StarRow value={r.rating} readOnly small />
            <span>{new Date(r.created_at).toLocaleDateString()}</span>
          </div>
        </div>
      </div>
      {r.body && <p className="mt-3 whitespace-pre-line text-sm text-gray-700">{r.body}</p>}
    </li>
  );
}

function StarRow({ value, readOnly, small }: { value: number; readOnly?: boolean; small?: boolean }) {
  const size = small ? "h-3.5 w-3.5" : "h-4 w-4";
  return (
    <div className="flex items-center">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`${size} ${n <= value ? "fill-[#ffb547] text-[#ffb547]" : "text-gray-300"}`}
          aria-hidden={readOnly}
        />
      ))}
    </div>
  );
}