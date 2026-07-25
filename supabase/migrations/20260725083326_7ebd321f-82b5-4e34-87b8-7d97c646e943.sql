
-- ============================================================
-- Phase 1C.1 — Curation Security Closure
-- Forward-only migration.
-- ============================================================

-- A. Default safety: new courses start as drafts.
ALTER TABLE public.courses ALTER COLUMN is_published SET DEFAULT false;

-- B. Revoke broad table-level INSERT/UPDATE from authenticated.
REVOKE INSERT, UPDATE ON public.courses FROM authenticated;

-- C. Grant INSERT only on the exact columns createCourse writes.
GRANT INSERT (title, category, slug, instructor_id, price_cents)
  ON public.courses TO authenticated;

-- D. Grant UPDATE only on editable content columns.
GRANT UPDATE (
  title, subtitle, description, category, price_cents,
  duration_label, icon_kind, cover_url, level, language,
  learn_outcomes, skills, requirements, audience, faq,
  instructor_name, instructor_title, instructor_bio, certificate
) ON public.courses TO authenticated;

-- E. Strengthen INSERT RLS WITH CHECK — reject any attempt to plant
--    governance state at creation time, even via column-level grants.
DROP POLICY IF EXISTS "Active instructors insert own courses" ON public.courses;
CREATE POLICY "Active instructors insert own courses"
  ON public.courses
  FOR INSERT
  TO authenticated
  WITH CHECK (
    instructor_id = auth.uid()
    AND public.current_user_has_role('instructor')
    AND is_published = false
    AND review_status = 'draft'::public.course_review_status
    AND submitted_at IS NULL
    AND review_decided_by IS NULL
    AND review_decided_at IS NULL
    AND review_decision_reason IS NULL
  );

-- F. Defence-in-depth trigger: block non-admin changes to governance
--    columns even if privileges are widened accidentally in the future.
--    SECURITY DEFINER RPCs (approve_course, reject_course,
--    submit_course_for_review) run with current_user = function owner
--    (postgres), so they bypass this check. service_role bypasses too.
CREATE OR REPLACE FUNCTION public.protect_course_governance()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NOT NULL AND public.has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.is_published IS DISTINCT FROM false
       OR NEW.review_status IS DISTINCT FROM 'draft'::public.course_review_status
       OR NEW.review_decision_reason IS NOT NULL
       OR NEW.review_decided_by IS NOT NULL
       OR NEW.review_decided_at IS NOT NULL
       OR NEW.submitted_at IS NOT NULL
       OR NEW.rating IS DISTINCT FROM 0
       OR NEW.students_count IS DISTINCT FROM 0
       OR NEW.likes IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'Governance columns cannot be set on insert'
        USING ERRCODE = '42501';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.is_published IS DISTINCT FROM OLD.is_published
       OR NEW.review_status IS DISTINCT FROM OLD.review_status
       OR NEW.review_decision_reason IS DISTINCT FROM OLD.review_decision_reason
       OR NEW.review_decided_by IS DISTINCT FROM OLD.review_decided_by
       OR NEW.review_decided_at IS DISTINCT FROM OLD.review_decided_at
       OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
       OR NEW.instructor_id IS DISTINCT FROM OLD.instructor_id
       OR NEW.rating IS DISTINCT FROM OLD.rating
       OR NEW.students_count IS DISTINCT FROM OLD.students_count
       OR NEW.likes IS DISTINCT FROM OLD.likes THEN
      RAISE EXCEPTION 'Protected governance columns cannot be modified by non-admins'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_course_governance_trg ON public.courses;
CREATE TRIGGER protect_course_governance_trg
  BEFORE INSERT OR UPDATE ON public.courses
  FOR EACH ROW EXECUTE FUNCTION public.protect_course_governance();

-- G. Final-admin concurrency: serialize the last-admin removal check
--    with a transaction-scoped advisory lock. Two concurrent removals
--    now block on the same lock and cannot both observe count > 1.
CREATE OR REPLACE FUNCTION public.protect_final_admin()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE _admin_count int;
BEGIN
  IF (TG_OP = 'DELETE' AND OLD.role = 'admin')
     OR (TG_OP = 'UPDATE' AND OLD.role = 'admin' AND NEW.role IS DISTINCT FROM 'admin') THEN
    -- Serialize concurrent final-admin removals.
    PERFORM pg_advisory_xact_lock(hashtext('mozok.final_admin_lock'));
    SELECT count(*) INTO _admin_count FROM public.user_roles WHERE role = 'admin';
    IF _admin_count <= 1 THEN
      RAISE EXCEPTION 'Cannot remove the final admin' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
