
-- Re-create clone_roadmap_for_member (from migration 20260305200000)
CREATE OR REPLACE FUNCTION public.clone_roadmap_for_member(
  p_source_roadmap_id uuid,
  p_target_user_id uuid,
  p_group_roadmap_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_source roadmaps%ROWTYPE;
  v_cloned_id uuid;
  v_caller_id uuid;
  v_group_id uuid;
BEGIN
  v_caller_id := auth.uid();

  SELECT g.id INTO v_group_id
  FROM group_roadmaps gr
  JOIN groups g ON g.id = gr.group_id
  WHERE gr.id = p_group_roadmap_id AND g.owner_id = v_caller_id;

  IF v_group_id IS NULL THEN
    RAISE EXCEPTION 'Not authorized: you do not own this group';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM group_members
    WHERE group_id = v_group_id AND user_id = p_target_user_id
  ) THEN
    RAISE EXCEPTION 'Target user is not a member of this group';
  END IF;

  IF EXISTS (
    SELECT 1 FROM member_group_roadmaps
    WHERE group_roadmap_id = p_group_roadmap_id AND member_id = p_target_user_id
  ) THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_source FROM roadmaps WHERE id = p_source_roadmap_id;
  IF v_source IS NULL THEN
    RAISE EXCEPTION 'Source roadmap not found';
  END IF;

  INSERT INTO roadmaps (
    user_id, topic, skill_level, timeline_weeks, hours_per_day,
    hard_deadline, deadline_date, roadmap_data, original_roadmap_data,
    learning_goal, status, completed_modules, total_modules,
    current_streak, source_roadmap_id
  ) VALUES (
    p_target_user_id, v_source.topic, v_source.skill_level,
    v_source.timeline_weeks, v_source.hours_per_day,
    v_source.hard_deadline, v_source.deadline_date,
    v_source.roadmap_data, v_source.original_roadmap_data,
    v_source.learning_goal, 'active', 0, v_source.total_modules,
    0, v_source.id
  )
  RETURNING id INTO v_cloned_id;

  INSERT INTO member_group_roadmaps (group_roadmap_id, member_id, roadmap_id)
  VALUES (p_group_roadmap_id, p_target_user_id, v_cloned_id);

  RETURN v_cloned_id;
END;
$$;

-- Re-apply RLS policies (from migration 20260305210000)
-- Drop if exists to avoid duplicates
DROP POLICY IF EXISTS "group_members_peer_select" ON public.group_members;
CREATE POLICY "group_members_peer_select" ON public.group_members
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.group_members gm
      WHERE gm.group_id = group_members.group_id
        AND gm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "progress_group_owner_select" ON public.progress;
CREATE POLICY "progress_group_owner_select" ON public.progress
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM member_group_roadmaps mgr
      JOIN group_roadmaps gr ON gr.id = mgr.group_roadmap_id
      JOIN groups g ON g.id = gr.group_id
      WHERE mgr.member_id = progress.user_id
        AND mgr.roadmap_id = progress.roadmap_id
        AND g.owner_id = auth.uid()
    )
  );
