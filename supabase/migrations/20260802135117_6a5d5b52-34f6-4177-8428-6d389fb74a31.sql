CREATE POLICY groups_invited_select ON public.groups FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.group_invites gi
  WHERE gi.group_id = groups.id AND gi.receiver_id = auth.uid()
));