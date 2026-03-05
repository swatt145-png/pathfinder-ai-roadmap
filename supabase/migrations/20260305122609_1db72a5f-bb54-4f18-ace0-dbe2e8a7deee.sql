-- Fix 1: Allow group members to see all members of groups they belong to
CREATE POLICY "group_members_peer_select" ON public.group_members
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.group_members gm
      WHERE gm.group_id = group_members.group_id AND gm.user_id = auth.uid()
    )
  );

-- Fix 2: Allow group owners to read progress of members' assigned roadmaps
CREATE POLICY "progress_group_owner_select" ON public.progress
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.member_group_roadmaps mgr
      JOIN public.group_roadmaps gr ON gr.id = mgr.group_roadmap_id
      JOIN public.groups g ON g.id = gr.group_id
      WHERE mgr.member_id = progress.user_id
        AND mgr.roadmap_id = progress.roadmap_id
        AND g.owner_id = auth.uid()
    )
  );