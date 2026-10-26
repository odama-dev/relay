-- CreateEnum
CREATE TYPE "deal_lead_type" AS ENUM ('inbound', 'outbound');

-- AlterTable
ALTER TABLE "deals" ADD COLUMN     "company_id" UUID,
ADD COLUMN     "last_contact_on" DATE,
ADD COLUMN     "last_stage_id" UUID,
ADD COLUMN     "lead_date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "lead_type" "deal_lead_type",
ADD COLUMN     "person_id" UUID;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "status_override" "invoice_status",
ADD COLUMN     "status_override_at" TIMESTAMPTZ,
ADD COLUMN     "status_override_by" UUID;

-- AlterTable
ALTER TABLE "pipeline_stages" ADD COLUMN     "is_hidden" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "crm_notes" (
    "id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "client_id" UUID,
    "company_id" UUID,
    "person_id" UUID,
    "deal_id" UUID,
    "author_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_notes_client_id_created_at_idx" ON "crm_notes"("client_id", "created_at");

-- CreateIndex
CREATE INDEX "crm_notes_company_id_created_at_idx" ON "crm_notes"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "crm_notes_person_id_created_at_idx" ON "crm_notes"("person_id", "created_at");

-- CreateIndex
CREATE INDEX "crm_notes_deal_id_created_at_idx" ON "crm_notes"("deal_id", "created_at");

-- CreateIndex
CREATE INDEX "deals_person_id_idx" ON "deals"("person_id");

-- CreateIndex
CREATE INDEX "deals_company_id_idx" ON "deals"("company_id");

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_last_stage_id_fkey" FOREIGN KEY ("last_stage_id") REFERENCES "pipeline_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "crm_people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "crm_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_notes" ADD CONSTRAINT "crm_notes_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_notes" ADD CONSTRAINT "crm_notes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "crm_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_notes" ADD CONSTRAINT "crm_notes_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "crm_people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_notes" ADD CONSTRAINT "crm_notes_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_notes" ADD CONSTRAINT "crm_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ===========================================================================
-- Sales feedback (docs/DECISIONS.md "Sales feedback, Oct 2026"):
-- deal details linked to People / Companies, hideable stages, notes on
-- clients / CRM records / deals, a manual invoice status, and own tasks for
-- every role (Sales into the project's "Sales" section).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- deals: lead source list, lead type, lead date, last stage reached
-- ---------------------------------------------------------------------------
UPDATE public.deals SET lead_type = 'inbound' WHERE lower(lead_source) = 'inbound';
UPDATE public.deals SET lead_source = CASE
    WHEN lead_source IS NULL OR btrim(lead_source) = '' THEN NULL
    WHEN lower(lead_source) LIKE 'dribbb%' THEN 'dribbble'
    WHEN lower(lead_source) LIKE '%website%' OR lower(lead_source) = 'web' THEN 'website'
    WHEN lower(lead_source) LIKE '%mail%' THEN 'email'
    WHEN lower(lead_source) LIKE 'contra%' THEN 'contra'
    WHEN lower(lead_source) LIKE 'behance%' THEN 'behance'
    WHEN lower(lead_source) LIKE '%referral%' OR lower(lead_source) LIKE '%network%' OR lower(lead_source) = 'existing client' THEN 'referral'
    ELSE 'other'
  END;
ALTER TABLE public.deals
  ADD CONSTRAINT deals_lead_source CHECK (lead_source IN ('dribbble', 'website', 'email', 'contra', 'behance', 'referral', 'other'));

UPDATE public.deals SET lead_date = (created_at AT TIME ZONE 'Asia/Jakarta')::date;
-- An existing client's deals start at that client's company.
UPDATE public.deals d SET company_id = c.id FROM public.crm_companies c WHERE c.client_id = d.client_id AND d.company_id IS NULL;

-- The last open stage: the current one while open, else the open stage it left.
UPDATE public.deals d SET last_stage_id = d.stage_id
  FROM public.pipeline_stages s WHERE s.id = d.stage_id AND s.category = 'open';
UPDATE public.deals d SET last_stage_id = (
    SELECT h.from_stage_id FROM public.deal_stage_history h
    JOIN public.pipeline_stages f ON f.id = h.from_stage_id AND f.category = 'open'
    WHERE h.deal_id = d.id ORDER BY h.changed_at DESC LIMIT 1)
  WHERE d.last_stage_id IS NULL;

-- The stages the team reports on (funnel: Qualified → Discovery call → Won).
DO $$
DECLARE
  q_pos int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.pipeline_stages WHERE lower(name) = 'qualified') THEN
    INSERT INTO public.pipeline_stages (id, name, category, probability, position) VALUES (gen_random_uuid(), 'Qualified', 'open', 20, 0);
  END IF;
  SELECT position INTO q_pos FROM public.pipeline_stages WHERE lower(name) = 'qualified' ORDER BY position LIMIT 1;
  IF NOT EXISTS (SELECT 1 FROM public.pipeline_stages WHERE lower(name) = 'discovery call') THEN
    UPDATE public.pipeline_stages SET position = position + 2 WHERE position > q_pos;
    INSERT INTO public.pipeline_stages (id, name, category, probability, position) VALUES
      (gen_random_uuid(), 'Discovery call', 'open', 35, q_pos + 1);
    IF NOT EXISTS (SELECT 1 FROM public.pipeline_stages WHERE lower(name) = 'committed') THEN
      INSERT INTO public.pipeline_stages (id, name, category, probability, position) VALUES
        (gen_random_uuid(), 'Committed', 'open', 75, q_pos + 2);
    END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM public.pipeline_stages WHERE lower(name) = 'committed') THEN
    INSERT INTO public.pipeline_stages (id, name, category, probability, position)
    SELECT gen_random_uuid(), 'Committed', 'open', 75, max(position) + 1 FROM public.pipeline_stages WHERE category = 'open';
  END IF;
END $$;

-- last_stage_id follows the deal into each open stage and stays put when it
-- closes; a write may set it by hand, but only to an open stage.
CREATE OR REPLACE FUNCTION app.deals_last_stage() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  cat public.stage_category;
  explicit boolean := TG_OP = 'UPDATE' AND NEW.last_stage_id IS DISTINCT FROM OLD.last_stage_id;
BEGIN
  SELECT s.category INTO cat FROM public.pipeline_stages s WHERE s.id = NEW.stage_id;
  IF NEW.last_stage_id IS NOT NULL AND (TG_OP = 'INSERT' OR explicit)
     AND NOT EXISTS (SELECT 1 FROM public.pipeline_stages s WHERE s.id = NEW.last_stage_id AND s.category = 'open') THEN
    RAISE EXCEPTION 'The last stage must be an open stage' USING ERRCODE = 'check_violation';
  END IF;
  IF cat = 'open' AND (TG_OP = 'INSERT' OR NEW.stage_id <> OLD.stage_id) AND NOT explicit THEN
    NEW.last_stage_id := NEW.stage_id;
  ELSIF TG_OP = 'UPDATE' AND NEW.stage_id <> OLD.stage_id AND NOT explicit AND NEW.last_stage_id IS NULL THEN
    NEW.last_stage_id := (SELECT s.id FROM public.pipeline_stages s WHERE s.id = OLD.stage_id AND s.category = 'open');
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER deals_last_stage BEFORE INSERT OR UPDATE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION app.deals_last_stage();

-- ---------------------------------------------------------------------------
-- crm_notes — Sales writes, Studio Report reads; authors edit / delete their own.
-- ---------------------------------------------------------------------------
ALTER TABLE public.crm_notes
  ADD CONSTRAINT crm_notes_body CHECK (length(btrim(body)) BETWEEN 1 AND 5000),
  ADD CONSTRAINT crm_notes_target CHECK (num_nonnulls(client_id, company_id, person_id, deal_id) >= 1);

CREATE OR REPLACE FUNCTION app.crm_notes_stamp() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF app.via_rls() THEN
      NEW.author_id := app.uid();
    END IF;
  ELSIF NEW.author_id IS DISTINCT FROM OLD.author_id OR NEW.created_at <> OLD.created_at
     OR NEW.client_id IS DISTINCT FROM OLD.client_id OR NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.person_id IS DISTINCT FROM OLD.person_id OR NEW.deal_id IS DISTINCT FROM OLD.deal_id THEN
    RAISE EXCEPTION 'Only a note''s text can change' USING ERRCODE = '42501';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER crm_notes_stamp BEFORE INSERT OR UPDATE ON public.crm_notes
  FOR EACH ROW EXECUTE FUNCTION app.crm_notes_stamp();

ALTER TABLE public.crm_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_notes FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_notes TO authenticated;
CREATE POLICY crm_notes_select ON public.crm_notes FOR SELECT TO authenticated USING (app.has_module('sales', 'studio_report'));
CREATE POLICY crm_notes_insert ON public.crm_notes FOR INSERT TO authenticated WITH CHECK (app.has_module('sales'));
CREATE POLICY crm_notes_update ON public.crm_notes FOR UPDATE TO authenticated
  USING (app.has_module('sales') AND author_id = app.uid()) WITH CHECK (app.has_module('sales') AND author_id = app.uid());
CREATE POLICY crm_notes_delete ON public.crm_notes FOR DELETE TO authenticated
  USING (app.has_module('sales') AND author_id = app.uid());

-- ---------------------------------------------------------------------------
-- invoices: a manual status. Sales / Finance may set status_override on an
-- issued invoice (never Draft / Void); it becomes the status and stays until
-- cleared, after which the system derives it again.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.invoices_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NOT app.via_rls() THEN
    IF TG_OP = 'UPDATE' AND NEW.status_override IS NOT NULL AND NEW.status NOT IN ('draft', 'void') THEN
      NEW.status := NEW.status_override;
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' OR NEW.number IS NOT NULL OR NEW.amount_paid <> 0 OR NEW.status_override IS NOT NULL THEN
      RAISE EXCEPTION 'New invoices start as drafts' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.number IS DISTINCT FROM OLD.number OR NEW.amount_paid <> OLD.amount_paid OR NEW.sent_at IS DISTINCT FROM OLD.sent_at
     OR NEW.project_id <> OLD.project_id OR NEW.client_id <> OLD.client_id
     OR NEW.status_override_by IS DISTINCT FROM OLD.status_override_by OR NEW.status_override_at IS DISTINCT FROM OLD.status_override_at THEN
    RAISE EXCEPTION 'These invoice fields are managed by the system' USING ERRCODE = '42501';
  END IF;
  IF NEW.status_override IS DISTINCT FROM OLD.status_override THEN
    IF OLD.status IN ('draft', 'void') THEN
      RAISE EXCEPTION 'Only an issued invoice''s status can be set by hand' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status_override IN ('draft', 'void') THEN
      RAISE EXCEPTION 'Send or void the invoice instead' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.subtotal <> OLD.subtotal OR NEW.total <> OLD.total OR NEW.currency <> OLD.currency OR NEW.issue_date <> OLD.issue_date THEN
      RAISE EXCEPTION 'A sent invoice is locked. Void it and issue a new one.' USING ERRCODE = 'check_violation';
    END IF;
    NEW.status_override_by := CASE WHEN NEW.status_override IS NULL THEN NULL ELSE app.uid() END;
    NEW.status_override_at := CASE WHEN NEW.status_override IS NULL THEN NULL ELSE now() END;
    NEW.status := coalesce(NEW.status_override, OLD.status);
    RETURN NEW;
  END IF;
  IF OLD.status = 'draft' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'Send the invoice to issue it' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'void' THEN
    RAISE EXCEPTION 'A void invoice can''t change' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> 'void' OR NEW.subtotal <> OLD.subtotal OR NEW.total <> OLD.total OR NEW.currency <> OLD.currency
     OR NEW.issue_date <> OLD.issue_date OR NEW.bill_to_name <> OLD.bill_to_name
     OR NEW.bill_to_address IS DISTINCT FROM OLD.bill_to_address OR NEW.bill_to_email IS DISTINCT FROM OLD.bill_to_email THEN
    RAISE EXCEPTION 'A sent invoice is locked. Void it and issue a new one.' USING ERRCODE = 'check_violation';
  END IF;
  NEW.voided_at := now();
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------
-- Tasks: every role keeps its own tasks on the projects it's a member of,
-- and joins a project by adding a task to it. Sales tasks go to the
-- project's "Sales" section. Contract values stay behind their own policy.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.can_view_tasks(pid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT app.has_role('hr') OR (app.user_role() IS NOT NULL AND app.is_project_member(pid))
$$;

CREATE OR REPLACE FUNCTION app.can_edit_task(tid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = tid
      AND app.user_role() IS NOT NULL
      AND (
        t.reviewer_id = app.uid()
        OR (
          app.is_project_member(t.project_id)
          AND (
            app.can_manage_project(t.project_id)
            OR t.owner_id = app.uid()
            OR EXISTS (SELECT 1 FROM public.task_collaborators c WHERE c.task_id = t.id AND c.user_id = app.uid())
          )
        )
      )
  )
$$;

DROP POLICY tasks_insert ON public.tasks;
CREATE POLICY tasks_insert ON public.tasks FOR INSERT TO authenticated
  WITH CHECK (
    app.user_role() IS NOT NULL
    AND app.is_project_member(project_id)
    AND created_by = app.uid()
    AND (
      NOT app.has_role('sales')
      OR EXISTS (SELECT 1 FROM public.sections s WHERE s.id = section_id AND s.name = 'Sales')
    )
  );

-- Open projects anyone may find to add a task to: code, name, client and
-- whether you're on it — never contract values or budgets.
CREATE OR REPLACE FUNCTION app.search_projects(q text) RETURNS TABLE (id uuid, code text, name text, client_name text, is_member boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p.id, p.code, p.name, c.name, app.is_member_of(p.id, app.uid())
  FROM public.projects p LEFT JOIN public.clients c ON c.id = p.client_id
  WHERE app.user_role() IS NOT NULL
    AND p.status IN ('active', 'on_hold')
    AND (coalesce(btrim(q), '') = '' OR p.name ILIKE '%' || btrim(q) || '%' OR p.code ILIKE '%' || btrim(q) || '%' OR c.name ILIKE '%' || btrim(q) || '%')
  ORDER BY app.is_member_of(p.id, app.uid()) DESC, p.name
  LIMIT 20
$$;

-- Joins the signed-in person to an open project (if they aren't on it) and
-- returns the section their task goes to: "Sales" for Sales (created when
-- missing), otherwise the first section ("General" when there's none).
CREATE OR REPLACE FUNCTION app.join_project_for_task(pid uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sid uuid;
  wanted text := CASE WHEN app.has_role('sales') THEN 'Sales' ELSE NULL END;
BEGIN
  IF app.user_role() IS NULL THEN
    RAISE EXCEPTION 'Sign in again' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = pid AND p.status IN ('active', 'on_hold')) THEN
    RAISE EXCEPTION 'Tasks can only be added to Active or On hold projects' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO public.project_members (project_id, user_id, added_by, created_at, updated_at)
  VALUES (pid, app.uid(), app.uid(), now(), now())
  ON CONFLICT DO NOTHING;
  SELECT s.id INTO sid FROM public.sections s
  WHERE s.project_id = pid AND s.archived_at IS NULL AND (wanted IS NULL OR s.name = wanted)
  ORDER BY s.position, s.created_at LIMIT 1;
  IF sid IS NULL THEN
    INSERT INTO public.sections (id, project_id, name, position, created_at, updated_at)
    SELECT gen_random_uuid(), pid, coalesce(wanted, 'General'), coalesce(max(s.position) + 1, 0), now(), now()
    FROM public.sections s WHERE s.project_id = pid
    RETURNING id INTO sid;
  END IF;
  RETURN sid;
END $$;

GRANT EXECUTE ON FUNCTION app.search_projects(text), app.join_project_for_task(uuid) TO authenticated, service_role;
