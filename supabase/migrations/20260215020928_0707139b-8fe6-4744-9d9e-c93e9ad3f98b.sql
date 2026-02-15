
-- Profiles table
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own profile" ON public.profiles FOR SELECT USING (id = auth.uid());
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (id = auth.uid());
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (id = auth.uid());

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', 'User'));
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- Roadmaps table
CREATE TABLE public.roadmaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  topic text NOT NULL,
  skill_level text NOT NULL,
  timeline_weeks integer NOT NULL,
  hours_per_day numeric NOT NULL,
  hard_deadline boolean DEFAULT false,
  deadline_date date,
  roadmap_data jsonb NOT NULL,
  original_roadmap_data jsonb,
  status text NOT NULL DEFAULT 'active',
  total_modules integer,
  completed_modules integer DEFAULT 0,
  current_streak integer DEFAULT 0,
  last_activity_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.roadmaps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own roadmaps" ON public.roadmaps FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can insert own roadmaps" ON public.roadmaps FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own roadmaps" ON public.roadmaps FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Users can delete own roadmaps" ON public.roadmaps FOR DELETE USING (user_id = auth.uid());
CREATE TRIGGER update_roadmaps_updated_at BEFORE UPDATE ON public.roadmaps FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Helper function (now roadmaps table exists)
CREATE OR REPLACE FUNCTION public.has_active_roadmap(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.roadmaps WHERE user_id = p_user_id AND status = 'active');
$$;

-- Progress table
CREATE TABLE public.progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roadmap_id uuid NOT NULL REFERENCES public.roadmaps(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  module_id text NOT NULL,
  module_title text,
  status text NOT NULL DEFAULT 'not_started',
  self_report text,
  quiz_score numeric,
  quiz_answers jsonb,
  time_spent_minutes integer,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own progress" ON public.progress FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can insert own progress" ON public.progress FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own progress" ON public.progress FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Users can delete own progress" ON public.progress FOR DELETE USING (user_id = auth.uid());

-- Adaptations table
CREATE TABLE public.adaptations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roadmap_id uuid NOT NULL REFERENCES public.roadmaps(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trigger_reason text,
  changes_summary text,
  previous_roadmap jsonb,
  new_roadmap jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.adaptations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own adaptations" ON public.adaptations FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can insert own adaptations" ON public.adaptations FOR INSERT WITH CHECK (user_id = auth.uid());
