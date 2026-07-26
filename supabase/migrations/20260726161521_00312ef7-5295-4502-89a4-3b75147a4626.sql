DROP FUNCTION IF EXISTS public.attach_course_cover(uuid, text);
DROP FUNCTION IF EXISTS public.detach_course_cover(uuid);

CREATE OR REPLACE FUNCTION public.attach_course_cover(_course_id uuid, _path text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  IF _old IS NOT NULL AND _old = _path THEN
    RETURN NULL;
  END IF;
  RETURN _old;
END; $function$;

CREATE OR REPLACE FUNCTION public.detach_course_cover(_course_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  RETURN _old;
END; $function$;

REVOKE ALL ON FUNCTION public.attach_course_cover(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.attach_course_cover(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.detach_course_cover(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.detach_course_cover(uuid) TO authenticated;