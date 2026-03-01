
CREATE TABLE IF NOT EXISTS public.roadmap_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  roadmap_id uuid NOT NULL REFERENCES public.roadmaps(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.roadmap_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "roadmap_requests_select" ON public.roadmap_requests
  FOR SELECT TO authenticated
  USING (requester_id = auth.uid() OR owner_id = auth.uid());

CREATE POLICY "roadmap_requests_insert" ON public.roadmap_requests
  FOR INSERT TO authenticated
  WITH CHECK (requester_id = auth.uid());

CREATE POLICY "roadmap_requests_update" ON public.roadmap_requests
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid());
