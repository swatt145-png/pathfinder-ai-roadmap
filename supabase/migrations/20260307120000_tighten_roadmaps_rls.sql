-- Tighten roadmaps SELECT RLS: only allow reading own roadmaps,
-- roadmaps shared with you, or roadmaps assigned via groups.
-- Edge functions use SUPABASE_SERVICE_ROLE_KEY which bypasses RLS.

-- Drop the overly permissive policy
DROP POLICY IF EXISTS "roadmaps_public_select" ON public.roadmaps;

-- Replace with scoped policy
CREATE POLICY "roadmaps_scoped_select" ON public.roadmaps
  FOR SELECT TO authenticated
  USING (
    -- Own roadmaps
    user_id = auth.uid()
    -- Roadmaps shared with you (pending or accepted)
    OR id IN (
      SELECT roadmap_id FROM public.shared_roadmaps
      WHERE receiver_id = auth.uid() OR sender_id = auth.uid()
    )
    -- Roadmaps assigned to you via groups
    OR id IN (
      SELECT roadmap_id FROM public.member_group_roadmaps
      WHERE member_id = auth.uid()
    )
    -- Source roadmaps for group assignments (so owner can view original)
    OR id IN (
      SELECT gr.roadmap_id FROM public.group_roadmaps gr
      JOIN public.groups g ON g.id = gr.group_id
      WHERE g.owner_id = auth.uid()
    )
  );
