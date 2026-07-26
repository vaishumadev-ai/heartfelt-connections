-- P0C.1 — Corrections & QA Closure (forward-only)
-- Marker: "P0C.1 Corrections"

-- 1) Authoritative readiness contract (structured jsonb blockers).
DROP FUNCTION IF EXISTS public.evaluate_course_readiness(uuid);

CREATE OR REPLACE FUNCTION public.evaluate_course_readiness(_course_id uuid)
RETURNS TABLE(is_ready boolean, blockers jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
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
  IF _r.certificate = true THEN
    _b := _b || jsonb_build_object('code','certificate_unavailable');
  END IF;

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
END; $$;

REVOKE ALL ON FUNCTION public.evaluate_course_readiness(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.evaluate_course_readiness(uuid) TO authenticated;

-- 2) Submission enforcement.
CREATE OR REPLACE FUNCTION public.submit_course_for_review(_course_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _owner uuid;
  _status public.course_review_status;
  _ready boolean;
  _blockers jsonb;
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

  SELECT r.is_ready, r.blockers INTO _ready, _blockers
    FROM public.evaluate_course_readiness(_course_id) r;
  IF NOT _ready THEN
    RAISE EXCEPTION 'course_not_ready'
      USING ERRCODE = 'P0001', DETAIL = _blockers::text;
  END IF;

  UPDATE public.courses
    SET review_status = 'pending_review',
        submitted_at = now(),
        review_decision_reason = NULL
    WHERE id = _course_id;

  INSERT INTO public.audit_events (event_type, actor_id, subject_id, target_kind, target_id)
  VALUES ('course_submitted_for_review', _uid, _uid, 'course', _course_id);
END; $$;

REVOKE ALL ON FUNCTION public.submit_course_for_review(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_course_for_review(uuid) TO authenticated;

-- 3) Media limits: single supported allowlist.
UPDATE public.media_config
   SET allowed_mime_types = ARRAY['video/mp4','video/webm']::text[],
       updated_at = now()
 WHERE bucket = 'course-videos';

UPDATE public.media_config
   SET allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp']::text[],
       file_size_limit = 5242880,
       updated_at = now()
 WHERE bucket = 'course-covers';

-- 4) Storage INSERT policies enforce size + MIME from media_config.
DROP POLICY IF EXISTS covers_insert_own_editable_course ON storage.objects;
CREATE POLICY covers_insert_own_editable_course
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'course-covers'
    AND owner = auth.uid()
    AND public._object_course_id(name) IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.courses c
      WHERE c.id = public._object_course_id(name)
        AND c.instructor_id = auth.uid()
        AND public.course_is_editable(c.id)
    )
    AND (metadata->>'size')::bigint <=
        (SELECT file_size_limit FROM public.media_config WHERE bucket = 'course-covers')
    AND (metadata->>'mimetype') IN (
      SELECT unnest(allowed_mime_types) FROM public.media_config WHERE bucket = 'course-covers'
    )
  );

DROP POLICY IF EXISTS videos_insert_own_editable_course ON storage.objects;
CREATE POLICY videos_insert_own_editable_course
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'course-videos'
    AND owner = auth.uid()
    AND public._object_course_id(name) IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.courses c
      WHERE c.id = public._object_course_id(name)
        AND c.instructor_id = auth.uid()
        AND public.course_is_editable(c.id)
    )
    AND (metadata->>'size')::bigint <=
        (SELECT file_size_limit FROM public.media_config WHERE bucket = 'course-videos')
    AND (metadata->>'mimetype') IN (
      SELECT unnest(allowed_mime_types) FROM public.media_config WHERE bucket = 'course-videos'
    )
  );

-- 5) Anonymous lesson-column closure.
REVOKE SELECT ON public.lessons FROM anon;
GRANT SELECT (
  id, course_id, "position", title, duration_seconds, is_preview, module_title
) ON public.lessons TO anon;

-- 6) Reorder overflow safety.
CREATE OR REPLACE FUNCTION public.reorder_lessons(_course_id uuid, _lesson_ids uuid[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _instructor uuid;
  _existing_count int;
  _input_count int := coalesce(array_length(_lesson_ids, 1), 0);
  _distinct_count int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000'; END IF;
  IF _lesson_ids IS NULL THEN
    RAISE EXCEPTION 'Lesson ids required' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(_lesson_ids) x WHERE x IS NULL) THEN
    RAISE EXCEPTION 'Null lesson id' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('mozok.course_lessons:' || _course_id::text));

  SELECT instructor_id INTO _instructor
    FROM public.courses WHERE id = _course_id FOR UPDATE;
  IF _instructor IS NULL THEN RAISE EXCEPTION 'Course not found' USING ERRCODE = '42704'; END IF;
  IF _instructor <> _uid THEN RAISE EXCEPTION 'Not your course'  USING ERRCODE = '42501'; END IF;
  IF NOT public.course_is_editable(_course_id) THEN
    RAISE EXCEPTION 'Course not editable' USING ERRCODE = '42501';
  END IF;

  SELECT count(DISTINCT x) INTO _distinct_count FROM unnest(_lesson_ids) x;
  IF _distinct_count <> _input_count THEN
    RAISE EXCEPTION 'Duplicate lesson ids' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO _existing_count
    FROM public.lessons WHERE course_id = _course_id;
  IF _existing_count <> _input_count THEN
    RAISE EXCEPTION 'Lesson set mismatch' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(_lesson_ids) x
     WHERE NOT EXISTS (
       SELECT 1 FROM public.lessons l WHERE l.id = x AND l.course_id = _course_id
     )
  ) THEN
    RAISE EXCEPTION 'Lesson set mismatch' USING ERRCODE = '22023';
  END IF;

  SET CONSTRAINTS lessons_course_position_uniq DEFERRED;

  UPDATE public.lessons AS l
     SET "position" = ord.new_pos
    FROM (
      SELECT u.id, u.ord::int AS new_pos
        FROM unnest(_lesson_ids) WITH ORDINALITY AS u(id, ord)
    ) AS ord
   WHERE l.id = ord.id AND l.course_id = _course_id;

  SET CONSTRAINTS lessons_course_position_uniq IMMEDIATE;
END; $$;

REVOKE ALL ON FUNCTION public.reorder_lessons(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reorder_lessons(uuid, uuid[]) TO authenticated;

-- 7) Helper/trigger function EXECUTE closure.
REVOKE ALL ON FUNCTION public.lock_course_for_lesson_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_course_governance() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_final_admin() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_course_content_lock() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_lesson_content_lock() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_course_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_lesson_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_on_enrollment() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._learner_entitled(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
