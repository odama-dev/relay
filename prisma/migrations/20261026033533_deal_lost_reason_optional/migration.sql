-- A lost reason is optional now (Sales feedback, Oct 2026): deals_derive no
-- longer refuses a move to Lost without one. Everything else is unchanged.
CREATE OR REPLACE FUNCTION app.deals_derive() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  cat public.stage_category;
  default_prob int;
  moved boolean := TG_OP = 'INSERT' OR NEW.stage_id <> OLD.stage_id;
BEGIN
  SELECT s.category, s.probability INTO cat, default_prob FROM public.pipeline_stages s WHERE s.id = NEW.stage_id;
  IF TG_OP = 'INSERT' THEN
    IF app.via_rls() THEN
      NEW.created_by := app.uid();
      IF NEW.project_id IS NOT NULL THEN
        RAISE EXCEPTION 'Create the project from the won deal' USING ERRCODE = '42501';
      END IF;
    END IF;
  ELSE
    IF NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'These deal fields are managed by the system' USING ERRCODE = '42501';
    END IF;
    IF NEW.project_id IS DISTINCT FROM OLD.project_id AND app.via_rls() THEN
      IF OLD.project_id IS NOT NULL THEN
        RAISE EXCEPTION 'This deal already has its project' USING ERRCODE = 'check_violation';
      END IF;
      IF cat <> 'won' THEN
        RAISE EXCEPTION 'Only a won deal becomes a project' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    IF OLD.project_id IS NOT NULL AND NEW.client_id IS DISTINCT FROM OLD.client_id THEN
      RAISE EXCEPTION 'The client is fixed once the deal has a project' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.stage_id <> OLD.stage_id AND NEW.probability = OLD.probability THEN
      NEW.probability := default_prob;
    END IF;
  END IF;

  IF moved THEN
    NEW.stage_changed_at := now();
  END IF;
  IF cat IN ('won', 'lost') THEN
    NEW.probability := CASE WHEN cat = 'won' THEN 100 ELSE 0 END;
    IF cat = 'won' THEN
      NEW.lost_reason := NULL;
    END IF;
    -- An import may carry the real close date; a move closes it now.
    IF TG_OP = 'INSERT' THEN
      NEW.closed_at := coalesce(NEW.closed_at, now());
    ELSIF moved AND NEW.closed_at IS NOT DISTINCT FROM OLD.closed_at THEN
      NEW.closed_at := now();
    ELSE
      NEW.closed_at := coalesce(NEW.closed_at, now());
    END IF;
  ELSE
    NEW.closed_at := NULL;
    NEW.lost_reason := NULL;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
