-- Dashboard per role (PRD/OVERVIEW-SPEC.md).
--
-- Every dashboard card reads through RLS (withRls). One card needs numbers
-- the reader may not see row by row: HR-3 "task summary per person" — HR has
-- no access to tasks (matrix "Section & task"). This function returns counts
-- only (no titles, projects or comments), and only to HR, C-Level and admins.

CREATE OR REPLACE FUNCTION app.task_summary_per_person(p_today date, p_month_start date, p_month_end date)
RETURNS TABLE (user_id uuid, open_tasks int, overdue_tasks int, done_this_month int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p.id,
         count(t.id) FILTER (WHERE t.status <> 'done' AND pr.status IN ('active', 'on_hold'))::int,
         count(t.id) FILTER (WHERE t.status <> 'done' AND pr.status IN ('active', 'on_hold') AND t.due_date < p_today)::int,
         count(t.id) FILTER (
           WHERE t.status = 'done'
             AND t.completed_at IS NOT NULL
             AND (t.completed_at AT TIME ZONE p.timezone)::date BETWEEN p_month_start AND p_month_end
         )::int
  FROM public.profiles p
  LEFT JOIN public.tasks t
    ON t.owner_id = p.id
   AND NOT EXISTS (SELECT 1 FROM public.sections s WHERE s.id = t.section_id AND s.archived_at IS NOT NULL)
  LEFT JOIN public.projects pr ON pr.id = t.project_id
  WHERE p.status = 'active'
    AND (app.has_role('hr', 'c_level') OR app.is_admin())
  GROUP BY p.id
$$;

REVOKE ALL ON FUNCTION app.task_summary_per_person(date, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.task_summary_per_person(date, date, date) TO authenticated, service_role;
