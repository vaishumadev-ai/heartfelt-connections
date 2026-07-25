
-- ============================================================
-- Phase 2B FINAL CORRECTION PASS — forward-only.
-- P0: remove SECURITY DEFINER current_user bypass in enforcement fns.
-- P1: unpublish_for_edit and can_unpublish also require zero reviews.
-- P2: get_admin_course_lessons — admin-only, metadata-only.
-- ============================================================

-- ---- Course delete-safety (no bypass) ----
CREATE OR REPLACE FUNCTION public.enforce_course_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NOT public.course_is_editable(OLD.id) THEN
    RAISE EXCEPTION 'Course not deletable: not in editable state'
      USING ERRCODE = '42501';
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
END;
$function$;

-- ---- Lesson delete-safety (no bypass) ----
CREATE OR REPLACE FUNCTION public.enforce_lesson_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NOT public.course_is_editable(OLD.course_id) THEN
    RAISE EXCEPTION 'Parent course not in editable state' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.lesson_completions WHERE lesson_id = OLD.id) THEN
    RAISE EXCEPTION 'Lesson has learner completions' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$function$;

-- ---- Course content lock (no bypass; governance-only column changes still pass) ----
CREATE OR REPLACE FUNCTION public.enforce_course_content_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _editable boolean;
BEGIN
  _editable := (OLD.is_published = false
                AND OLD.review_status::text IN ('draft','rejected'));

  IF _editable THEN
    RETURN NEW;
  END IF;

  -- Locked. Content columns must be identical to OLD; only governance
  -- columns (protected separately by protect_course_governance) may
  -- transition. Governance RPCs succeed because they only touch
  -- is_published / review_status / review_* / submitted_at, never
  -- these content columns.
  IF NEW.slug            IS DISTINCT FROM OLD.slug
     OR NEW.title        IS DISTINCT FROM OLD.title
     OR NEW.subtitle     IS DISTINCT FROM OLD.subtitle
     OR NEW.description  IS DISTINCT FROM OLD.description
     OR NEW.category     IS DISTINCT FROM OLD.category
     OR NEW.cover_url    IS DISTINCT FROM OLD.cover_url
     OR NEW.icon_kind    IS DISTINCT FROM OLD.icon_kind
     OR NEW.price_cents  IS DISTINCT FROM OLD.price_cents
     OR NEW.duration_label IS DISTINCT FROM OLD.duration_label
     OR NEW.level        IS DISTINCT FROM OLD.level
     OR NEW.language     IS DISTINCT FROM OLD.language
     OR NEW.learn_outcomes IS DISTINCT FROM OLD.learn_outcomes
     OR NEW.skills       IS DISTINCT FROM OLD.skills
     OR NEW.requirements IS DISTINCT FROM OLD.requirements
     OR NEW.audience     IS DISTINCT FROM OLD.audience
     OR NEW.faq          IS DISTINCT FROM OLD.faq
     OR NEW.instructor_name  IS DISTINCT FROM OLD.instructor_name
     OR NEW.instructor_title IS DISTINCT FROM OLD.instructor_title
     OR NEW.instructor_bio   IS DISTINCT FROM OLD.instructor_bio
     OR NEW.certificate  IS DISTINCT FROM OLD.certificate
  THEN
    RAISE EXCEPTION 'Course content locked: course is not in an editable state'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

-- ---- Lesson content lock (no bypass) ----
CREATE OR REPLACE FUNCTION public.enforce_lesson_content_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.course_id IS DISTINCT FROM OLD.course_id THEN
    RAISE EXCEPTION 'Lesson cannot be reassigned to another course'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.course_is_editable(NEW.course_id) THEN
    RAISE EXCEPTION 'Parent course is not in an editable state'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

-- ---- unpublish_for_edit: also require zero reviews ----
CREATE OR REPLACE FUNCTION public.unpublish_for_edit(_course_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
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
  IF EXISTS (SELECT 1 FROM public.reviews WHERE course_id = _course_id) THEN
    RAISE EXCEPTION 'Course has learner reviews' USING ERRCODE = '42501';
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
END;
$function$;

-- ---- get_admin_course: can_unpublish must also require zero reviews ----
CREATE OR REPLACE FUNCTION public.get_admin_course(_course_id uuid)
RETURNS TABLE(id uuid, slug text, title text, subtitle text, category text, description text, instructor_id uuid, instructor_name text, is_published boolean, review_status course_review_status, review_decision_reason text, price_cents integer, enrollments_count bigint, completions_count bigint, reviews_count bigint, can_unpublish boolean, updated_at timestamp with time zone)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT c.id, c.slug, c.title, c.subtitle, c.category, c.description,
    c.instructor_id, c.instructor_name,
    c.is_published, c.review_status, c.review_decision_reason, c.price_cents,
    (SELECT count(*) FROM public.enrollments e WHERE e.course_id = c.id),
    (SELECT count(*) FROM public.lesson_completions lc WHERE lc.course_id = c.id),
    (SELECT count(*) FROM public.reviews r WHERE r.course_id = c.id),
    (c.is_published = true
      AND c.review_status = 'approved'::public.course_review_status
      AND NOT EXISTS (SELECT 1 FROM public.enrollments e WHERE e.course_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM public.lesson_completions lc WHERE lc.course_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM public.reviews r WHERE r.course_id = c.id)),
    c.updated_at
  FROM public.courses c
  WHERE c.id = _course_id AND public.has_role(auth.uid(), 'admin')
$function$;

-- ---- get_admin_course_lessons: metadata only, admin-only, canonical order ----
CREATE OR REPLACE FUNCTION public.get_admin_course_lessons(_course_id uuid)
RETURNS TABLE(id uuid, title text, "position" integer, duration_seconds integer, module_title text, is_preview boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT l.id, l.title, l."position", l.duration_seconds, l.module_title, l.is_preview
  FROM public.lessons l
  WHERE public.has_role(auth.uid(), 'admin')
    AND l.course_id = _course_id
  ORDER BY l."position" ASC, l.id ASC
$function$;

REVOKE ALL ON FUNCTION public.get_admin_course_lessons(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_course_lessons(uuid) TO authenticated;
