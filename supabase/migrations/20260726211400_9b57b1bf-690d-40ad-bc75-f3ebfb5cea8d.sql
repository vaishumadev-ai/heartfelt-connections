REVOKE INSERT (video_url), UPDATE (video_url) ON public.lessons FROM authenticated;

DROP FUNCTION IF EXISTS public.attach_lesson_video(uuid, text);
DROP FUNCTION IF EXISTS public.detach_lesson_video(uuid);

CREATE OR REPLACE FUNCTION public.attach_lesson_video(_lesson_id uuid, _path text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  IF _old IS NOT NULL AND _old = _path THEN
    RETURN NULL;
  END IF;
  RETURN _old;
END; $function$;

CREATE OR REPLACE FUNCTION public.detach_lesson_video(_lesson_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  RETURN _old;
END; $function$;