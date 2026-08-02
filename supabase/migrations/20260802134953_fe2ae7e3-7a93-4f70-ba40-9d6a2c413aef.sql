-- Helper security definer functions
CREATE OR REPLACE FUNCTION public.is_group_member(_group_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.group_members WHERE group_id = _group_id AND user_id = _user_id)
      OR EXISTS (SELECT 1 FROM public.groups WHERE id = _group_id AND owner_id = _user_id);
$$;

CREATE OR REPLACE FUNCTION public.shares_group_with(_user_a uuid, _user_b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_members ga
    JOIN public.group_members gb ON gb.group_id = ga.group_id
    WHERE ga.user_id = _user_a AND gb.user_id = _user_b
  ) OR EXISTS (
    SELECT 1 FROM public.groups g
    WHERE (g.owner_id = _user_a AND EXISTS (SELECT 1 FROM public.group_members m WHERE m.group_id = g.id AND m.user_id = _user_b))
       OR (g.owner_id = _user_b AND EXISTS (SELECT 1 FROM public.group_members m WHERE m.group_id = g.id AND m.user_id = _user_a))
  );
$$;

CREATE OR REPLACE FUNCTION public.can_view_roadmap(_roadmap_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.roadmaps r
    LEFT JOIN public.profiles p ON p.id = r.user_id
    WHERE r.id = _roadmap_id
      AND (
        r.user_id = _user_id
        OR p.is_public = true
        OR EXISTS (
          SELECT 1 FROM public.group_roadmaps gr
          WHERE gr.roadmap_id = r.id AND public.is_group_member(gr.group_id, _user_id)
        )
        OR EXISTS (
          SELECT 1 FROM public.member_group_roadmaps mgr
          JOIN public.group_roadmaps gr2 ON gr2.id = mgr.group_roadmap_id
          WHERE mgr.roadmap_id = r.id
            AND (mgr.member_id = _user_id OR EXISTS (
              SELECT 1 FROM public.groups g WHERE g.id = gr2.group_id AND g.owner_id = _user_id
            ))
        )
        OR EXISTS (
          SELECT 1 FROM public.shared_roadmaps sr
          WHERE sr.roadmap_id = r.id AND (sr.receiver_id = _user_id OR sr.sender_id = _user_id)
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.get_group_by_invite_code(_invite_code text)
RETURNS TABLE (id uuid, name text, description text, type text, is_active boolean, owner_id uuid, owner_name text, member_count integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT g.id, g.name, g.description, g.type, g.is_active, g.owner_id,
         COALESCE(p.display_name, 'Unknown'),
         (SELECT COUNT(*)::int FROM public.group_members m WHERE m.group_id = g.id)
  FROM public.groups g
  LEFT JOIN public.profiles p ON p.id = g.owner_id
  WHERE g.invite_code = upper(_invite_code) AND g.is_active = true AND auth.uid() IS NOT NULL
  LIMIT 1;
$$;

-- Tighten policies
DROP POLICY IF EXISTS connections_select ON public.connections;
CREATE POLICY connections_select ON public.connections FOR SELECT TO authenticated
  USING (requester_id = auth.uid() OR receiver_id = auth.uid());

DROP POLICY IF EXISTS groups_select ON public.groups;
CREATE POLICY groups_select ON public.groups FOR SELECT TO authenticated
  USING (owner_id = auth.uid() OR public.is_group_member(id, auth.uid()));

DROP POLICY IF EXISTS group_members_select ON public.group_members;
CREATE POLICY group_members_select ON public.group_members FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_group_member(group_id, auth.uid()));

DROP POLICY IF EXISTS profiles_public_select ON public.profiles;
CREATE POLICY profiles_public_select ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR is_public = true OR public.shares_group_with(auth.uid(), id));

DROP POLICY IF EXISTS roadmaps_public_select ON public.roadmaps;
CREATE POLICY roadmaps_public_select ON public.roadmaps FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.can_view_roadmap(id, auth.uid()));

-- Storage: topic-images
DROP POLICY IF EXISTS "Topic images are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Service role can upload topic images" ON storage.objects;
DROP POLICY IF EXISTS "Service role can update topic images" ON storage.objects;
CREATE POLICY "Service role manages topic images" ON storage.objects FOR ALL TO service_role
  USING (bucket_id = 'topic-images') WITH CHECK (bucket_id = 'topic-images');

-- Restrict function execution
REVOKE ALL ON FUNCTION public.handle_new_user() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.has_active_roadmap(uuid) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.calculate_user_points(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.clone_roadmap_for_member(uuid, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.is_group_member(uuid, uuid) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.shares_group_with(uuid, uuid) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.can_view_roadmap(uuid, uuid) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.get_group_by_invite_code(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_group_by_invite_code(text) TO authenticated;