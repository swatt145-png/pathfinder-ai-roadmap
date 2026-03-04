ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role text DEFAULT 'learner';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_email_user boolean DEFAULT true;
ALTER TABLE public.roadmaps ADD COLUMN IF NOT EXISTS source_roadmap_id uuid REFERENCES public.roadmaps(id) ON DELETE SET NULL;