
-- ---------- Fix column grants inadvertently removed by REVOKE ALL --

-- courses: column-scoped INSERT/UPDATE for authenticated (excluding
-- cover_url / certificate / cover_storage_path).
GRANT INSERT (instructor_id, slug, title, category, price_cents) ON public.courses TO authenticated;
GRANT UPDATE (
  audience, category, description, duration_label, faq, icon_kind,
  instructor_bio, instructor_name, instructor_title, language,
  learn_outcomes, level, price_cents, requirements, skills, subtitle, title
) ON public.courses TO authenticated;

-- lessons: signed-in INSERT/UPDATE (excluding video_storage_path).
GRANT INSERT (
  course_id, content, duration_seconds, is_preview, module_title,
  "position", title, video_url
) ON public.lessons TO authenticated;
GRANT UPDATE (
  content, duration_seconds, is_preview, module_title,
  "position", title, video_url
) ON public.lessons TO authenticated;

-- lessons: anonymous preview column reads.
GRANT SELECT (
  id, course_id, "position", title, duration_seconds,
  is_preview, module_title, created_at
) ON public.lessons TO anon;

-- media_config: lock down anon; authenticated keeps SELECT via RLS + table grant.
REVOKE ALL ON public.media_config FROM PUBLIC;
REVOKE ALL ON public.media_config FROM anon;
REVOKE ALL ON public.media_config FROM authenticated;
GRANT SELECT ON public.media_config TO authenticated;
GRANT ALL    ON public.media_config TO service_role;
