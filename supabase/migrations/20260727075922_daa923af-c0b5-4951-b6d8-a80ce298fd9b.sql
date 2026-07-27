
CREATE OR REPLACE FUNCTION public.approve_course(_course_id uuid, _reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _owner uuid;
  _status public.course_review_status;
  _slug text;
  _title text;
  _ready boolean;
  _blockers jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000'; END IF;
  IF NOT public.current_user_has_role('admin') THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = '42501';
  END IF;

  SELECT instructor_id, review_status, slug, title
    INTO _owner, _status, _slug, _title
    FROM public.courses WHERE id = _course_id FOR UPDATE;
  IF _owner IS NULL THEN RAISE EXCEPTION 'Course not found' USING ERRCODE = '42704'; END IF;
  IF _status <> 'pending_review' THEN
    RAISE EXCEPTION 'Course not pending review' USING ERRCODE = '22023';
  END IF;

  -- Transactional readiness recheck: never approve a course that no longer meets requirements.
  SELECT r.is_ready, r.blockers INTO _ready, _blockers
    FROM public.evaluate_course_readiness(_course_id) r;
  IF NOT _ready THEN
    RAISE EXCEPTION 'course_not_ready'
      USING ERRCODE = 'P0001', DETAIL = _blockers::text;
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

  INSERT INTO public.notifications (user_id, title, body, link)
  VALUES (
    _owner,
    'Your course was approved',
    COALESCE('"' || _title || '" is now published.' ||
      CASE WHEN NULLIF(trim(coalesce(_reason,'')),'') IS NOT NULL
        THEN ' Note from admin: ' || trim(_reason)
        ELSE '' END, 'Your course is now published.'),
    '/courses/' || _slug
  );
END; $function$;

CREATE OR REPLACE FUNCTION public.reject_course(_course_id uuid, _reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _owner uuid;
  _status public.course_review_status;
  _title text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000'; END IF;
  IF NOT public.current_user_has_role('admin') THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = '42501';
  END IF;
  IF _reason IS NULL OR trim(_reason) = '' THEN
    RAISE EXCEPTION 'Reason required' USING ERRCODE = '22023';
  END IF;

  SELECT instructor_id, review_status, title INTO _owner, _status, _title
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

  INSERT INTO public.notifications (user_id, title, body, link)
  VALUES (
    _owner,
    'Your course needs changes',
    COALESCE('"' || _title || '" was not approved. Reason: ' || trim(_reason),
             'Your course was not approved. Reason: ' || trim(_reason)),
    '/studio/' || _course_id::text
  );
END; $function$;
