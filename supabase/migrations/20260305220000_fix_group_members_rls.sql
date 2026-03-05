-- Fix: The self-referencing group_members_peer_select policy causes
-- recursive RLS evaluation, breaking ALL queries on group_members.
-- Replace with a simple open-read policy (group membership isn't sensitive).

-- Drop the broken self-referencing policy
DROP POLICY IF EXISTS "group_members_peer_select" ON public.group_members;

-- Drop the old restrictive policy
DROP POLICY IF EXISTS "group_members_select" ON public.group_members;

-- Replace with simple policy: any authenticated user can read group members
-- (same pattern as groups table which is already USING (true))
CREATE POLICY "group_members_select" ON public.group_members
  FOR SELECT TO authenticated USING (true);
