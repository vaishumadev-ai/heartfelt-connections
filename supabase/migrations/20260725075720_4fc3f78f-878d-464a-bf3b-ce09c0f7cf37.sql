-- Phase 1B correction: paid-enrollment lockdown, completion write hardening, integrity constraint

-- 1) Lesson access: free courses only for enrolled learners
DROP POLICY IF EXISTS "Enrolled learners read lessons" ON public.lessons;
CREATE POLICY "Enrolled free-course learners read lessons"
ON public.lessons FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.enrollments e
    JOIN public.courses c ON c.id = e.course_id
    WHERE e.course_id = lessons.course_id
      AND e.user_id = auth.uid()
      AND c.is_published = true
      AND c.price_cents = 0
  )
);

-- 2) Completions: read-only for owners; writes only via complete_lesson
DROP POLICY IF EXISTS "Users manage own completions" ON public.lesson_completions;
CREATE POLICY "Users read own completions"
ON public.lesson_completions FOR SELECT TO authenticated
USING (auth.uid() = user_id);

REVOKE INSERT, UPDATE, DELETE ON public.lesson_completions FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.lesson_completions FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.lesson_completions FROM PUBLIC;
GRANT SELECT ON public.lesson_completions TO authenticated;
GRANT ALL ON public.lesson_completions TO service_role;

-- 3) Cleanup invalid cross-course completions (pre-count = 0) and add composite FK
DELETE FROM public.lesson_completions lc
WHERE NOT EXISTS (
  SELECT 1 FROM public.lessons l
  WHERE l.id = lc.lesson_id AND l.course_id = lc.course_id
);

ALTER TABLE public.lessons
  ADD CONSTRAINT lessons_id_course_id_key UNIQUE (id, course_id);

ALTER TABLE public.lesson_completions
  DROP CONSTRAINT IF EXISTS lesson_completions_lesson_id_fkey;

ALTER TABLE public.lesson_completions
  ADD CONSTRAINT lesson_completions_lesson_course_fkey
  FOREIGN KEY (lesson_id, course_id)
  REFERENCES public.lessons (id, course_id)
  ON DELETE CASCADE;

-- 4) Function ACLs: authenticated-only execution
REVOKE EXECUTE ON FUNCTION public.complete_lesson(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_lesson(uuid, uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

-- 5) Rewrite complete_lesson: reject paid, join-based counting, cap at 100
CREATE OR REPLACE FUNCTION public.complete_lesson(_course_id uuid, _lesson_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _lesson_ok boolean;
  _course_published boolean;
  _course_price integer;
  _enrolled boolean;
  _total integer;
  _done integer;
  _progress integer;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT c.is_published, c.price_cents INTO _course_published, _course_price
  FROM public.courses c WHERE c.id = _course_id;
  IF _course_published IS NULL OR _course_published = false THEN
    RAISE EXCEPTION 'Course not available' USING ERRCODE = '42501';
  END IF;
  IF _course_price IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'Paid course entitlement required' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.lessons l
    WHERE l.id = _lesson_id AND l.course_id = _course_id
  ) INTO _lesson_ok;
  IF NOT _lesson_ok THEN
    RAISE EXCEPTION 'Lesson does not belong to course' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.enrollments e
    WHERE e.user_id = _uid AND e.course_id = _course_id
  ) INTO _enrolled;
  IF NOT _enrolled THEN
    RAISE EXCEPTION 'Enrollment required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.lesson_completions (user_id, course_id, lesson_id)
  VALUES (_uid, _course_id, _lesson_id)
  ON CONFLICT (user_id, lesson_id) DO NOTHING;

  SELECT COUNT(*) INTO _total FROM public.lessons WHERE course_id = _course_id;
  -- Count only completions whose lesson is actually in this course (defense-in-depth).
  SELECT COUNT(*) INTO _done
  FROM public.lesson_completions lc
  JOIN public.lessons l ON l.id = lc.lesson_id AND l.course_id = lc.course_id
  WHERE lc.course_id = _course_id AND lc.user_id = _uid;

  _progress := CASE WHEN _total > 0 THEN ROUND((_done::numeric / _total) * 100)::int ELSE 0 END;
  IF _progress > 100 THEN _progress := 100; END IF;
  IF _progress < 0 THEN _progress := 0; END IF;

  UPDATE public.enrollments
    SET progress = _progress, last_lesson_id = _lesson_id
    WHERE user_id = _uid AND course_id = _course_id;

  RETURN _progress;
END;
$function$;