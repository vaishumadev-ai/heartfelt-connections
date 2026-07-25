-- Phase 2B: Published Course Integrity

-- 1) course_is_editable helper
CREATE OR REPLACE FUNCTION public.course_is_editable(_course_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT (is_published = false
            AND review_status::text IN ('draft','rejected'))
    FROM public.courses WHERE id = _course_id
  ), false)
$$;
REVOKE ALL ON FUNCTION public.course_is_editable(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.course_is_editable(uuid) TO authenticated, anon, service_role;

-- 2) Replace admin ALL policies with SELECT-only
DROP POLICY IF EXISTS "Admins manage courses" ON public.courses;
CREATE POLICY "Admins read all courses" ON public.courses
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins manage lessons" ON public.lessons;
-- "Admins read all lessons" already exists

DROP POLICY IF EXISTS "Admins manage enrollments" ON public.enrollments;
CREATE POLICY "Admins read enrollments" ON public.enrollments
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 3) Tighten instructor content policies to editable-only
DROP POLICY IF EXISTS "Active instructors update own courses" ON public.courses;
CREATE POLICY "Active instructors update own courses" ON public.courses
  FOR UPDATE TO authenticated
  USING (
    instructor_id = auth.uid()
    AND public.current_user_has_role('instructor')
    AND is_published = false
    AND review_status::text IN ('draft','rejected')
  )
  WITH CHECK (
    instructor_id = auth.uid()
    AND public.current_user_has_role('instructor')
    AND is_published = false
    AND review_status::text IN ('draft','rejected')
  );

DROP POLICY IF EXISTS "Active instructors delete own courses" ON public.courses;
CREATE POLICY "Active instructors delete own courses" ON public.courses
  FOR DELETE TO authenticated
  USING (
    instructor_id = auth.uid()
    AND public.current_user_has_role('instructor')
    AND is_published = false
    AND review_status::text IN ('draft','rejected')
  );

DROP POLICY IF EXISTS "Active instructors manage own lessons" ON public.lessons;
CREATE POLICY "Active instructors manage own lessons" ON public.lessons
  FOR ALL TO authenticated
  USING (
    public.current_user_has_role('instructor')
    AND EXISTS (
      SELECT 1 FROM public.courses c
      WHERE c.id = lessons.course_id
        AND c.instructor_id = auth.uid()
        AND c.is_published = false
        AND c.review_status::text IN ('draft','rejected')
    )
  )
  WITH CHECK (
    public.current_user_has_role('instructor')
    AND EXISTS (
      SELECT 1 FROM public.courses c
      WHERE c.id = lessons.course_id
        AND c.instructor_id = auth.uid()
        AND c.is_published = false
        AND c.review_status::text IN ('draft','rejected')
    )
  );

-- 4) Anonymous preview: metadata-only column grants on lessons
REVOKE SELECT ON public.lessons FROM anon;
GRANT SELECT (id, course_id, position, title, duration_seconds, is_preview, module_title, created_at)
  ON public.lessons TO anon;

-- 5) Remove direct free-enrollment path; RPC becomes the only writer
REVOKE INSERT ON public.enrollments FROM authenticated;
DROP POLICY IF EXISTS "Users self-enroll in free published courses" ON public.enrollments;

-- 6) Destructive-op safety triggers
CREATE OR REPLACE FUNCTION public.enforce_course_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('postgres','service_role','supabase_admin') THEN
    RETURN OLD;
  END IF;
  IF NOT public.course_is_editable(OLD.id) THEN
    RAISE EXCEPTION 'Course not deletable: not in editable state' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.enrollments WHERE course_id = OLD.id) THEN
    RAISE EXCEPTION 'Course has learner enrollments' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.lesson_completions WHERE course_id = OLD.id) THEN
    RAISE EXCEPTION 'Course has learner completions' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.reviews WHERE course_id = OLD.id) THEN
    RAISE EXCEPTION 'Course has learner reviews' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END; $$;
DROP TRIGGER IF EXISTS enforce_course_delete_trg ON public.courses;
CREATE TRIGGER enforce_course_delete_trg
  BEFORE DELETE ON public.courses
  FOR EACH ROW EXECUTE FUNCTION public.enforce_course_delete();

CREATE OR REPLACE FUNCTION public.enforce_lesson_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('postgres','service_role','supabase_admin') THEN
    RETURN OLD;
  END IF;
  IF NOT public.course_is_editable(OLD.course_id) THEN
    RAISE EXCEPTION 'Parent course not in editable state' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.lesson_completions WHERE lesson_id = OLD.id) THEN
    RAISE EXCEPTION 'Lesson has learner completions' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END; $$;
DROP TRIGGER IF EXISTS enforce_lesson_delete_trg ON public.lessons;
CREATE TRIGGER enforce_lesson_delete_trg
  BEFORE DELETE ON public.lessons
  FOR EACH ROW EXECUTE FUNCTION public.enforce_lesson_delete();

-- 7) enroll_free_course RPC (only free-enrollment writer)
CREATE OR REPLACE FUNCTION public.enroll_free_course(_course_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _is_published boolean;
  _price int;
  _existing uuid;
  _new_id uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('mozok.course:' || _course_id::text));
  SELECT is_published, price_cents INTO _is_published, _price
    FROM public.courses WHERE id = _course_id FOR UPDATE;
  IF _is_published IS NULL THEN
    RAISE EXCEPTION 'Course not found' USING ERRCODE = '42704';
  END IF;
  IF _is_published = false THEN
    RAISE EXCEPTION 'Course not available for enrollment' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(_price, 0) <> 0 THEN
    RAISE EXCEPTION 'Paid courses require checkout' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO _existing FROM public.enrollments
    WHERE user_id = _uid AND course_id = _course_id;
  IF _existing IS NOT NULL THEN
    RETURN _existing;
  END IF;
  INSERT INTO public.enrollments (user_id, course_id)
    VALUES (_uid, _course_id)
    RETURNING id INTO _new_id;
  RETURN _new_id;
END; $$;
REVOKE ALL ON FUNCTION public.enroll_free_course(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enroll_free_course(uuid) TO authenticated;

-- 8) unpublish_for_edit RPC (admin only, zero learner history)
CREATE OR REPLACE FUNCTION public.unpublish_for_edit(_course_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _is_published boolean;
  _status public.course_review_status;
  _instructor uuid;
  _r text := btrim(coalesce(_reason,''));
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF NOT public.has_role(_uid, 'admin') THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = '42501';
  END IF;
  IF _r = '' THEN
    RAISE EXCEPTION 'Reason required' USING ERRCODE = '22023';
  END IF;
  IF length(_r) > 1000 THEN
    RAISE EXCEPTION 'Reason too long' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('mozok.course:' || _course_id::text));
  SELECT is_published, review_status, instructor_id
    INTO _is_published, _status, _instructor
    FROM public.courses WHERE id = _course_id FOR UPDATE;
  IF _is_published IS NULL THEN
    RAISE EXCEPTION 'Course not found' USING ERRCODE = '42704';
  END IF;
  IF NOT (_is_published = true AND _status = 'approved'::public.course_review_status) THEN
    RAISE EXCEPTION 'Course not in published/approved state' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.enrollments WHERE course_id = _course_id) THEN
    RAISE EXCEPTION 'Course has learner enrollments' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.lesson_completions WHERE course_id = _course_id) THEN
    RAISE EXCEPTION 'Course has learner completions' USING ERRCODE = '42501';
  END IF;
  UPDATE public.courses
    SET is_published = false,
        review_status = 'draft'::public.course_review_status,
        review_decision_reason = NULL,
        review_decided_by = NULL,
        review_decided_at = NULL,
        submitted_at = NULL
    WHERE id = _course_id;
  INSERT INTO public.audit_events (event_type, actor_id, subject_id, target_kind, target_id, reason)
  VALUES ('course_unpublished_for_edit', _uid, _instructor, 'course', _course_id, _r);
END; $$;
REVOKE ALL ON FUNCTION public.unpublish_for_edit(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unpublish_for_edit(uuid, text) TO authenticated;

-- 9) list_admin_courses RPC
CREATE OR REPLACE FUNCTION public.list_admin_courses()
RETURNS TABLE(
  id uuid, slug text, title text, category text,
  instructor_id uuid, instructor_name text,
  is_published boolean, review_status public.course_review_status,
  enrollments_count bigint, completions_count bigint, reviews_count bigint,
  updated_at timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.slug, c.title, c.category, c.instructor_id, c.instructor_name,
    c.is_published, c.review_status,
    (SELECT count(*) FROM public.enrollments e WHERE e.course_id = c.id),
    (SELECT count(*) FROM public.lesson_completions lc WHERE lc.course_id = c.id),
    (SELECT count(*) FROM public.reviews r WHERE r.course_id = c.id),
    c.updated_at
  FROM public.courses c
  WHERE public.has_role(auth.uid(), 'admin')
  ORDER BY c.updated_at DESC
$$;
REVOKE ALL ON FUNCTION public.list_admin_courses() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_admin_courses() TO authenticated;

-- 10) get_admin_course RPC
CREATE OR REPLACE FUNCTION public.get_admin_course(_course_id uuid)
RETURNS TABLE(
  id uuid, slug text, title text, subtitle text, category text,
  description text, instructor_id uuid, instructor_name text,
  is_published boolean, review_status public.course_review_status,
  review_decision_reason text, price_cents int,
  enrollments_count bigint, completions_count bigint, reviews_count bigint,
  can_unpublish boolean, updated_at timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.slug, c.title, c.subtitle, c.category, c.description,
    c.instructor_id, c.instructor_name,
    c.is_published, c.review_status, c.review_decision_reason, c.price_cents,
    (SELECT count(*) FROM public.enrollments e WHERE e.course_id = c.id),
    (SELECT count(*) FROM public.lesson_completions lc WHERE lc.course_id = c.id),
    (SELECT count(*) FROM public.reviews r WHERE r.course_id = c.id),
    (c.is_published = true
      AND c.review_status = 'approved'::public.course_review_status
      AND NOT EXISTS (SELECT 1 FROM public.enrollments e WHERE e.course_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM public.lesson_completions lc WHERE lc.course_id = c.id)),
    c.updated_at
  FROM public.courses c
  WHERE c.id = _course_id AND public.has_role(auth.uid(), 'admin')
$$;
REVOKE ALL ON FUNCTION public.get_admin_course(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_course(uuid) TO authenticated;