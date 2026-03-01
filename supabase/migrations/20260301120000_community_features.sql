-- Community features: connections, shared roadmaps, points calculation

-- =============================================================================
-- 1. connections table
-- =============================================================================
CREATE TABLE public.connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  receiver_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(requester_id, receiver_id)
);

ALTER TABLE public.connections ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read connections (needed for public profile counts)
CREATE POLICY "connections_select" ON public.connections
  FOR SELECT TO authenticated USING (true);

-- Requester can insert
CREATE POLICY "connections_insert" ON public.connections
  FOR INSERT TO authenticated WITH CHECK (requester_id = auth.uid());

-- Only receiver can update (accept/reject)
CREATE POLICY "connections_update" ON public.connections
  FOR UPDATE TO authenticated USING (receiver_id = auth.uid());

-- Either party can delete
CREATE POLICY "connections_delete" ON public.connections
  FOR DELETE TO authenticated USING (requester_id = auth.uid() OR receiver_id = auth.uid());

-- =============================================================================
-- 2. shared_roadmaps table
-- =============================================================================
CREATE TABLE public.shared_roadmaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  receiver_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  roadmap_id uuid NOT NULL REFERENCES public.roadmaps(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.shared_roadmaps ENABLE ROW LEVEL SECURITY;

-- Sender or receiver can read
CREATE POLICY "shared_roadmaps_select" ON public.shared_roadmaps
  FOR SELECT TO authenticated USING (sender_id = auth.uid() OR receiver_id = auth.uid());

-- Sender must be authenticated and connected to receiver
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

-- Only receiver can update status
CREATE POLICY "shared_roadmaps_update" ON public.shared_roadmaps
  FOR UPDATE TO authenticated USING (receiver_id = auth.uid());

-- =============================================================================
-- 3. calculate_user_points function
-- =============================================================================
CREATE OR REPLACE FUNCTION public.calculate_user_points(p_user_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT count(*) * 10 FROM public.progress WHERE user_id = p_user_id AND status = 'completed'),
    0
  )::integer +
  COALESCE(
    (SELECT count(*) * 25 FROM public.roadmaps WHERE user_id = p_user_id),
    0
  )::integer +
  COALESCE(
    (SELECT count(*) * 5 FROM public.shared_roadmaps WHERE sender_id = p_user_id AND status = 'accepted'),
    0
  )::integer;
$$;

-- =============================================================================
-- 4. Additional RLS policies for public profiles / roadmaps
-- =============================================================================

-- Any authenticated user can read any profile (public profiles)
CREATE POLICY "profiles_public_select" ON public.profiles
  FOR SELECT TO authenticated USING (true);

-- Any authenticated user can read any roadmap (for public profile view / shared preview)
CREATE POLICY "roadmaps_public_select" ON public.roadmaps
  FOR SELECT TO authenticated USING (true);
