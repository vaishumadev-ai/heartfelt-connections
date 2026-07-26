
-- =========================================================================
-- Phase 3: Learner Home foundation
-- =========================================================================

-- ---------- 1. enrollments.last_activity_at (safe order) -----------------
ALTER TABLE public.enrollments
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz;

UPDATE public.enrollments
  SET last_activity_at = enrolled_at
  WHERE last_activity_at IS NULL;

ALTER TABLE public.enrollments
  ALTER COLUMN last_activity_at SET DEFAULT now();

ALTER TABLE public.enrollments
  ALTER COLUMN last_activity_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS enrollments_user_activity_idx
  ON public.enrollments (user_id, last_activity_at DESC, id);

-- ---------- 2. lesson_notes ---------------------------------------------
CREATE TABLE IF NOT EXISTS public.lesson_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  lesson_id uuid NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, lesson_id),
  CONSTRAINT lesson_notes_body_len_chk
    CHECK (char_length(body) <= 4000 AND char_length(btrim(body)) > 0)
);

-- No direct table grants to authenticated: writes only through RPCs.
GRANT SELECT ON public.lesson_notes TO authenticated;
GRANT ALL ON public.lesson_notes TO service_role;
REVOKE INSERT, UPDATE, DELETE ON public.lesson_notes FROM authenticated;
REVOKE ALL ON public.lesson_notes FROM anon, PUBLIC;

ALTER TABLE public.lesson_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners read own notes"
  ON public.lesson_notes
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS lesson_notes_user_updated_idx
  ON public.lesson_notes (user_id, updated_at DESC, id);

CREATE INDEX IF NOT EXISTS lesson_notes_lesson_idx
  ON public.lesson_notes (lesson_id);

CREATE TRIGGER lesson_notes_set_updated_at
  BEFORE UPDATE ON public.lesson_notes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- 3. lesson_bookmarks -----------------------------------------
CREATE TABLE IF NOT EXISTS public.lesson_bookmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  lesson_id uuid NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, lesson_id)
);

GRANT SELECT ON public.lesson_bookmarks TO authenticated;
GRANT ALL ON public.lesson_bookmarks TO service_role;
REVOKE INSERT, UPDATE, DELETE ON public.lesson_bookmarks FROM authenticated;
REVOKE ALL ON public.lesson_bookmarks FROM anon, PUBLIC;

ALTER TABLE public.lesson_bookmarks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners read own bookmarks"
  ON public.lesson_bookmarks
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS lesson_bookmarks_user_created_idx
  ON public.lesson_bookmarks (user_id, created_at DESC, id);

CREATE INDEX IF NOT EXISTS lesson_bookmarks_lesson_idx
  ON public.lesson_bookmarks (lesson_id);

-- ---------- 4. shared entitlement helper --------------------------------
CREATE OR REPLACE FUNCTION public._learner_entitled(_user uuid, _course uuid, _lesson uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.enrollments e
    JOIN public.courses c ON c.id = e.course_id
    JOIN public.lessons l ON l.course_id = c.id
    WHERE e.user_id = _user
      AND e.course_id = _course
      AND l.id = _lesson
      AND l.course_id = _course
      AND c.is_published = true
      AND c.price_cents = 0
  )
$$;

REVOKE ALL ON FUNCTION public._learner_entitled(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._learner_entitled(uuid, uuid, uuid) TO authenticated, service_role;

-- ---------- 5. RPC: save_lesson_note ------------------------------------
CREATE OR REPLACE FUNCTION public.save_lesson_note(_course_id uuid, _lesson_id uuid, _body text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid(); _b text := coalesce(_body, ''); _id uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000'; END IF;
  IF char_length(btrim(_b)) = 0 OR char_length(_b) > 4000 THEN
    RAISE EXCEPTION 'Invalid note body' USING ERRCODE = '22023';
  END IF;
  IF NOT public._learner_entitled(_uid, _course_id, _lesson_id) THEN
    RAISE EXCEPTION 'Not entitled' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.lesson_notes (user_id, course_id, lesson_id, body)
  VALUES (_uid, _course_id, _lesson_id, _b)
  ON CONFLICT (user_id, lesson_id)
    DO UPDATE SET body = EXCLUDED.body, updated_at = now()
  RETURNING id INTO _id;

  UPDATE public.enrollments SET last_activity_at = now()
    WHERE user_id = _uid AND course_id = _course_id;
  RETURN _id;
END; $$;

REVOKE ALL ON FUNCTION public.save_lesson_note(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_lesson_note(uuid, uuid, text) TO authenticated, service_role;

-- ---------- 6. RPC: delete_lesson_note ----------------------------------
CREATE OR REPLACE FUNCTION public.delete_lesson_note(_lesson_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000'; END IF;
  DELETE FROM public.lesson_notes WHERE user_id = _uid AND lesson_id = _lesson_id;
END; $$;

REVOKE ALL ON FUNCTION public.delete_lesson_note(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_lesson_note(uuid) TO authenticated, service_role;

-- ---------- 7. RPC: add_lesson_bookmark ---------------------------------
CREATE OR REPLACE FUNCTION public.add_lesson_bookmark(_course_id uuid, _lesson_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid(); _id uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000'; END IF;
  IF NOT public._learner_entitled(_uid, _course_id, _lesson_id) THEN
    RAISE EXCEPTION 'Not entitled' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.lesson_bookmarks (user_id, course_id, lesson_id)
  VALUES (_uid, _course_id, _lesson_id)
  ON CONFLICT (user_id, lesson_id) DO UPDATE SET created_at = public.lesson_bookmarks.created_at
  RETURNING id INTO _id;

  UPDATE public.enrollments SET last_activity_at = now()
    WHERE user_id = _uid AND course_id = _course_id;
  RETURN _id;
END; $$;

REVOKE ALL ON FUNCTION public.add_lesson_bookmark(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_lesson_bookmark(uuid, uuid) TO authenticated, service_role;

-- ---------- 8. RPC: remove_lesson_bookmark ------------------------------
CREATE OR REPLACE FUNCTION public.remove_lesson_bookmark(_lesson_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000'; END IF;
  DELETE FROM public.lesson_bookmarks WHERE user_id = _uid AND lesson_id = _lesson_id;
END; $$;

REVOKE ALL ON FUNCTION public.remove_lesson_bookmark(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_lesson_bookmark(uuid) TO authenticated, service_role;

-- ---------- 9. Patch existing activity-producing RPCs -------------------
CREATE OR REPLACE FUNCTION public.enroll_free_course(_course_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
  INSERT INTO public.enrollments (user_id, course_id, last_activity_at)
    VALUES (_uid, _course_id, now())
    RETURNING id INTO _new_id;
  RETURN _new_id;
END; $$;

CREATE OR REPLACE FUNCTION public.set_last_lesson(_course_id uuid, _lesson_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  UPDATE public.enrollments e
     SET last_lesson_id = _lesson_id,
         last_activity_at = now()
   WHERE e.user_id = _uid
     AND e.course_id = _course_id
     AND EXISTS (
       SELECT 1 FROM public.courses c
       WHERE c.id = _course_id AND c.is_published = true AND c.price_cents = 0
     )
     AND EXISTS (
       SELECT 1 FROM public.lessons l
       WHERE l.id = _lesson_id AND l.course_id = _course_id
     );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not entitled to update last lesson' USING ERRCODE = '42501';
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.complete_lesson(_course_id uuid, _lesson_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
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
  SELECT EXISTS(SELECT 1 FROM public.lessons l
    WHERE l.id = _lesson_id AND l.course_id = _course_id) INTO _lesson_ok;
  IF NOT _lesson_ok THEN
    RAISE EXCEPTION 'Lesson does not belong to course' USING ERRCODE = '42501';
  END IF;
  SELECT EXISTS(SELECT 1 FROM public.enrollments e
    WHERE e.user_id = _uid AND e.course_id = _course_id) INTO _enrolled;
  IF NOT _enrolled THEN
    RAISE EXCEPTION 'Enrollment required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.lesson_completions (user_id, course_id, lesson_id)
  VALUES (_uid, _course_id, _lesson_id)
  ON CONFLICT (user_id, lesson_id) DO NOTHING;

  SELECT COUNT(*) INTO _total FROM public.lessons WHERE course_id = _course_id;
  SELECT COUNT(*) INTO _done
    FROM public.lesson_completions lc
    JOIN public.lessons l ON l.id = lc.lesson_id AND l.course_id = lc.course_id
    WHERE lc.course_id = _course_id AND lc.user_id = _uid;

  _progress := CASE WHEN _total > 0 THEN ROUND((_done::numeric / _total) * 100)::int ELSE 0 END;
  IF _progress > 100 THEN _progress := 100; END IF;
  IF _progress < 0 THEN _progress := 0; END IF;

  UPDATE public.enrollments
    SET progress = _progress,
        last_lesson_id = _lesson_id,
        last_activity_at = now()
    WHERE user_id = _uid AND course_id = _course_id;

  RETURN _progress;
END; $$;

-- ---------- 10. RPC: get_learner_dashboard ------------------------------
-- Returns a single JSON payload with continue/library preview counts,
-- recent notes and recent bookmarks (both filtered to active free-published
-- entitlements). All IDs owner-scoped.
CREATE OR REPLACE FUNCTION public.get_learner_dashboard(_limit int DEFAULT 24)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _lim int := LEAST(GREATEST(coalesce(_limit, 24), 1), 50);
  _enrollments jsonb;
  _has_more boolean;
  _rows int;
  _notes jsonb;
  _bookmarks jsonb;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  WITH e AS (
    SELECT en.id, en.course_id, en.progress, en.last_lesson_id,
           en.last_activity_at,
           row_to_json(c) AS course
    FROM public.enrollments en
    JOIN public.courses c ON c.id = en.course_id
    WHERE en.user_id = _uid
      AND c.is_published = true
      AND c.price_cents = 0
    ORDER BY en.last_activity_at DESC, en.id
    LIMIT _lim + 1
  )
  SELECT jsonb_agg(to_jsonb(e.*)), count(*) INTO _enrollments, _rows FROM e;

  _has_more := coalesce(_rows, 0) > _lim;
  IF _has_more THEN
    _enrollments := (SELECT jsonb_agg(x) FROM (
      SELECT * FROM jsonb_array_elements(_enrollments) WITH ORDINALITY t(x, ord)
      ORDER BY ord LIMIT _lim
    ) s);
  END IF;

  SELECT jsonb_agg(to_jsonb(n) ORDER BY n.updated_at DESC, n.id)
    INTO _notes
    FROM (
      SELECT ln.id, ln.course_id, ln.lesson_id, ln.body, ln.updated_at, ln.created_at
      FROM public.lesson_notes ln
      JOIN public.courses c ON c.id = ln.course_id
      JOIN public.enrollments en ON en.course_id = ln.course_id AND en.user_id = _uid
      WHERE ln.user_id = _uid
        AND c.is_published = true
        AND c.price_cents = 0
      ORDER BY ln.updated_at DESC, ln.id
      LIMIT 10
    ) n;

  SELECT jsonb_agg(to_jsonb(b) ORDER BY b.created_at DESC, b.id)
    INTO _bookmarks
    FROM (
      SELECT lb.id, lb.course_id, lb.lesson_id, lb.created_at
      FROM public.lesson_bookmarks lb
      JOIN public.courses c ON c.id = lb.course_id
      JOIN public.enrollments en ON en.course_id = lb.course_id AND en.user_id = _uid
      WHERE lb.user_id = _uid
        AND c.is_published = true
        AND c.price_cents = 0
      ORDER BY lb.created_at DESC, lb.id
      LIMIT 10
    ) b;

  RETURN jsonb_build_object(
    'enrollments', coalesce(_enrollments, '[]'::jsonb),
    'libraryHasMore', _has_more,
    'notes', coalesce(_notes, '[]'::jsonb),
    'bookmarks', coalesce(_bookmarks, '[]'::jsonb)
  );
END; $$;

REVOKE ALL ON FUNCTION public.get_learner_dashboard(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_learner_dashboard(int) TO authenticated, service_role;
