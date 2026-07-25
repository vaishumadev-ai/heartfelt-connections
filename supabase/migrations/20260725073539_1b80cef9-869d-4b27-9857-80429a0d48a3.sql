
DROP POLICY IF EXISTS "Lessons of published courses are public" ON public.lessons;

CREATE POLICY "Lessons preview metadata public"
  ON public.lessons
  FOR SELECT
  TO anon, authenticated
  USING (
    is_preview = true
    AND EXISTS (
      SELECT 1 FROM public.courses c
      WHERE c.id = lessons.course_id AND c.is_published = true
    )
  );

CREATE POLICY "Enrolled learners read lessons"
  ON public.lessons
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.enrollments e
      JOIN public.courses c ON c.id = e.course_id
      WHERE e.course_id = lessons.course_id
        AND e.user_id = auth.uid()
        AND c.is_published = true
    )
  );

CREATE POLICY "Admins read all lessons"
  ON public.lessons
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins manage lessons"
  ON public.lessons
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Users manage own enrollments" ON public.enrollments;

CREATE POLICY "Users read own enrollments"
  ON public.enrollments
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users self-enroll in free published courses"
  ON public.enrollments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.courses c
      WHERE c.id = enrollments.course_id
        AND c.is_published = true
        AND c.price_cents = 0
    )
  );

CREATE POLICY "Admins manage enrollments"
  ON public.enrollments
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.get_course_curriculum(_slug text)
RETURNS TABLE (
  lesson_id uuid,
  lesson_title text,
  lesson_position integer,
  duration_seconds integer,
  is_preview boolean,
  module_title text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.id, l.title, l.position, l.duration_seconds, l.is_preview, l.module_title
  FROM public.lessons l
  JOIN public.courses c ON c.id = l.course_id
  WHERE c.slug = _slug
    AND c.is_published = true
  ORDER BY l.position ASC
$$;

REVOKE ALL ON FUNCTION public.get_course_curriculum(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_course_curriculum(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.complete_lesson(_course_id uuid, _lesson_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _lesson_ok boolean;
  _course_published boolean;
  _enrolled boolean;
  _total integer;
  _done integer;
  _progress integer;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT c.is_published INTO _course_published
  FROM public.courses c WHERE c.id = _course_id;
  IF _course_published IS NULL OR _course_published = false THEN
    RAISE EXCEPTION 'Course not available' USING ERRCODE = '42501';
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
  SELECT COUNT(*) INTO _done  FROM public.lesson_completions
    WHERE course_id = _course_id AND user_id = _uid;

  _progress := CASE WHEN _total > 0 THEN ROUND((_done::numeric / _total) * 100)::int ELSE 0 END;

  UPDATE public.enrollments
    SET progress = _progress, last_lesson_id = _lesson_id
    WHERE user_id = _uid AND course_id = _course_id;

  RETURN _progress;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_lesson(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_lesson(uuid, uuid) TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'lesson_completions_user_id_lesson_id_key'
  ) THEN
    ALTER TABLE public.lesson_completions
      ADD CONSTRAINT lesson_completions_user_id_lesson_id_key
      UNIQUE (user_id, lesson_id);
  END IF;
END $$;
