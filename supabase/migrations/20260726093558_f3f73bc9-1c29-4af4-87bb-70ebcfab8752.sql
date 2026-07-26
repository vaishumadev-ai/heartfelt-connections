
-- =============================================================
-- P0C.1 — Media Foundation & Privilege Closure
-- Migration file: 20260726092947_p0c1_media_foundation.sql
-- =============================================================

-- ---------- 1) MEDIA-LIMITS CONFIG TABLE --------------------------
CREATE TABLE IF NOT EXISTS public.media_config (
  bucket text PRIMARY KEY,
  file_size_limit bigint NOT NULL,
  allowed_mime_types text[] NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.media_config TO authenticated;
GRANT ALL    ON public.media_config TO service_role;
ALTER TABLE public.media_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "media_config_read" ON public.media_config;
CREATE POLICY "media_config_read" ON public.media_config
FOR SELECT TO authenticated USING (true);

INSERT INTO public.media_config (bucket, file_size_limit, allowed_mime_types) VALUES
  ('course-covers', 5242880,  ARRAY['image/jpeg','image/png','image/webp']),
  ('course-videos', 52428800, ARRAY['video/mp4','video/webm','video/quicktime'])
ON CONFLICT (bucket) DO UPDATE
  SET file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types,
      updated_at         = now();

-- ---------- 2) MEDIA METADATA COLUMNS -----------------------------
ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS cover_storage_path text;
ALTER TABLE public.lessons
  ADD COLUMN IF NOT EXISTS video_storage_path text;

-- No authenticated INSERT/UPDATE grants on those columns.
REVOKE UPDATE (cover_url, certificate) ON public.courses FROM authenticated;

-- ---------- 3) PRIVILEGE CLOSURE ----------------------------------
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.relname
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND c.relname <> 'media_config'
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', t);
  END LOOP;
END $$;

-- Re-grant the minimum matching current RLS policies. Column INSERT/UPDATE
-- grants on courses.* and lessons.* remain intact.
GRANT SELECT ON public.courses                 TO anon, authenticated;
GRANT DELETE ON public.courses                 TO authenticated;
GRANT SELECT ON public.enrollments             TO authenticated;
GRANT SELECT ON public.instructor_applications TO authenticated;
GRANT SELECT ON public.lesson_bookmarks        TO authenticated;
GRANT SELECT ON public.lesson_completions      TO authenticated;
GRANT SELECT ON public.lesson_notes            TO authenticated;
GRANT SELECT ON public.lessons                 TO anon;
GRANT SELECT, DELETE ON public.lessons         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT SELECT ON public.profiles                TO anon, authenticated;
GRANT INSERT, UPDATE ON public.profiles        TO authenticated;
GRANT SELECT ON public.reviews                 TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.reviews TO authenticated;
GRANT SELECT ON public.user_roles              TO authenticated;
-- audit_events: no anon/authenticated grants.
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

-- ---------- 4) UNIQUE (course_id, position) -----------------------
ALTER TABLE public.lessons
  DROP CONSTRAINT IF EXISTS lessons_course_position_uniq;
ALTER TABLE public.lessons
  ADD  CONSTRAINT lessons_course_position_uniq UNIQUE (course_id, "position")
  DEFERRABLE INITIALLY IMMEDIATE;

-- ---------- 5) COURSE-SCOPED LESSON ADVISORY LOCK -----------------
CREATE OR REPLACE FUNCTION public.lock_course_for_lesson_mutation()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _cid uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    _cid := OLD.course_id;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.course_id IS DISTINCT FROM OLD.course_id THEN
      RAISE EXCEPTION 'Lesson cannot be reassigned to another course'
        USING ERRCODE = '42501';
    END IF;
    _cid := NEW.course_id;
  ELSE
    _cid := NEW.course_id;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('mozok.course_lessons:' || _cid::text));
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END; $$;

DROP TRIGGER IF EXISTS lessons_lock_course_before ON public.lessons;
CREATE TRIGGER lessons_lock_course_before
BEFORE INSERT OR UPDATE OR DELETE ON public.lessons
FOR EACH ROW EXECUTE FUNCTION public.lock_course_for_lesson_mutation();

-- ---------- 6) reorder_lessons RPC --------------------------------
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
       SELECT 1 FROM public.lessons l
        WHERE l.id = x AND l.course_id = _course_id
     )
  ) THEN
    RAISE EXCEPTION 'Lesson set mismatch' USING ERRCODE = '22023';
  END IF;

  UPDATE public.lessons
     SET "position" = "position" + 1000000
   WHERE course_id = _course_id;

  UPDATE public.lessons AS l
     SET "position" = ord.new_pos
    FROM (
      SELECT u.id, u.ord::int AS new_pos
        FROM unnest(_lesson_ids) WITH ORDINALITY AS u(id, ord)
    ) AS ord
   WHERE l.id = ord.id AND l.course_id = _course_id;
END; $$;
REVOKE ALL ON FUNCTION public.reorder_lessons(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reorder_lessons(uuid, uuid[]) TO authenticated;

-- ---------- 7) Media-limits contract ------------------------------
CREATE OR REPLACE FUNCTION public.get_media_limits()
RETURNS TABLE(bucket text, file_size_limit bigint, allowed_mime_types text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT bucket, file_size_limit, allowed_mime_types
    FROM public.media_config
   WHERE bucket IN ('course-covers','course-videos')
   ORDER BY bucket
$$;
REVOKE ALL ON FUNCTION public.get_media_limits() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_media_limits() TO authenticated;

-- ---------- 8) Storage-path helper --------------------------------
CREATE OR REPLACE FUNCTION public._object_course_id(_name text)
RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN _name ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[^/].*$'
      THEN substring(_name from '^([0-9a-fA-F-]{36})/')::uuid
    ELSE NULL
  END
$$;

-- ---------- 9) Cover attach / detach RPCs -------------------------
CREATE OR REPLACE FUNCTION public.attach_course_cover(_course_id uuid, _path text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _owner uuid; _size bigint; _mime text;
  _limit bigint; _mimes text[]; _old text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.courses WHERE id = _course_id AND instructor_id = _uid) THEN
    RAISE EXCEPTION 'Not your course' USING ERRCODE = '42501';
  END IF;
  IF NOT public.course_is_editable(_course_id) THEN
    RAISE EXCEPTION 'Course not editable' USING ERRCODE = '42501';
  END IF;
  IF public._object_course_id(_path) IS DISTINCT FROM _course_id THEN
    RAISE EXCEPTION 'Path does not belong to course' USING ERRCODE = '22023';
  END IF;
  SELECT o.owner, (o.metadata->>'size')::bigint, o.metadata->>'mimetype'
    INTO _owner, _size, _mime
    FROM storage.objects o
   WHERE o.bucket_id = 'course-covers' AND o.name = _path;
  IF _owner IS NULL THEN RAISE EXCEPTION 'Object missing' USING ERRCODE = '42704'; END IF;
  IF _owner <> _uid THEN RAISE EXCEPTION 'Not object owner' USING ERRCODE = '42501'; END IF;
  SELECT file_size_limit, allowed_mime_types INTO _limit, _mimes
    FROM public.media_config WHERE bucket = 'course-covers';
  IF _size IS NULL OR _size > _limit THEN
    RAISE EXCEPTION 'Cover exceeds size limit' USING ERRCODE = '22023';
  END IF;
  IF _mimes IS NOT NULL AND (_mime IS NULL OR NOT (_mime = ANY(_mimes))) THEN
    RAISE EXCEPTION 'Cover MIME not allowed' USING ERRCODE = '22023';
  END IF;
  SELECT cover_storage_path INTO _old FROM public.courses WHERE id = _course_id;
  UPDATE public.courses SET cover_storage_path = _path WHERE id = _course_id;
  IF _old IS NOT NULL AND _old <> _path THEN
    DELETE FROM storage.objects WHERE bucket_id = 'course-covers' AND name = _old;
  END IF;
END; $$;
REVOKE ALL ON FUNCTION public.attach_course_cover(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.attach_course_cover(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.detach_course_cover(_course_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid(); _old text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.courses WHERE id = _course_id AND instructor_id = _uid) THEN
    RAISE EXCEPTION 'Not your course' USING ERRCODE = '42501';
  END IF;
  IF NOT public.course_is_editable(_course_id) THEN
    RAISE EXCEPTION 'Course not editable' USING ERRCODE = '42501';
  END IF;
  SELECT cover_storage_path INTO _old FROM public.courses WHERE id = _course_id;
  UPDATE public.courses SET cover_storage_path = NULL WHERE id = _course_id;
  IF _old IS NOT NULL THEN
    DELETE FROM storage.objects WHERE bucket_id = 'course-covers' AND name = _old;
  END IF;
END; $$;
REVOKE ALL ON FUNCTION public.detach_course_cover(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.detach_course_cover(uuid) TO authenticated;

-- ---------- 10) Video attach / detach RPCs ------------------------
CREATE OR REPLACE FUNCTION public.attach_lesson_video(_lesson_id uuid, _path text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _cid uuid; _instructor uuid;
  _owner uuid; _size bigint; _mime text;
  _limit bigint; _mimes text[]; _old text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000'; END IF;
  SELECT l.course_id, c.instructor_id INTO _cid, _instructor
    FROM public.lessons l JOIN public.courses c ON c.id = l.course_id
   WHERE l.id = _lesson_id;
  IF _cid IS NULL THEN RAISE EXCEPTION 'Lesson not found' USING ERRCODE = '42704'; END IF;
  IF _instructor <> _uid THEN RAISE EXCEPTION 'Not your course' USING ERRCODE = '42501'; END IF;
  IF NOT public.course_is_editable(_cid) THEN
    RAISE EXCEPTION 'Course not editable' USING ERRCODE = '42501';
  END IF;
  IF public._object_course_id(_path) IS DISTINCT FROM _cid THEN
    RAISE EXCEPTION 'Path does not belong to course' USING ERRCODE = '22023';
  END IF;
  SELECT o.owner, (o.metadata->>'size')::bigint, o.metadata->>'mimetype'
    INTO _owner, _size, _mime
    FROM storage.objects o
   WHERE o.bucket_id = 'course-videos' AND o.name = _path;
  IF _owner IS NULL THEN RAISE EXCEPTION 'Object missing' USING ERRCODE = '42704'; END IF;
  IF _owner <> _uid THEN RAISE EXCEPTION 'Not object owner' USING ERRCODE = '42501'; END IF;
  SELECT file_size_limit, allowed_mime_types INTO _limit, _mimes
    FROM public.media_config WHERE bucket = 'course-videos';
  IF _size IS NULL OR _size > _limit THEN
    RAISE EXCEPTION 'Video exceeds size limit' USING ERRCODE = '22023';
  END IF;
  IF _mimes IS NOT NULL AND (_mime IS NULL OR NOT (_mime = ANY(_mimes))) THEN
    RAISE EXCEPTION 'Video MIME not allowed' USING ERRCODE = '22023';
  END IF;
  SELECT video_storage_path INTO _old FROM public.lessons WHERE id = _lesson_id;
  UPDATE public.lessons SET video_storage_path = _path WHERE id = _lesson_id;
  IF _old IS NOT NULL AND _old <> _path THEN
    DELETE FROM storage.objects WHERE bucket_id = 'course-videos' AND name = _old;
  END IF;
END; $$;
REVOKE ALL ON FUNCTION public.attach_lesson_video(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.attach_lesson_video(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.detach_lesson_video(_lesson_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid(); _cid uuid; _old text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000'; END IF;
  SELECT l.course_id INTO _cid
    FROM public.lessons l JOIN public.courses c ON c.id = l.course_id
   WHERE l.id = _lesson_id AND c.instructor_id = _uid;
  IF _cid IS NULL THEN RAISE EXCEPTION 'Not your lesson' USING ERRCODE = '42501'; END IF;
  IF NOT public.course_is_editable(_cid) THEN
    RAISE EXCEPTION 'Course not editable' USING ERRCODE = '42501';
  END IF;
  SELECT video_storage_path INTO _old FROM public.lessons WHERE id = _lesson_id;
  UPDATE public.lessons SET video_storage_path = NULL WHERE id = _lesson_id;
  IF _old IS NOT NULL THEN
    DELETE FROM storage.objects WHERE bucket_id = 'course-videos' AND name = _old;
  END IF;
END; $$;
REVOKE ALL ON FUNCTION public.detach_lesson_video(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.detach_lesson_video(uuid) TO authenticated;

-- ---------- 11) evaluate_course_readiness -------------------------
CREATE OR REPLACE FUNCTION public.evaluate_course_readiness(_course_id uuid)
RETURNS TABLE(is_ready boolean, blockers text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _r public.courses%ROWTYPE;
  _b text[] := ARRAY[]::text[];
  _lesson_count int;
  _missing_video int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000'; END IF;
  SELECT * INTO _r FROM public.courses WHERE id = _course_id;
  IF _r.id IS NULL THEN RAISE EXCEPTION 'Course not found' USING ERRCODE = '42704'; END IF;
  IF _r.instructor_id <> _uid AND NOT public.has_role(_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF coalesce(btrim(_r.title), '') = '' OR length(btrim(_r.title)) < 6 THEN
    _b := _b || 'title_too_short';
  END IF;
  IF coalesce(btrim(_r.description), '') = '' OR length(btrim(_r.description)) < 40 THEN
    _b := _b || 'description_too_short';
  END IF;
  IF coalesce(btrim(_r.category), '') = '' THEN
    _b := _b || 'category_missing';
  END IF;
  IF _r.cover_storage_path IS NULL
     OR NOT EXISTS (SELECT 1 FROM storage.objects
                     WHERE bucket_id = 'course-covers' AND name = _r.cover_storage_path) THEN
    _b := _b || 'cover_missing';
  END IF;
  SELECT count(*) INTO _lesson_count FROM public.lessons WHERE course_id = _course_id;
  IF _lesson_count < 1 THEN
    _b := _b || 'no_lessons';
  END IF;
  SELECT count(*) INTO _missing_video
    FROM public.lessons l
   WHERE l.course_id = _course_id
     AND (l.video_storage_path IS NULL
          OR NOT EXISTS (SELECT 1 FROM storage.objects
                          WHERE bucket_id = 'course-videos' AND name = l.video_storage_path));
  IF _missing_video > 0 THEN
    _b := _b || 'lessons_missing_video';
  END IF;
  RETURN QUERY SELECT (coalesce(array_length(_b, 1), 0) = 0), _b;
END; $$;
REVOKE ALL ON FUNCTION public.evaluate_course_readiness(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.evaluate_course_readiness(uuid) TO authenticated;

-- ---------- 12) STORAGE.OBJECTS RLS POLICIES ----------------------
DROP POLICY IF EXISTS "covers_insert_own_editable_course" ON storage.objects;
CREATE POLICY "covers_insert_own_editable_course" ON storage.objects
FOR INSERT TO authenticated
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
);

DROP POLICY IF EXISTS "covers_read_owner_or_published" ON storage.objects;
CREATE POLICY "covers_read_owner_or_published" ON storage.objects
FOR SELECT TO anon, authenticated
USING (
  bucket_id = 'course-covers'
  AND EXISTS (
    SELECT 1 FROM public.courses c
     WHERE c.id = public._object_course_id(name)
       AND (c.is_published = true OR c.instructor_id = auth.uid())
  )
);

DROP POLICY IF EXISTS "covers_delete_own_unattached" ON storage.objects;
CREATE POLICY "covers_delete_own_unattached" ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'course-covers'
  AND owner = auth.uid()
  AND public._object_course_id(name) IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.courses c
     WHERE c.id = public._object_course_id(name)
       AND c.instructor_id = auth.uid()
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.courses c
     WHERE c.cover_storage_path = storage.objects.name
  )
);

DROP POLICY IF EXISTS "videos_insert_own_editable_course" ON storage.objects;
CREATE POLICY "videos_insert_own_editable_course" ON storage.objects
FOR INSERT TO authenticated
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
);

DROP POLICY IF EXISTS "videos_read_entitled" ON storage.objects;
CREATE POLICY "videos_read_entitled" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'course-videos'
  AND (
    EXISTS (
      SELECT 1 FROM public.courses c
       WHERE c.id = public._object_course_id(name)
         AND c.instructor_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.enrollments e
        JOIN public.courses c ON c.id = e.course_id
        JOIN public.lessons  l ON l.course_id = c.id
       WHERE e.user_id = auth.uid()
         AND c.is_published = true
         AND c.price_cents = 0
         AND l.video_storage_path = storage.objects.name
    )
  )
);

DROP POLICY IF EXISTS "videos_delete_own_unattached" ON storage.objects;
CREATE POLICY "videos_delete_own_unattached" ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'course-videos'
  AND owner = auth.uid()
  AND public._object_course_id(name) IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.courses c
     WHERE c.id = public._object_course_id(name)
       AND c.instructor_id = auth.uid()
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.lessons l
     WHERE l.video_storage_path = storage.objects.name
  )
);
