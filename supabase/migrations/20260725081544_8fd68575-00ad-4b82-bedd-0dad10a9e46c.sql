
-- =========================================================
-- Phase 1C — Curation, instructor lifecycle, audit trail
-- Forward-only. No admin bootstrap. No production UUID.
-- =========================================================

-- 1. Enums --------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.instructor_application_status AS ENUM ('pending','approved','rejected','withdrawn');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.course_review_status AS ENUM ('draft','pending_review','approved','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. instructor_applications --------------------------------
CREATE TABLE IF NOT EXISTS public.instructor_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  status public.instructor_application_status NOT NULL DEFAULT 'pending',
  application_reason text,
  decision_reason text,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT decision_shape CHECK (
    (status IN ('approved','rejected') AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
    OR (status IN ('pending','withdrawn') AND decided_by IS NULL AND decided_at IS NULL)
  )
);

-- One active pending application per user.
CREATE UNIQUE INDEX IF NOT EXISTS instructor_applications_one_pending
  ON public.instructor_applications (user_id)
  WHERE status = 'pending';

GRANT SELECT ON public.instructor_applications TO authenticated;
GRANT ALL ON public.instructor_applications TO service_role;
ALTER TABLE public.instructor_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own applications" ON public.instructor_applications;
CREATE POLICY "Users read own applications" ON public.instructor_applications
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- All writes go through SECURITY DEFINER functions.

-- 3. audit_events (append-only) -----------------------------
CREATE TABLE IF NOT EXISTS public.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  actor_id uuid,
  subject_id uuid,
  target_kind text,
  target_id uuid,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- No direct grants to anon/authenticated — reads via admin RPCs only.
GRANT ALL ON public.audit_events TO service_role;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

-- No policies for authenticated: they cannot select, insert, update, or delete.
-- Writes happen only through SECURITY DEFINER functions.

-- 4. Course review lifecycle columns ------------------------
ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS review_status public.course_review_status NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS review_decision_reason text,
  ADD COLUMN IF NOT EXISTS review_decided_by uuid,
  ADD COLUMN IF NOT EXISTS review_decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz;

-- Existing published courses are already approved.
UPDATE public.courses SET review_status = 'approved'
  WHERE is_published = true AND review_status = 'draft';

-- 5. Role-check helpers -------------------------------------
-- current_user_has_role: caller only, safe to expose to authenticated.
CREATE OR REPLACE FUNCTION public.current_user_has_role(_role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = _role
  );
$$;

REVOKE ALL ON FUNCTION public.current_user_has_role(public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_has_role(public.app_role) TO authenticated;

-- Lock down has_role — used inside SECURITY DEFINER functions only.
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
-- (authenticated retained: existing entitlement code uses it; role lookup for
--  other users is still possible but the has_role result of another user's UUID
--  is not sensitive on its own; enforcement of privileged ops happens inside
--  the SECURITY DEFINER RPCs below via current_user_has_role.)

-- 6. Course RLS retighten -----------------------------------
DROP POLICY IF EXISTS "Instructors manage own courses" ON public.courses;
DROP POLICY IF EXISTS "Instructors read own drafts" ON public.courses;

-- Instructors can only touch their own courses AND must currently hold the
-- 'instructor' role. Revoked instructors immediately lose access.
CREATE POLICY "Active instructors read own courses"
  ON public.courses FOR SELECT TO authenticated
  USING (
    instructor_id = auth.uid()
    AND public.current_user_has_role('instructor')
  );

CREATE POLICY "Active instructors insert own courses"
  ON public.courses FOR INSERT TO authenticated
  WITH CHECK (
    instructor_id = auth.uid()
    AND public.current_user_has_role('instructor')
  );

CREATE POLICY "Active instructors update own courses"
  ON public.courses FOR UPDATE TO authenticated
  USING (
    instructor_id = auth.uid()
    AND public.current_user_has_role('instructor')
  )
  WITH CHECK (
    instructor_id = auth.uid()
    AND public.current_user_has_role('instructor')
  );

CREATE POLICY "Active instructors delete own courses"
  ON public.courses FOR DELETE TO authenticated
  USING (
    instructor_id = auth.uid()
    AND public.current_user_has_role('instructor')
  );

-- Prevent instructors from directly flipping is_published (column-level revoke).
-- Admins go through approve_course RPC (SECURITY DEFINER).
REVOKE UPDATE (is_published, review_status, review_decision_reason,
               review_decided_by, review_decided_at, submitted_at,
               instructor_id, rating, students_count, likes)
  ON public.courses FROM authenticated;

-- 7. Lessons RLS retighten ---------------------------------
DROP POLICY IF EXISTS "Instructors manage own lessons" ON public.lessons;

CREATE POLICY "Active instructors manage own lessons"
  ON public.lessons FOR ALL TO authenticated
  USING (
    public.current_user_has_role('instructor')
    AND EXISTS (
      SELECT 1 FROM public.courses c
      WHERE c.id = lessons.course_id AND c.instructor_id = auth.uid()
    )
  )
  WITH CHECK (
    public.current_user_has_role('instructor')
    AND EXISTS (
      SELECT 1 FROM public.courses c
      WHERE c.id = lessons.course_id AND c.instructor_id = auth.uid()
    )
  );

-- 8. Reviews RLS retighten ---------------------------------
DROP POLICY IF EXISTS "Users manage own reviews" ON public.reviews;
DROP POLICY IF EXISTS "Users update own reviews" ON public.reviews;
DROP POLICY IF EXISTS "Reviews public read" ON public.reviews;

-- Public read: only reviews attached to eligible (published, free) enrollments.
CREATE POLICY "Eligible reviews public read"
  ON public.reviews FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.enrollments e
      JOIN public.courses c ON c.id = e.course_id
      WHERE e.user_id = reviews.user_id
        AND e.course_id = reviews.course_id
        AND c.is_published = true
        AND c.price_cents = 0
    )
  );

-- Author can see own reviews (even if temporarily ineligible).
CREATE POLICY "Users read own reviews"
  ON public.reviews FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- INSERT/UPDATE require: own row + free/published course + enrollment.
CREATE POLICY "Verified learners insert reviews"
  ON public.reviews FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.enrollments e
      JOIN public.courses c ON c.id = e.course_id
      WHERE e.user_id = auth.uid()
        AND e.course_id = reviews.course_id
        AND c.is_published = true
        AND c.price_cents = 0
    )
  );

CREATE POLICY "Verified learners update own reviews"
  ON public.reviews FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.enrollments e
      JOIN public.courses c ON c.id = e.course_id
      WHERE e.user_id = auth.uid()
        AND e.course_id = reviews.course_id
        AND c.is_published = true
        AND c.price_cents = 0
    )
  );

-- DELETE remains owner-only (existing "Users delete own reviews" retained).

-- 9. Instructor application RPCs ---------------------------
CREATE OR REPLACE FUNCTION public.apply_for_instructor(_reason text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid(); _app_id uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000'; END IF;

  -- Already an instructor? Idempotent — just record and return.
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role = 'instructor') THEN
    RETURN NULL;
  END IF;

  -- Reuse pending row if present (idempotent).
  SELECT id INTO _app_id FROM public.instructor_applications
    WHERE user_id = _uid AND status = 'pending' LIMIT 1;
  IF _app_id IS NOT NULL THEN RETURN _app_id; END IF;

  INSERT INTO public.instructor_applications (user_id, status, application_reason)
  VALUES (_uid, 'pending', NULLIF(trim(coalesce(_reason,'')),''))
  RETURNING id INTO _app_id;

  INSERT INTO public.audit_events (event_type, actor_id, subject_id, target_kind, target_id, reason)
  VALUES ('instructor_application_submitted', _uid, _uid, 'instructor_application', _app_id, NULLIF(trim(coalesce(_reason,'')),''));

  RETURN _app_id;
END; $$;

REVOKE ALL ON FUNCTION public.apply_for_instructor(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_for_instructor(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.withdraw_instructor_application(_application_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid(); _owner uuid; _status public.instructor_application_status;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000'; END IF;

  SELECT user_id, status INTO _owner, _status
    FROM public.instructor_applications WHERE id = _application_id FOR UPDATE;
  IF _owner IS NULL THEN RAISE EXCEPTION 'Application not found' USING ERRCODE = '42704'; END IF;
  IF _owner <> _uid THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501'; END IF;
  IF _status <> 'pending' THEN RAISE EXCEPTION 'Only pending applications can be withdrawn' USING ERRCODE = '22023'; END IF;

  UPDATE public.instructor_applications
    SET status = 'withdrawn', updated_at = now()
    WHERE id = _application_id;

  INSERT INTO public.audit_events (event_type, actor_id, subject_id, target_kind, target_id)
  VALUES ('instructor_application_withdrawn', _uid, _uid, 'instructor_application', _application_id);
END; $$;

REVOKE ALL ON FUNCTION public.withdraw_instructor_application(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.withdraw_instructor_application(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.approve_instructor_application(_application_id uuid, _reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid(); _owner uuid; _status public.instructor_application_status;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000'; END IF;
  IF NOT public.current_user_has_role('admin') THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = '42501';
  END IF;

  SELECT user_id, status INTO _owner, _status
    FROM public.instructor_applications WHERE id = _application_id FOR UPDATE;
  IF _owner IS NULL THEN RAISE EXCEPTION 'Application not found' USING ERRCODE = '42704'; END IF;
  IF _status <> 'pending' THEN RAISE EXCEPTION 'Application not pending' USING ERRCODE = '22023'; END IF;

  INSERT INTO public.user_roles (user_id, role)
    VALUES (_owner, 'instructor')
    ON CONFLICT (user_id, role) DO NOTHING;

  UPDATE public.instructor_applications
    SET status = 'approved',
        decision_reason = NULLIF(trim(coalesce(_reason,'')),''),
        decided_by = _uid,
        decided_at = now(),
        updated_at = now()
    WHERE id = _application_id;

  INSERT INTO public.audit_events (event_type, actor_id, subject_id, target_kind, target_id, reason)
  VALUES ('instructor_application_approved', _uid, _owner, 'instructor_application', _application_id, _reason);
  INSERT INTO public.audit_events (event_type, actor_id, subject_id, target_kind, target_id, reason)
  VALUES ('role_granted', _uid, _owner, 'role', NULL, 'instructor');
END; $$;

REVOKE ALL ON FUNCTION public.approve_instructor_application(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_instructor_application(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_instructor_application(_application_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid(); _owner uuid; _status public.instructor_application_status;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000'; END IF;
  IF NOT public.current_user_has_role('admin') THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = '42501';
  END IF;
  IF _reason IS NULL OR trim(_reason) = '' THEN
    RAISE EXCEPTION 'Reason required' USING ERRCODE = '22023';
  END IF;

  SELECT user_id, status INTO _owner, _status
    FROM public.instructor_applications WHERE id = _application_id FOR UPDATE;
  IF _owner IS NULL THEN RAISE EXCEPTION 'Application not found' USING ERRCODE = '42704'; END IF;
  IF _status <> 'pending' THEN RAISE EXCEPTION 'Application not pending' USING ERRCODE = '22023'; END IF;

  UPDATE public.instructor_applications
    SET status = 'rejected',
        decision_reason = trim(_reason),
        decided_by = _uid,
        decided_at = now(),
        updated_at = now()
    WHERE id = _application_id;

  INSERT INTO public.audit_events (event_type, actor_id, subject_id, target_kind, target_id, reason)
  VALUES ('instructor_application_rejected', _uid, _owner, 'instructor_application', _application_id, trim(_reason));
END; $$;

REVOKE ALL ON FUNCTION public.reject_instructor_application(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_instructor_application(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_instructor_role(_user_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000'; END IF;
  IF NOT public.current_user_has_role('admin') THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = '42501';
  END IF;
  IF _reason IS NULL OR trim(_reason) = '' THEN
    RAISE EXCEPTION 'Reason required' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.user_roles WHERE user_id = _user_id AND role = 'instructor';

  INSERT INTO public.audit_events (event_type, actor_id, subject_id, target_kind, reason)
  VALUES ('role_revoked', _uid, _user_id, 'role', 'instructor: ' || trim(_reason));
END; $$;

REVOKE ALL ON FUNCTION public.revoke_instructor_role(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_instructor_role(uuid, text) TO authenticated;

-- 10. Final-admin protection --------------------------------
CREATE OR REPLACE FUNCTION public.protect_final_admin()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _admin_count int;
BEGIN
  IF (TG_OP = 'DELETE' AND OLD.role = 'admin')
     OR (TG_OP = 'UPDATE' AND OLD.role = 'admin' AND NEW.role IS DISTINCT FROM 'admin') THEN
    SELECT count(*) INTO _admin_count FROM public.user_roles WHERE role = 'admin';
    IF _admin_count <= 1 THEN
      RAISE EXCEPTION 'Cannot remove the final admin' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END; $$;

DROP TRIGGER IF EXISTS protect_final_admin_trg ON public.user_roles;
CREATE TRIGGER protect_final_admin_trg
  BEFORE UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.protect_final_admin();

-- 11. Course review lifecycle RPCs --------------------------
CREATE OR REPLACE FUNCTION public.submit_course_for_review(_course_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid(); _owner uuid; _status public.course_review_status;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000'; END IF;
  IF NOT public.current_user_has_role('instructor') THEN
    RAISE EXCEPTION 'Instructor role required' USING ERRCODE = '42501';
  END IF;

  SELECT instructor_id, review_status INTO _owner, _status
    FROM public.courses WHERE id = _course_id FOR UPDATE;
  IF _owner IS NULL THEN RAISE EXCEPTION 'Course not found' USING ERRCODE = '42704'; END IF;
  IF _owner <> _uid THEN RAISE EXCEPTION 'Not your course' USING ERRCODE = '42501'; END IF;
  IF _status NOT IN ('draft','rejected') THEN
    RAISE EXCEPTION 'Course not in a submittable state' USING ERRCODE = '22023';
  END IF;

  UPDATE public.courses
    SET review_status = 'pending_review',
        submitted_at = now(),
        review_decision_reason = NULL
    WHERE id = _course_id;

  INSERT INTO public.audit_events (event_type, actor_id, subject_id, target_kind, target_id)
  VALUES ('course_submitted_for_review', _uid, _uid, 'course', _course_id);
END; $$;
REVOKE ALL ON FUNCTION public.submit_course_for_review(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_course_for_review(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.approve_course(_course_id uuid, _reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid(); _owner uuid; _status public.course_review_status;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000'; END IF;
  IF NOT public.current_user_has_role('admin') THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = '42501';
  END IF;

  SELECT instructor_id, review_status INTO _owner, _status
    FROM public.courses WHERE id = _course_id FOR UPDATE;
  IF _owner IS NULL THEN RAISE EXCEPTION 'Course not found' USING ERRCODE = '42704'; END IF;
  IF _status <> 'pending_review' THEN
    RAISE EXCEPTION 'Course not pending review' USING ERRCODE = '22023';
  END IF;

  UPDATE public.courses
    SET review_status = 'approved',
        is_published = true,
        review_decision_reason = NULLIF(trim(coalesce(_reason,'')),''),
        review_decided_by = _uid,
        review_decided_at = now()
    WHERE id = _course_id;

  INSERT INTO public.audit_events (event_type, actor_id, subject_id, target_kind, target_id, reason)
  VALUES ('course_approved', _uid, _owner, 'course', _course_id, _reason);
  INSERT INTO public.audit_events (event_type, actor_id, subject_id, target_kind, target_id)
  VALUES ('course_published', _uid, _owner, 'course', _course_id);
END; $$;
REVOKE ALL ON FUNCTION public.approve_course(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_course(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_course(_course_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid(); _owner uuid; _status public.course_review_status;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000'; END IF;
  IF NOT public.current_user_has_role('admin') THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = '42501';
  END IF;
  IF _reason IS NULL OR trim(_reason) = '' THEN
    RAISE EXCEPTION 'Reason required' USING ERRCODE = '22023';
  END IF;

  SELECT instructor_id, review_status INTO _owner, _status
    FROM public.courses WHERE id = _course_id FOR UPDATE;
  IF _owner IS NULL THEN RAISE EXCEPTION 'Course not found' USING ERRCODE = '42704'; END IF;
  IF _status <> 'pending_review' THEN
    RAISE EXCEPTION 'Course not pending review' USING ERRCODE = '22023';
  END IF;

  UPDATE public.courses
    SET review_status = 'rejected',
        review_decision_reason = trim(_reason),
        review_decided_by = _uid,
        review_decided_at = now()
    WHERE id = _course_id;

  INSERT INTO public.audit_events (event_type, actor_id, subject_id, target_kind, target_id, reason)
  VALUES ('course_rejected', _uid, _owner, 'course', _course_id, trim(_reason));
END; $$;
REVOKE ALL ON FUNCTION public.reject_course(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_course(uuid, text) TO authenticated;

-- 12. Verified review submission ---------------------------
-- Atomic upsert; never delete-first-then-insert.
CREATE OR REPLACE FUNCTION public.submit_review_verified(
  _course_id uuid, _rating int, _body text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000'; END IF;
  IF _rating < 1 OR _rating > 5 THEN
    RAISE EXCEPTION 'Rating 1..5' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.enrollments e
    JOIN public.courses c ON c.id = e.course_id
    WHERE e.user_id = _uid AND e.course_id = _course_id
      AND c.is_published = true AND c.price_cents = 0
  ) THEN
    RAISE EXCEPTION 'Review requires free-course enrollment' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.reviews (user_id, course_id, rating, body)
  VALUES (_uid, _course_id, _rating, _body)
  ON CONFLICT (user_id, course_id) DO UPDATE
    SET rating = EXCLUDED.rating, body = EXCLUDED.body;
END; $$;

-- Ensure uniqueness for the upsert target.
DO $$ BEGIN
  ALTER TABLE public.reviews ADD CONSTRAINT reviews_user_course_uq UNIQUE (user_id, course_id);
EXCEPTION WHEN duplicate_object THEN NULL;
         WHEN duplicate_table THEN NULL;
         WHEN unique_violation THEN NULL;
END $$;

REVOKE ALL ON FUNCTION public.submit_review_verified(uuid, int, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_review_verified(uuid, int, text) TO authenticated;
