
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_created_idx ON public.notifications(user_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own notifications" ON public.notifications FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Seed a welcome notification for every existing user
INSERT INTO public.notifications (user_id, title, body, link)
SELECT id, 'Welcome to Mozok', 'Explore courses and start learning today.', '/browse' FROM auth.users;

-- Auto-notify on enrollment
CREATE OR REPLACE FUNCTION public.notify_on_enrollment()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c_title TEXT; c_slug TEXT;
BEGIN
  SELECT title, slug INTO c_title, c_slug FROM public.courses WHERE id = NEW.course_id;
  INSERT INTO public.notifications (user_id, title, body, link)
  VALUES (NEW.user_id, 'Enrolled: ' || COALESCE(c_title,'course'), 'You can start learning now.', '/learn/' || COALESCE(c_slug,''));
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_notify_enrollment ON public.enrollments;
CREATE TRIGGER trg_notify_enrollment AFTER INSERT ON public.enrollments FOR EACH ROW EXECUTE FUNCTION public.notify_on_enrollment();
