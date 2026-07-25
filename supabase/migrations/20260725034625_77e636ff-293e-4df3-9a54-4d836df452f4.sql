CREATE TABLE public.lesson_completions (
  id uuid not null default gen_random_uuid() primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  completed_at timestamptz not null default now(),
  unique(user_id, lesson_id)
);
GRANT SELECT, INSERT, DELETE ON public.lesson_completions TO authenticated;
GRANT ALL ON public.lesson_completions TO service_role;
ALTER TABLE public.lesson_completions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own completions" ON public.lesson_completions FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX lesson_completions_user_course_idx ON public.lesson_completions(user_id, course_id);

-- Seed richer lessons for existing courses so the player has content
INSERT INTO public.lessons (course_id, position, title, duration_seconds, content)
SELECT c.id, gs.n, 'Lesson ' || gs.n || ': ' || c.title || ' — Part ' || gs.n,
  300 + (gs.n * 60),
  'Welcome to lesson ' || gs.n || ' of ' || c.title || E'.\n\nIn this lesson you will explore the key concepts and practice with hands-on examples. Take your time, and mark the lesson complete when you feel confident with the material.'
FROM public.courses c
CROSS JOIN generate_series(1, 5) AS gs(n)
WHERE NOT EXISTS (SELECT 1 FROM public.lessons l WHERE l.course_id = c.id);