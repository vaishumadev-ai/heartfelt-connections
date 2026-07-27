-- ============================================================
-- Certificates — issuance, verification, revocation
-- ============================================================

-- 1) Table
CREATE TABLE IF NOT EXISTS public.certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE RESTRICT,
  certificate_number text NOT NULL UNIQUE,
  verification_code uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  learner_name_snapshot text NOT NULL,
  course_title_snapshot text NOT NULL,
  instructor_name_snapshot text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES auth.users(id),
  revocation_reason text,
  CONSTRAINT certificates_user_course_uniq UNIQUE (user_id, course_id)
);

CREATE INDEX IF NOT EXISTS certificates_user_idx ON public.certificates(user_id);
CREATE INDEX IF NOT EXISTS certificates_course_idx ON public.certificates(course_id);

-- 2) Grants: read-only for authenticated (RLS scopes rows); anon has no access; service_role full.
GRANT SELECT ON public.certificates TO authenticated;
GRANT ALL ON public.certificates TO service_role;

-- 3) RLS
ALTER TABLE public.certificates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Learners read own certificates" ON public.certificates;
CREATE POLICY "Learners read own certificates" ON public.certificates
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins read all certificates" ON public.certificates;
CREATE POLICY "Admins read all certificates" ON public.certificates
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- No INSERT/UPDATE/DELETE policies -> those verbs denied for authenticated.

-- 4) Immutability & no-delete triggers
CREATE OR REPLACE FUNCTION public.enforce_certificate_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.course_id IS DISTINCT FROM OLD.course_id
       OR NEW.certificate_number IS DISTINCT FROM OLD.certificate_number
       OR NEW.verification_code IS DISTINCT FROM OLD.verification_code
       OR NEW.learner_name_snapshot IS DISTINCT FROM OLD.learner_name_snapshot
       OR NEW.course_title_snapshot IS DISTINCT FROM OLD.course_title_snapshot
       OR NEW.instructor_name_snapshot IS DISTINCT FROM OLD.instructor_name_snapshot
       OR NEW.issued_at IS DISTINCT FROM OLD.issued_at THEN
      RAISE EXCEPTION 'Certificate immutable columns cannot be modified' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END; $fn$;

DROP TRIGGER IF EXISTS certificates_immutable ON public.certificates;
CREATE TRIGGER certificates_immutable BEFORE UPDATE ON public.certificates
  FOR EACH ROW EXECUTE FUNCTION public.enforce_certificate_immutable();

CREATE OR REPLACE FUNCTION public.forbid_certificate_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $fn$
BEGIN
  RAISE EXCEPTION 'Certificates cannot be deleted' USING ERRCODE = '42501';
END; $fn$;

DROP TRIGGER IF EXISTS certificates_no_delete ON public.certificates;
CREATE TRIGGER certificates_no_delete BEFORE DELETE ON public.certificates
  FOR EACH ROW EXECUTE FUNCTION public.forbid_certificate_delete();

-- 5) Certificate number generator
CREATE OR REPLACE FUNCTION public._new_certificate_number()
RETURNS text LANGUAGE plpgsql SET search_path = public AS $fn$
DECLARE
  _num text;
  _tries int := 0;
BEGIN
  LOOP
    _num := 'MZK-' || to_char(now(),'YYYY') || '-' ||
            upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
    IF NOT EXISTS (SELECT 1 FROM public.certificates WHERE certificate_number = _num) THEN
      RETURN _num;
    END IF;
    _tries := _tries + 1;
    IF _tries > 10 THEN
      RAISE EXCEPTION 'Failed to allocate certificate number' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END; $fn$;

-- 6) Issue RPC
CREATE OR REPLACE FUNCTION public.issue_course_certificate(_course_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  _uid uuid := auth.uid();
  _existing_id uuid;
  _course record;
  _enr record;
  _learner_name text;
  _lesson_count int;
  _completed int;
  _cert_id uuid;
  _cert_number text;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('mozok.cert:'||_uid::text||':'||_course_id::text, 0)
  );

  SELECT id INTO _existing_id
    FROM public.certificates WHERE user_id = _uid AND course_id = _course_id;
  IF _existing_id IS NOT NULL THEN
    RETURN _existing_id;
  END IF;

  SELECT id, is_published, price_cents, certificate, title, instructor_name
    INTO _course FROM public.courses WHERE id = _course_id FOR UPDATE;
  IF _course.id IS NULL THEN
    RAISE EXCEPTION 'Course not found' USING ERRCODE = '42704';
  END IF;
  IF _course.is_published IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Course not published' USING ERRCODE = '42501';
  END IF;
  IF _course.certificate IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Certificates not offered for this course' USING ERRCODE = '42501';
  END IF;
  IF coalesce(_course.price_cents, 0) <> 0 THEN
    RAISE EXCEPTION 'Paid courses not yet supported' USING ERRCODE = '42501';
  END IF;

  SELECT id, progress INTO _enr
    FROM public.enrollments
    WHERE user_id = _uid AND course_id = _course_id;
  IF _enr.id IS NULL THEN
    RAISE EXCEPTION 'Enrollment required' USING ERRCODE = '42501';
  END IF;
  IF coalesce(_enr.progress, 0) < 100 THEN
    RAISE EXCEPTION 'Course not complete' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO _lesson_count FROM public.lessons WHERE course_id = _course_id;
  SELECT count(*) INTO _completed
    FROM public.lesson_completions
    WHERE course_id = _course_id AND user_id = _uid;
  IF _lesson_count < 1 OR _completed < _lesson_count THEN
    RAISE EXCEPTION 'Course not complete' USING ERRCODE = '42501';
  END IF;

  SELECT btrim(coalesce(display_name,'')) INTO _learner_name
    FROM public.profiles WHERE id = _uid;
  IF _learner_name IS NULL OR _learner_name = '' THEN
    RAISE EXCEPTION 'Add a display name to your profile before earning a certificate'
      USING ERRCODE = '22023';
  END IF;

  _cert_number := public._new_certificate_number();

  INSERT INTO public.certificates (
    user_id, course_id, certificate_number, learner_name_snapshot,
    course_title_snapshot, instructor_name_snapshot
  ) VALUES (
    _uid, _course_id, _cert_number, _learner_name,
    _course.title,
    coalesce(nullif(btrim(_course.instructor_name), ''), 'Mozok Instructor')
  ) RETURNING id INTO _cert_id;

  INSERT INTO public.audit_events (event_type, actor_id, subject_id, target_kind, target_id)
  VALUES ('certificate_issued', _uid, _uid, 'certificate', _cert_id);

  INSERT INTO public.notifications (user_id, title, body, link)
  VALUES (_uid, 'Certificate issued',
          'Congratulations — you earned a certificate for "' || _course.title || '".',
          '/certificates/' || _cert_id::text);

  RETURN _cert_id;
END; $fn$;

REVOKE ALL ON FUNCTION public.issue_course_certificate(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_course_certificate(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.issue_course_certificate(uuid) TO authenticated;

-- 7) Public verification RPC — returns only presentation-safe fields.
CREATE OR REPLACE FUNCTION public.verify_certificate(_verification_code uuid)
RETURNS TABLE(
  certificate_number text,
  learner_name text,
  course_title text,
  instructor_name text,
  issued_at timestamptz,
  status text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT c.certificate_number,
         c.learner_name_snapshot,
         c.course_title_snapshot,
         c.instructor_name_snapshot,
         c.issued_at,
         CASE WHEN c.revoked_at IS NOT NULL THEN 'revoked' ELSE 'valid' END
    FROM public.certificates c
   WHERE c.verification_code = _verification_code
$fn$;

REVOKE ALL ON FUNCTION public.verify_certificate(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_certificate(uuid) TO anon, authenticated;

-- 8) Admin revocation RPC.
CREATE OR REPLACE FUNCTION public.revoke_certificate(_certificate_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  _uid uuid := auth.uid();
  _owner uuid;
  _already timestamptz;
  _r text := btrim(coalesce(_reason,''));
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF NOT public.has_role(_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = '42501';
  END IF;
  IF char_length(_r) < 10 OR char_length(_r) > 1000 THEN
    RAISE EXCEPTION 'Reason required (10-1000 characters)' USING ERRCODE = '22023';
  END IF;

  SELECT user_id, revoked_at INTO _owner, _already
    FROM public.certificates WHERE id = _certificate_id FOR UPDATE;
  IF _owner IS NULL THEN
    RAISE EXCEPTION 'Certificate not found' USING ERRCODE = '42704';
  END IF;
  IF _already IS NOT NULL THEN
    RETURN;
  END IF;

  UPDATE public.certificates
     SET revoked_at = now(), revoked_by = _uid, revocation_reason = _r
   WHERE id = _certificate_id;

  INSERT INTO public.audit_events (event_type, actor_id, subject_id, target_kind, target_id, reason)
  VALUES ('certificate_revoked', _uid, _owner, 'certificate', _certificate_id, _r);

  INSERT INTO public.notifications (user_id, title, body, link)
  VALUES (_owner, 'Certificate revoked',
          'Your certificate has been revoked by an administrator.',
          '/certificates/' || _certificate_id::text);
END; $fn$;

REVOKE ALL ON FUNCTION public.revoke_certificate(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_certificate(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.revoke_certificate(uuid, text) TO authenticated;

-- 9) Restore certificate UPDATE grant. RLS + enforce_course_content_lock trigger
--    still restrict this to (own course) AND (draft|rejected) states.
GRANT UPDATE (certificate) ON public.courses TO authenticated;

-- 10) Readiness function: drop certificate_unavailable blocker.
CREATE OR REPLACE FUNCTION public.evaluate_course_readiness(_course_id uuid)
RETURNS TABLE(is_ready boolean, blockers jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  _uid uuid := auth.uid();
  _r public.courses%ROWTYPE;
  _b jsonb := '[]'::jsonb;
  _lesson_count int;
  _lesson record;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000'; END IF;
  SELECT * INTO _r FROM public.courses WHERE id = _course_id;
  IF _r.id IS NULL THEN RAISE EXCEPTION 'Course not found' USING ERRCODE = '42704'; END IF;
  IF _r.instructor_id <> _uid AND NOT public.has_role(_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF char_length(btrim(coalesce(_r.title, ''))) < 5 THEN
    _b := _b || jsonb_build_object('code','title_too_short');
  END IF;
  IF _r.slug IS NULL OR btrim(_r.slug) = '' OR _r.slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN
    _b := _b || jsonb_build_object('code','slug_invalid');
  END IF;
  IF char_length(btrim(coalesce(_r.subtitle, ''))) < 10 THEN
    _b := _b || jsonb_build_object('code','subtitle_too_short');
  END IF;
  IF char_length(btrim(coalesce(_r.description, ''))) < 200 THEN
    _b := _b || jsonb_build_object('code','description_too_short');
  END IF;
  IF btrim(coalesce(_r.category, '')) = '' THEN
    _b := _b || jsonb_build_object('code','category_missing');
  END IF;
  IF btrim(coalesce(_r.level, '')) = '' THEN
    _b := _b || jsonb_build_object('code','level_missing');
  END IF;
  IF btrim(coalesce(_r.language, '')) = '' THEN
    _b := _b || jsonb_build_object('code','language_missing');
  END IF;
  IF btrim(coalesce(_r.duration_label, '')) = '' THEN
    _b := _b || jsonb_build_object('code','duration_missing');
  END IF;
  IF _r.cover_storage_path IS NULL OR btrim(_r.cover_storage_path) = '' THEN
    _b := _b || jsonb_build_object('code','cover_missing');
  ELSIF NOT EXISTS (SELECT 1 FROM storage.objects
                    WHERE bucket_id = 'course-covers' AND name = _r.cover_storage_path) THEN
    _b := _b || jsonb_build_object('code','cover_object_missing');
  END IF;
  IF btrim(coalesce(_r.instructor_name, '')) = '' THEN
    _b := _b || jsonb_build_object('code','instructor_name_missing');
  END IF;
  IF btrim(coalesce(_r.instructor_title, '')) = '' THEN
    _b := _b || jsonb_build_object('code','instructor_title_missing');
  END IF;
  IF char_length(btrim(coalesce(_r.instructor_bio, ''))) < 80 THEN
    _b := _b || jsonb_build_object('code','instructor_bio_too_short');
  END IF;
  IF cardinality(coalesce(_r.learn_outcomes, '{}'::text[])) < 3 THEN
    _b := _b || jsonb_build_object('code','learning_outcomes_insufficient');
  END IF;
  IF cardinality(coalesce(_r.skills, '{}'::text[])) < 1 THEN
    _b := _b || jsonb_build_object('code','skills_missing');
  END IF;
  IF cardinality(coalesce(_r.requirements, '{}'::text[])) < 1 THEN
    _b := _b || jsonb_build_object('code','requirements_missing');
  END IF;
  IF cardinality(coalesce(_r.audience, '{}'::text[])) < 1 THEN
    _b := _b || jsonb_build_object('code','audience_missing');
  END IF;
  IF _r.price_cents IS DISTINCT FROM 0 THEN
    _b := _b || jsonb_build_object('code','not_free');
  END IF;
  -- certificate flag is now instructor-controlled; no readiness blocker.

  SELECT count(*) INTO _lesson_count FROM public.lessons WHERE course_id = _course_id;
  IF _lesson_count < 1 THEN
    _b := _b || jsonb_build_object('code','no_lessons');
  END IF;

  FOR _lesson IN
    SELECT id, "position", coalesce(btrim(module_title),'') AS module_title,
           coalesce(content,'') AS content, video_storage_path
      FROM public.lessons WHERE course_id = _course_id
  LOOP
    IF _lesson.module_title = '' THEN
      _b := _b || jsonb_build_object('code','lesson_module_missing','lesson_id',_lesson.id);
    END IF;
    IF _lesson."position" IS NULL OR _lesson."position" < 1 THEN
      _b := _b || jsonb_build_object('code','lesson_position_invalid','lesson_id',_lesson.id);
    END IF;
    IF char_length(btrim(_lesson.content)) < 40 AND _lesson.video_storage_path IS NULL THEN
      _b := _b || jsonb_build_object('code','lesson_content_thin','lesson_id',_lesson.id);
    END IF;
    IF _lesson.video_storage_path IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM storage.objects
                       WHERE bucket_id = 'course-videos' AND name = _lesson.video_storage_path) THEN
      _b := _b || jsonb_build_object('code','lesson_video_object_missing','lesson_id',_lesson.id);
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT "position" FROM public.lessons WHERE course_id = _course_id
    GROUP BY "position" HAVING count(*) > 1
  ) THEN
    _b := _b || jsonb_build_object('code','duplicate_lesson_position');
  END IF;

  IF _lesson_count >= 1 AND NOT EXISTS (
    SELECT 1 FROM public.lessons WHERE course_id = _course_id AND is_preview = true
  ) THEN
    _b := _b || jsonb_build_object('code','no_preview_lesson');
  END IF;

  RETURN QUERY SELECT (jsonb_array_length(_b) = 0), _b;
END; $fn$;

REVOKE ALL ON FUNCTION public.evaluate_course_readiness(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.evaluate_course_readiness(uuid) TO authenticated;