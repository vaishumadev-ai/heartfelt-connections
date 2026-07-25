
CREATE OR REPLACE FUNCTION public.set_last_lesson(_course_id uuid, _lesson_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  -- Single guarded UPDATE. The predicate joins enrollments, courses and
  -- lessons so any of the following causes zero rows and a fail-closed
  -- exception: unpublished course, paid course, no enrollment, lesson
  -- from another course, or nonexistent lesson.
  UPDATE public.enrollments e
     SET last_lesson_id = _lesson_id
   WHERE e.user_id = _uid
     AND e.course_id = _course_id
     AND EXISTS (
       SELECT 1 FROM public.courses c
       WHERE c.id = _course_id
         AND c.is_published = true
         AND c.price_cents = 0
     )
     AND EXISTS (
       SELECT 1 FROM public.lessons l
       WHERE l.id = _lesson_id
         AND l.course_id = _course_id
     );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not entitled to update last lesson' USING ERRCODE = '42501';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_last_lesson(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_last_lesson(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_last_lesson(uuid, uuid) TO authenticated;
