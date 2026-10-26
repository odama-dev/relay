-- The task dialog loads every open project once and filters as you type, so
-- app.search_projects returns up to 500 rows (a studio's open projects).
CREATE OR REPLACE FUNCTION app.search_projects(q text) RETURNS TABLE (id uuid, code text, name text, client_name text, is_member boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p.id, p.code, p.name, c.name, app.is_member_of(p.id, app.uid())
  FROM public.projects p LEFT JOIN public.clients c ON c.id = p.client_id
  WHERE app.user_role() IS NOT NULL
    AND p.status IN ('active', 'on_hold')
    AND (coalesce(btrim(q), '') = '' OR p.name ILIKE '%' || btrim(q) || '%' OR p.code ILIKE '%' || btrim(q) || '%' OR c.name ILIKE '%' || btrim(q) || '%')
  ORDER BY app.is_member_of(p.id, app.uid()) DESC, p.name
  LIMIT 500
$$;
