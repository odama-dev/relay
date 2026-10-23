-- Phase 2 · M8: dashboards by responsibility. A person reads their own
-- capacity and time off; managers read their reports' (workload, leave vs
-- tasks); the People module reads everyone's like HR.
DROP POLICY person_capacity_select ON public.person_capacity;
CREATE POLICY person_capacity_select ON public.person_capacity FOR SELECT TO authenticated
  USING (app.has_role('hr', 'c_level', 'pm') OR app.is_admin() OR user_id = app.uid()
         OR app.is_manager_of(user_id) OR app.has_module('people'));
DROP POLICY capacity_overrides_select ON public.capacity_overrides;
CREATE POLICY capacity_overrides_select ON public.capacity_overrides FOR SELECT TO authenticated
  USING (app.has_role('hr', 'c_level', 'pm') OR app.is_admin() OR user_id = app.uid()
         OR app.is_manager_of(user_id) OR app.has_module('people'));
