
-- 1. Public SELECT on profiles for authenticated users
CREATE POLICY "profiles_public_select"
ON public.profiles
FOR SELECT
TO authenticated
USING (true);

-- 2. Public SELECT on roadmaps for authenticated users
CREATE POLICY "roadmaps_public_select"
ON public.roadmaps
FOR SELECT
TO authenticated
USING (true);

-- 3. Connections table
CREATE TABLE IF NOT EXISTS public.connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  receiver_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(requester_id, receiver_id)
);

ALTER TABLE public.connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "connections_select" ON public.connections
FOR SELECT TO authenticated USING (true);

CREATE POLICY "connections_insert" ON public.connections
FOR INSERT TO authenticated WITH CHECK (requester_id = auth.uid());

CREATE POLICY "connections_update" ON public.connections
FOR UPDATE TO authenticated USING (receiver_id = auth.uid());

CREATE POLICY "connections_delete" ON public.connections
FOR DELETE TO authenticated USING (requester_id = auth.uid() OR receiver_id = auth.uid());

-- 4. Shared roadmaps table
CREATE TABLE IF NOT EXISTS public.shared_roadmaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  receiver_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  roadmap_id uuid NOT NULL REFERENCES public.roadmaps(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.shared_roadmaps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shared_roadmaps_select" ON public.shared_roadmaps
FOR SELECT TO authenticated USING (sender_id = auth.uid() OR receiver_id = auth.uid());

CREATE POLICY "shared_roadmaps_insert" ON public.shared_roadmaps
FOR INSERT TO authenticated WITH CHECK (
  sender_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.connections
    WHERE status = 'accepted'
      AND (
        (requester_id = auth.uid() AND receiver_id = shared_roadmaps.receiver_id)
        OR (receiver_id = auth.uid() AND requester_id = shared_roadmaps.receiver_id)
      )
  )
);

CREATE POLICY "shared_roadmaps_update" ON public.shared_roadmaps
FOR UPDATE TO authenticated USING (receiver_id = auth.uid());

-- 5. calculate_user_points function
CREATE OR REPLACE FUNCTION public.calculate_user_points(p_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT COUNT(*)::int * 10 FROM public.progress WHERE user_id = p_user_id AND status = 'complete')
    + (SELECT COUNT(*)::int * 25 FROM public.roadmaps WHERE user_id = p_user_id)
    + (SELECT COUNT(*)::int * 5 FROM public.shared_roadmaps WHERE sender_id = p_user_id AND status = 'accepted'),
  0);
$$;
