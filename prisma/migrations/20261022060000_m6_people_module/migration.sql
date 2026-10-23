-- Phase 2 · M6: the People module edits profiles (job role, division, level,
-- title, manager) like HR does. profiles_guard still decides which fields:
-- role / employment / status stay HR or admin, access stays admin.
DROP POLICY profiles_update ON public.profiles;
CREATE POLICY profiles_update ON public.profiles FOR UPDATE TO authenticated
  USING (id = app.uid() OR app.is_admin() OR app.has_role('hr') OR app.has_module('people'))
  WITH CHECK (id = app.uid() OR app.is_admin() OR app.has_role('hr') OR app.has_module('people'));
