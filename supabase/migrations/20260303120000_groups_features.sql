-- Groups & Roles feature: groups, group_members, group_roadmaps, member_group_roadmaps
-- Adds role to profiles, source_roadmap_id to roadmaps

-- =============================================================================
-- 1a. Add role column to profiles
-- =============================================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'learner'
    CHECK (role IN ('learner', 'educator', 'manager'));

-- =============================================================================
-- 1b. Add source_roadmap_id to roadmaps (tracks cloned-from for group assigns)
-- =============================================================================
ALTER TABLE public.roadmaps
  ADD COLUMN IF NOT EXISTS source_roadmap_id uuid REFERENCES public.roadmaps(id) ON DELETE SET NULL;

-- =============================================================================
-- 1c. groups table
-- =============================================================================
CREATE TABLE public.groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  type text NOT NULL DEFAULT 'study_group'
    CHECK (type IN ('classroom', 'team', 'study_group')),
  invite_code text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "groups_select" ON public.groups
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "groups_insert" ON public.groups
  FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());

CREATE POLICY "groups_update" ON public.groups
  FOR UPDATE TO authenticated USING (owner_id = auth.uid());

CREATE POLICY "groups_delete" ON public.groups
  FOR DELETE TO authenticated USING (owner_id = auth.uid());

-- =============================================================================
-- 1d. group_members table
-- =============================================================================
CREATE TABLE public.group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member'
    CHECK (role IN ('member', 'admin')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(group_id, user_id)
);

ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;

-- Owner of group or own membership can read
CREATE POLICY "group_members_select" ON public.group_members
  FOR SELECT TO authenticated USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.groups WHERE id = group_members.group_id AND owner_id = auth.uid()
    )
  );

-- Self-join only as member
CREATE POLICY "group_members_insert" ON public.group_members
  FOR INSERT TO authenticated WITH CHECK (
    user_id = auth.uid() AND role = 'member'
  );

-- Owner of group or self can delete (leave/remove)
CREATE POLICY "group_members_delete" ON public.group_members
  FOR DELETE TO authenticated USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.groups WHERE id = group_members.group_id AND owner_id = auth.uid()
    )
  );

-- =============================================================================
-- 1e. group_roadmaps table
-- =============================================================================
CREATE TABLE public.group_roadmaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  roadmap_id uuid NOT NULL REFERENCES public.roadmaps(id) ON DELETE CASCADE,
  assigned_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(group_id, roadmap_id)
);

ALTER TABLE public.group_roadmaps ENABLE ROW LEVEL SECURITY;

-- Owner of group has full access
CREATE POLICY "group_roadmaps_owner" ON public.group_roadmaps
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.groups WHERE id = group_roadmaps.group_id AND owner_id = auth.uid()
    )
  );

-- Members can read
CREATE POLICY "group_roadmaps_member_select" ON public.group_roadmaps
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.group_members WHERE group_id = group_roadmaps.group_id AND user_id = auth.uid()
    )
  );

-- =============================================================================
-- 1f. member_group_roadmaps junction table
-- =============================================================================
CREATE TABLE public.member_group_roadmaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_roadmap_id uuid NOT NULL REFERENCES public.group_roadmaps(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  roadmap_id uuid NOT NULL REFERENCES public.roadmaps(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(group_roadmap_id, member_id)
);

ALTER TABLE public.member_group_roadmaps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "member_group_roadmaps_select" ON public.member_group_roadmaps
  FOR SELECT TO authenticated USING (
    member_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.group_roadmaps gr
      JOIN public.groups g ON g.id = gr.group_id
      WHERE gr.id = member_group_roadmaps.group_roadmap_id AND g.owner_id = auth.uid()
    )
  );

CREATE POLICY "member_group_roadmaps_insert" ON public.member_group_roadmaps
  FOR INSERT TO authenticated WITH CHECK (
    member_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.group_roadmaps gr
      JOIN public.groups g ON g.id = gr.group_id
      WHERE gr.id = member_group_roadmaps.group_roadmap_id AND g.owner_id = auth.uid()
    )
  );

-- =============================================================================
-- 1g. Update calculate_user_points to include +15 per group created
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
  )::integer +
  COALESCE(
    (SELECT count(*) * 15 FROM public.groups WHERE owner_id = p_user_id),
    0
  )::integer;
$$;
