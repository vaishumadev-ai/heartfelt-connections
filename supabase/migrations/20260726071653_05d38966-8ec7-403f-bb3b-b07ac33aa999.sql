
-- 1) Add FK from instructor_applications.user_id to auth.users (safe: 0 rows)
ALTER TABLE public.instructor_applications
  ADD CONSTRAINT instructor_applications_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- 2) Admin-only reader RPC
CREATE OR REPLACE FUNCTION public.list_instructor_applications_admin(
  _status public.instructor_application_status DEFAULT NULL,
  _limit  integer DEFAULT 50,
  _offset integer DEFAULT 0
)
RETURNS TABLE(
  application_id       uuid,
  user_id              uuid,
  display_name         text,
  avatar_url           text,
  status               public.instructor_application_status,
  application_reason   text,
  decision_reason      text,
  decided_by           uuid,
  decided_at           timestamptz,
  created_at           timestamptz,
  updated_at           timestamptz,
  is_current_instructor boolean,
  total_count          bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _lim int := LEAST(GREATEST(COALESCE(_limit, 50), 1), 100);
  _off int := GREATEST(COALESCE(_offset, 0), 0);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH filtered AS (
    SELECT ia.*
    FROM public.instructor_applications ia
    WHERE (_status IS NULL OR ia.status = _status)
  ),
  counted AS (
    SELECT (SELECT count(*) FROM filtered) AS total
  )
  SELECT
    f.id            AS application_id,
    f.user_id       AS user_id,
    p.display_name  AS display_name,
    p.avatar_url    AS avatar_url,
    f.status        AS status,
    f.application_reason AS application_reason,
    f.decision_reason    AS decision_reason,
    f.decided_by         AS decided_by,
    f.decided_at         AS decided_at,
    f.created_at         AS created_at,
    f.updated_at         AS updated_at,
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = f.user_id AND ur.role = 'instructor'::public.app_role
    ) AS is_current_instructor,
    (SELECT total FROM counted) AS total_count
  FROM filtered f
  LEFT JOIN public.profiles p ON p.id = f.user_id
  ORDER BY
    CASE WHEN f.status = 'pending'::public.instructor_application_status THEN 0 ELSE 1 END ASC,
    CASE WHEN f.status = 'pending'::public.instructor_application_status THEN f.created_at END ASC NULLS LAST,
    CASE WHEN f.status <> 'pending'::public.instructor_application_status THEN f.decided_at END DESC NULLS LAST,
    f.id ASC
  LIMIT _lim OFFSET _off;
END;
$$;

REVOKE ALL ON FUNCTION public.list_instructor_applications_admin(
  public.instructor_application_status, integer, integer
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.list_instructor_applications_admin(
  public.instructor_application_status, integer, integer
) TO authenticated;
