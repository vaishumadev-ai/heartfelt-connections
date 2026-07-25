
-- ============================================================
-- Phase 2B Correction Pass — forward-only
-- ============================================================

-- 1. Authoritative delete-safety triggers as SECURITY DEFINER.
--    (Prior versions ran as caller and short-circuited on the
--     `postgres`/`service_role`/`supabase_admin` current_user check.
--     Under PostgREST an authenticated caller runs as role
--     `authenticated`, so that branch was never hit and RLS on
--     child tables could theoretically hide rows; we now enforce
--     invariants with definer authority and explicit bypass only
--     for privileged system roles.)

CREATE OR REPLACE FUNCTION public.enforce_course_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('postgres','service_role','supabase_admin') THEN
    RETURN OLD;
  END IF;
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
$$;

REVOKE ALL ON FUNCTION public.enforce_course_delete() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.enforce_lesson_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
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
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_lesson_delete() FROM PUBLIC, anon, authenticated;

-- 2. Course content lock (BEFORE UPDATE). Blocks non-governance
--    column mutations when the course is not in an editable state.
--    Governance columns (is_published, review_status, review_*,
--    submitted_at, rating, students_count, likes, instructor_id)
--    are already policed by protect_course_governance_trg; this
--    trigger complements that by locking all *content* columns when
--    the course is beyond draft/rejected.

CREATE OR REPLACE FUNCTION public.enforce_course_content_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _editable boolean;
BEGIN
  -- System roles bypass (migrations, service_role writes).
  IF current_user IN ('postgres','service_role','supabase_admin') THEN
    RETURN NEW;
  END IF;

  _editable := (OLD.is_published = false
                AND OLD.review_status::text IN ('draft','rejected'));

  IF _editable THEN
    RETURN NEW;
  END IF;

  -- Locked. Only governance columns may change (governance trigger
  -- guards which roles may touch those). Content columns must be
  -- identical to OLD.
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
$$;

REVOKE ALL ON FUNCTION public.enforce_course_content_lock() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_course_content_lock_trg ON public.courses;
CREATE TRIGGER enforce_course_content_lock_trg
BEFORE UPDATE ON public.courses
FOR EACH ROW
EXECUTE FUNCTION public.enforce_course_content_lock();

-- 3. Lesson content lock (BEFORE INSERT/UPDATE). Blocks any mutation
--    when the parent course is not editable, and blocks reassignment
--    of a lesson from one course to another.

CREATE OR REPLACE FUNCTION public.enforce_lesson_content_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('postgres','service_role','supabase_admin') THEN
    RETURN NEW;
  END IF;

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
$$;

REVOKE ALL ON FUNCTION public.enforce_lesson_content_lock() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_lesson_content_lock_trg ON public.lessons;
CREATE TRIGGER enforce_lesson_content_lock_trg
BEFORE INSERT OR UPDATE ON public.lessons
FOR EACH ROW
EXECUTE FUNCTION public.enforce_lesson_content_lock();

-- 4. Lesson privileges — replace broad table-level authenticated
--    INSERT/UPDATE with a column-scoped allowlist covering only the
--    Studio-supported authoring fields. service_role retains ALL.

REVOKE INSERT, UPDATE ON public.lessons FROM authenticated;

GRANT INSERT (course_id, position, title, duration_seconds, video_url,
              content, is_preview, module_title)
  ON public.lessons TO authenticated;

GRANT UPDATE (position, title, duration_seconds, video_url,
              content, is_preview, module_title)
  ON public.lessons TO authenticated;

-- SELECT / DELETE grants remain unchanged (governed by RLS policies).
