-- ===========================================================================
-- Phase 2 · M9 Sales — guards and the payment-proof flow
-- (PRD/PRD_Fase-2.md "Sales"). Stage rules and the stage history are
-- triggers; a payment proof is submitted by Sales and decided by Finance.
-- ===========================================================================

-- A deal is stale after this many days in the same open stage (PRD open
-- question; admins change it in Settings).
INSERT INTO public.app_settings (key, value, updated_at) VALUES ('sales_stale_days', '14', now())
  ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- deals: fields that follow the stage
-- ---------------------------------------------------------------------------

-- Entering a stage stamps stage_changed_at and takes the stage's default
-- probability unless the same write sets one; Won is 100 %, Lost 0 % and
-- needs a reason; closing stamps closed_at, reopening clears it. The linked
-- project is set once, on a won deal, and the client then stays put.
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
    ELSIF moved AND TG_OP = 'UPDATE' AND app.via_rls() AND nullif(btrim(coalesce(NEW.lost_reason, '')), '') IS NULL THEN
      RAISE EXCEPTION 'Say why the deal was lost' USING ERRCODE = 'check_violation';
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

CREATE TRIGGER deals_derive BEFORE INSERT OR UPDATE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION app.deals_derive();

-- Every stage entry is kept with the value at that moment: the pipeline
-- bridge and the deal duration read it. Written by the system only.
CREATE OR REPLACE FUNCTION app.deals_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.stage_id <> OLD.stage_id THEN
    INSERT INTO public.deal_stage_history (id, deal_id, from_stage_id, to_stage_id, value, currency, changed_by, changed_at)
    VALUES (gen_random_uuid(), NEW.id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.stage_id END, NEW.stage_id, NEW.value, NEW.currency, app.uid(),
            CASE WHEN TG_OP = 'INSERT' THEN NEW.created_at ELSE now() END);
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER deals_history AFTER INSERT OR UPDATE OF stage_id ON public.deals
  FOR EACH ROW EXECUTE FUNCTION app.deals_history();

DROP POLICY deal_stage_history_insert ON public.deal_stage_history;
REVOKE INSERT ON public.deal_stage_history FROM authenticated;

-- ---------------------------------------------------------------------------
-- pipeline_stages: a stage with deals can't go, and the pipeline always
-- keeps an Open, a Won and a Lost stage (reports read categories, not names).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.pipeline_stages_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.deals d WHERE d.stage_id = OLD.id) THEN
      RAISE EXCEPTION 'Move this stage''s deals to another stage first' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' OR NEW.category <> OLD.category THEN
    IF NOT EXISTS (SELECT 1 FROM public.pipeline_stages s WHERE s.category = OLD.category AND s.id <> OLD.id) THEN
      RAISE EXCEPTION 'The pipeline needs at least one % stage', initcap(OLD.category::text) USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF NEW.category <> OLD.category AND EXISTS (SELECT 1 FROM public.deals d WHERE d.stage_id = OLD.id) THEN
    RAISE EXCEPTION 'Move this stage''s deals before changing its category' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER pipeline_stages_guard BEFORE UPDATE OR DELETE ON public.pipeline_stages
  FOR EACH ROW EXECUTE FUNCTION app.pipeline_stages_guard();

-- ---------------------------------------------------------------------------
-- payment_proofs: Sales submits against an issued invoice; Finance verifies
-- or rejects (with a note) — never a proof they submitted themselves. The
-- payment it creates is linked by the system.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.payment_proofs_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  inv record;
  req record;
BEGIN
  IF NOT app.via_rls() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT i.status, i.currency INTO inv FROM public.invoices i WHERE i.id = NEW.invoice_id;
    IF inv.status IS NULL OR inv.status NOT IN ('sent', 'partially_paid', 'overdue', 'payment_submitted') THEN
      RAISE EXCEPTION 'Proofs go on a sent invoice that isn''t paid yet' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.payment_request_id IS NOT NULL THEN
      SELECT r.invoice_id, r.status INTO req FROM public.invoice_payment_requests r WHERE r.id = NEW.payment_request_id;
      IF req.invoice_id IS DISTINCT FROM NEW.invoice_id THEN
        RAISE EXCEPTION 'That payment request belongs to another invoice' USING ERRCODE = 'check_violation';
      END IF;
      IF req.status IN ('paid', 'void') THEN
        RAISE EXCEPTION 'That payment request is already settled' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    NEW.currency := inv.currency;
    NEW.status := 'submitted';
    NEW.submitted_by := app.uid();
    NEW.submitted_at := now();
    NEW.reviewed_by := NULL;
    NEW.reviewed_at := NULL;
    NEW.review_note := NULL;
    NEW.payment_id := NULL;
    RETURN NEW;
  END IF;

  IF OLD.status <> 'submitted' THEN
    RAISE EXCEPTION 'This proof has already been decided' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.invoice_id <> OLD.invoice_id OR NEW.payment_request_id IS DISTINCT FROM OLD.payment_request_id OR NEW.amount <> OLD.amount
     OR NEW.currency <> OLD.currency OR NEW.paid_on <> OLD.paid_on OR NEW.platform <> OLD.platform
     OR NEW.file_path IS DISTINCT FROM OLD.file_path OR NEW.submitted_by IS DISTINCT FROM OLD.submitted_by
     OR NEW.submitted_at <> OLD.submitted_at OR NEW.payment_id IS DISTINCT FROM OLD.payment_id THEN
    RAISE EXCEPTION 'A submitted proof can only be verified or rejected' USING ERRCODE = '42501';
  END IF;
  IF NEW.status = 'submitted' THEN
    RAISE EXCEPTION 'Verify or reject the proof' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.submitted_by = app.uid() THEN
    RAISE EXCEPTION 'Someone else verifies a proof you submitted' USING ERRCODE = '42501';
  END IF;
  IF NEW.status = 'rejected' AND nullif(btrim(coalesce(NEW.review_note, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Add a note saying why the proof is rejected' USING ERRCODE = 'check_violation';
  END IF;
  NEW.reviewed_by := app.uid();
  NEW.reviewed_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER payment_proofs_guard BEFORE INSERT OR UPDATE ON public.payment_proofs
  FOR EACH ROW EXECUTE FUNCTION app.payment_proofs_guard();

-- Phase 2 modules read invoices and payments too (role policies stay for
-- the Phase 1 roles). Writing invoices is still Sales / Finance by role.
CREATE POLICY invoices_select_modules ON public.invoices FOR SELECT TO authenticated
  USING (app.has_module('sales', 'finance', 'studio_report'));
CREATE POLICY payments_select_modules ON public.payments FOR SELECT TO authenticated
  USING (app.has_module('sales', 'finance', 'studio_report'));
