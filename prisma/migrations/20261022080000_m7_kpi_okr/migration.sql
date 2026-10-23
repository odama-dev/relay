-- CreateEnum
CREATE TYPE "work_log_kind" AS ENUM ('shot', 'content', 'idea', 'support_request', 'qc_record', 'error', 'release', 'testimony', 'challenge');

-- CreateEnum
CREATE TYPE "work_log_status" AS ENUM ('submitted', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "definition_status" AS ENUM ('draft', 'active', 'archived');

-- CreateEnum
CREATE TYPE "kpi_item_kind" AS ENUM ('core', 'addon');

-- CreateEnum
CREATE TYPE "score_period" AS ENUM ('monthly', 'semester');

-- CreateEnum
CREATE TYPE "rating_frequency" AS ENUM ('weekly', 'monthly');

-- CreateEnum
CREATE TYPE "rater_kind" AS ENUM ('manager', 'self', 'project_peer', 'job_role', 'assigned');

-- CreateEnum
CREATE TYPE "objection_status" AS ENUM ('open', 'upheld', 'rejected');

-- CreateEnum
CREATE TYPE "okr_cycle_status" AS ENUM ('draft', 'active', 'closed');

-- CreateEnum
CREATE TYPE "objective_status" AS ENUM ('proposed', 'approved', 'archived');

-- CreateEnum
CREATE TYPE "key_result_kind" AS ENUM ('milestone', 'count', 'percent', 'lower_better', 'kpi_linked');

-- CreateEnum
CREATE TYPE "key_result_source" AS ENUM ('metric', 'tasks', 'manual');

-- CreateTable
CREATE TABLE "work_logs" (
    "id" UUID NOT NULL,
    "kind" "work_log_kind" NOT NULL,
    "user_id" UUID NOT NULL,
    "project_id" UUID,
    "task_id" UUID,
    "occurred_on" DATE NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "link" TEXT,
    "evidence_path" TEXT,
    "evidence_name" TEXT,
    "value" DECIMAL(12,2),
    "total" DECIMAL(12,2),
    "status" "work_log_status" NOT NULL DEFAULT 'submitted',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ,
    "review_note" TEXT,
    "response_due" DATE,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metrics" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "definition" JSONB NOT NULL,
    "direction" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT '',
    "manual" BOOLEAN NOT NULL DEFAULT false,
    "status" "definition_status" NOT NULL DEFAULT 'active',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rating_forms" (
    "id" UUID NOT NULL,
    "metric_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "frequency" "rating_frequency" NOT NULL DEFAULT 'monthly',
    "rater_kind" "rater_kind" NOT NULL,
    "rater_job_role_id" UUID,
    "needs_approval" BOOLEAN NOT NULL DEFAULT false,
    "status" "definition_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rating_forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rating_criteria" (
    "id" UUID NOT NULL,
    "form_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "scale" TEXT[],
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "rating_criteria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rating_form_raters" (
    "form_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "rater_id" UUID NOT NULL,

    CONSTRAINT "rating_form_raters_pkey" PRIMARY KEY ("form_id","subject_id","rater_id")
);

-- CreateTable
CREATE TABLE "rating_responses" (
    "id" UUID NOT NULL,
    "form_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "rater_id" UUID NOT NULL,
    "period_start" DATE NOT NULL,
    "scores" JSONB NOT NULL,
    "average" DECIMAL(4,2) NOT NULL,
    "comment" TEXT,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rating_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manual_entries" (
    "id" UUID NOT NULL,
    "metric_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "occurred_on" DATE NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "evidence_url" TEXT,
    "evidence_path" TEXT,
    "note" TEXT,
    "recorded_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "manual_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_templates" (
    "id" UUID NOT NULL,
    "lineage_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "kind" "kpi_item_kind" NOT NULL DEFAULT 'core',
    "description" TEXT,
    "status" "definition_status" NOT NULL DEFAULT 'draft',
    "effective_from" DATE,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activated_at" TIMESTAMPTZ,
    "archived_at" TIMESTAMPTZ,

    CONSTRAINT "kpi_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_items" (
    "id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "metric_id" UUID NOT NULL,
    "target" DECIMAL(12,2),
    "target_per" TEXT NOT NULL DEFAULT 'month',
    "score_period" "score_period" NOT NULL DEFAULT 'monthly',
    "weight" DECIMAL(6,2) NOT NULL DEFAULT 1,
    "record_only" BOOLEAN NOT NULL DEFAULT false,
    "tag" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "kpi_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_assignments" (
    "id" UUID NOT NULL,
    "lineage_id" UUID NOT NULL,
    "kind" "kpi_item_kind" NOT NULL DEFAULT 'core',
    "job_role_id" UUID,
    "user_id" UUID,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kpi_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_results" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "period_kind" "score_period" NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "items" JSONB NOT NULL,
    "score" DECIMAL(5,2),
    "grade" TEXT,
    "calibration" BOOLEAN NOT NULL DEFAULT false,
    "computed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kpi_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_objections" (
    "id" UUID NOT NULL,
    "result_id" UUID NOT NULL,
    "metric_key" TEXT,
    "reason" TEXT NOT NULL,
    "status" "objection_status" NOT NULL DEFAULT 'open',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ,
    "decision_note" TEXT,

    CONSTRAINT "kpi_objections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "okr_cycles" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" "okr_cycle_status" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "okr_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "objectives" (
    "id" UUID NOT NULL,
    "cycle_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "is_studio" BOOLEAN NOT NULL DEFAULT false,
    "parent_id" UUID,
    "status" "objective_status" NOT NULL DEFAULT 'proposed',
    "proposed_by" UUID,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "objectives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "objective_owners" (
    "objective_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,

    CONSTRAINT "objective_owners_pkey" PRIMARY KEY ("objective_id","user_id")
);

-- CreateTable
CREATE TABLE "key_results" (
    "id" UUID NOT NULL,
    "objective_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "kind" "key_result_kind" NOT NULL,
    "source" "key_result_source" NOT NULL DEFAULT 'manual',
    "metric_id" UUID,
    "start_value" DECIMAL(12,2),
    "target_value" DECIMAL(12,2),
    "unit" TEXT NOT NULL DEFAULT '',
    "done_definition" TEXT,
    "approver_id" UUID,
    "done_at" TIMESTAMPTZ,
    "done_approved_by" UUID,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "key_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kr_links" (
    "key_result_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,

    CONSTRAINT "kr_links_pkey" PRIMARY KEY ("key_result_id","task_id")
);

-- CreateTable
CREATE TABLE "kr_checkins" (
    "id" UUID NOT NULL,
    "key_result_id" UUID NOT NULL,
    "month" DATE NOT NULL,
    "value" DECIMAL(12,2),
    "note" TEXT,
    "evidence_url" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kr_checkins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "work_logs_user_id_kind_occurred_on_idx" ON "work_logs"("user_id", "kind", "occurred_on");

-- CreateIndex
CREATE INDEX "work_logs_status_kind_idx" ON "work_logs"("status", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "metrics_key_key" ON "metrics"("key");

-- CreateIndex
CREATE UNIQUE INDEX "rating_responses_form_id_subject_id_rater_id_period_start_key" ON "rating_responses"("form_id", "subject_id", "rater_id", "period_start");

-- CreateIndex
CREATE INDEX "manual_entries_metric_id_user_id_occurred_on_idx" ON "manual_entries"("metric_id", "user_id", "occurred_on");

-- CreateIndex
CREATE INDEX "kpi_templates_lineage_id_status_idx" ON "kpi_templates"("lineage_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "kpi_templates_lineage_id_version_key" ON "kpi_templates"("lineage_id", "version");

-- CreateIndex
CREATE INDEX "kpi_assignments_lineage_id_idx" ON "kpi_assignments"("lineage_id");

-- CreateIndex
CREATE UNIQUE INDEX "kpi_results_user_id_period_kind_period_start_key" ON "kpi_results"("user_id", "period_kind", "period_start");

-- CreateIndex
CREATE UNIQUE INDEX "okr_cycles_name_key" ON "okr_cycles"("name");

-- CreateIndex
CREATE INDEX "objectives_cycle_id_idx" ON "objectives"("cycle_id");

-- CreateIndex
CREATE UNIQUE INDEX "kr_checkins_key_result_id_month_key" ON "kr_checkins"("key_result_id", "month");

-- AddForeignKey
ALTER TABLE "work_logs" ADD CONSTRAINT "work_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_logs" ADD CONSTRAINT "work_logs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_logs" ADD CONSTRAINT "work_logs_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_logs" ADD CONSTRAINT "work_logs_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_logs" ADD CONSTRAINT "work_logs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rating_forms" ADD CONSTRAINT "rating_forms_metric_id_fkey" FOREIGN KEY ("metric_id") REFERENCES "metrics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rating_criteria" ADD CONSTRAINT "rating_criteria_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "rating_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rating_form_raters" ADD CONSTRAINT "rating_form_raters_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "rating_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rating_form_raters" ADD CONSTRAINT "rating_form_raters_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rating_form_raters" ADD CONSTRAINT "rating_form_raters_rater_id_fkey" FOREIGN KEY ("rater_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rating_responses" ADD CONSTRAINT "rating_responses_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "rating_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rating_responses" ADD CONSTRAINT "rating_responses_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rating_responses" ADD CONSTRAINT "rating_responses_rater_id_fkey" FOREIGN KEY ("rater_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_entries" ADD CONSTRAINT "manual_entries_metric_id_fkey" FOREIGN KEY ("metric_id") REFERENCES "metrics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_entries" ADD CONSTRAINT "manual_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_entries" ADD CONSTRAINT "manual_entries_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_items" ADD CONSTRAINT "kpi_items_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "kpi_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_items" ADD CONSTRAINT "kpi_items_metric_id_fkey" FOREIGN KEY ("metric_id") REFERENCES "metrics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_assignments" ADD CONSTRAINT "kpi_assignments_job_role_id_fkey" FOREIGN KEY ("job_role_id") REFERENCES "job_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_assignments" ADD CONSTRAINT "kpi_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_results" ADD CONSTRAINT "kpi_results_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_objections" ADD CONSTRAINT "kpi_objections_result_id_fkey" FOREIGN KEY ("result_id") REFERENCES "kpi_results"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_objections" ADD CONSTRAINT "kpi_objections_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_objections" ADD CONSTRAINT "kpi_objections_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "objectives" ADD CONSTRAINT "objectives_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "okr_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "objectives" ADD CONSTRAINT "objectives_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "objectives"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "objective_owners" ADD CONSTRAINT "objective_owners_objective_id_fkey" FOREIGN KEY ("objective_id") REFERENCES "objectives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "objective_owners" ADD CONSTRAINT "objective_owners_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "key_results" ADD CONSTRAINT "key_results_objective_id_fkey" FOREIGN KEY ("objective_id") REFERENCES "objectives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "key_results" ADD CONSTRAINT "key_results_metric_id_fkey" FOREIGN KEY ("metric_id") REFERENCES "metrics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "key_results" ADD CONSTRAINT "key_results_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kr_links" ADD CONSTRAINT "kr_links_key_result_id_fkey" FOREIGN KEY ("key_result_id") REFERENCES "key_results"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kr_links" ADD CONSTRAINT "kr_links_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kr_checkins" ADD CONSTRAINT "kr_checkins_key_result_id_fkey" FOREIGN KEY ("key_result_id") REFERENCES "key_results"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- ===========================================================================
-- Phase 2 · M7 KPI & OKR — rules and Row Level Security
-- ===========================================================================

ALTER TABLE public.work_logs
  ADD CONSTRAINT work_logs_title_present CHECK (length(btrim(title)) > 0),
  ADD CONSTRAINT work_logs_link_format CHECK (link IS NULL OR link ~* '^https?://');
ALTER TABLE public.metrics
  ADD CONSTRAINT metrics_key_format CHECK (key ~ '^[a-z][a-z0-9_]*$'),
  ADD CONSTRAINT metrics_direction CHECK (direction IN ('higher', 'lower', 'record'));
ALTER TABLE public.rating_criteria
  ADD CONSTRAINT rating_criteria_scale CHECK (cardinality(scale) = 5);
ALTER TABLE public.manual_entries
  ADD CONSTRAINT manual_entries_evidence CHECK (evidence_url IS NOT NULL OR evidence_path IS NOT NULL);
ALTER TABLE public.kpi_items
  ADD CONSTRAINT kpi_items_target_per CHECK (target_per IN ('week', 'month', 'semester')),
  ADD CONSTRAINT kpi_items_weight CHECK (weight >= 0);
ALTER TABLE public.kpi_assignments
  ADD CONSTRAINT kpi_assignments_target CHECK ((job_role_id IS NULL) <> (user_id IS NULL)),
  ADD CONSTRAINT kpi_assignments_range CHECK (ends_on IS NULL OR ends_on >= starts_on);
ALTER TABLE public.okr_cycles ADD CONSTRAINT okr_cycles_range CHECK (end_date > start_date);
ALTER TABLE public.kr_checkins ADD CONSTRAINT kr_checkins_month CHECK (extract(day FROM month) = 1);

-- Who sees a person's KPI (PRD "Visibilitas KPI"): the person, their managers
-- up the line, and the People and Studio Report modules.
CREATE OR REPLACE FUNCTION app.can_view_kpi(uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT app.user_role() IS NOT NULL
     AND (uid = app.uid() OR app.is_manager_of(uid) OR app.has_module('people', 'studio_report'))
$$;

-- Who approves a log entry: the person's managers, the People module, the
-- project's PM, C-Level — never the person themselves.
CREATE OR REPLACE FUNCTION app.can_review_log(subject uuid, pid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT app.user_role() IS NOT NULL AND subject <> app.uid() AND (
    app.is_manager_of(subject) OR app.has_module('people') OR app.has_role('c_level')
    OR (pid IS NOT NULL AND app.can_manage_project(pid))
  )
$$;

-- ---------------------------------------------------------------------------
-- Work logs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.work_logs_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := coalesce(app.uid(), NEW.created_by);
    IF app.via_rls() THEN
      NEW.status := 'submitted';
      NEW.reviewed_by := NULL;
      NEW.reviewed_at := NULL;
    END IF;
    -- Ideas are answered within 3 working days, or they count anyway.
    IF NEW.kind = 'idea' THEN
      NEW.response_due := (app.add_workdays(now(), 3) AT TIME ZONE 'Asia/Jakarta')::date;
    END IF;
    RETURN NEW;
  END IF;
  IF NOT app.via_rls() THEN
    RETURN NEW;
  END IF;
  IF NEW.user_id <> OLD.user_id OR NEW.kind <> OLD.kind OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'A log entry can''t change whose or what it is' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT app.can_review_log(OLD.user_id, OLD.project_id) THEN
      RAISE EXCEPTION 'Only their manager, the project''s PM or the People module can review this entry' USING ERRCODE = '42501';
    END IF;
    NEW.reviewed_by := app.uid();
    NEW.reviewed_at := now();
  ELSIF (NEW.reviewed_by, NEW.reviewed_at) IS DISTINCT FROM (OLD.reviewed_by, OLD.reviewed_at) THEN
    RAISE EXCEPTION 'The review can''t be rewritten' USING ERRCODE = '42501';
  ELSIF OLD.status <> 'submitted' AND NOT app.has_module('people') THEN
    RAISE EXCEPTION 'A reviewed entry is locked' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER work_logs_guard BEFORE INSERT OR UPDATE ON public.work_logs
  FOR EACH ROW EXECUTE FUNCTION app.work_logs_guard();

-- ---------------------------------------------------------------------------
-- KPI templates: a version is edited only as a draft; activating it starts it
-- at the next month and archives the version it replaces.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.kpi_templates_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := coalesce(app.uid(), NEW.created_by);
    IF app.via_rls() THEN
      NEW.status := 'draft';
      NEW.activated_at := NULL;
      NEW.archived_at := NULL;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.lineage_id <> OLD.lineage_id OR NEW.version <> OLD.version THEN
    RAISE EXCEPTION 'A template version can''t move' USING ERRCODE = '42501';
  END IF;
  IF OLD.status <> 'draft' AND (NEW.name, NEW.kind, NEW.description) IS DISTINCT FROM (OLD.name, OLD.kind, OLD.description) THEN
    RAISE EXCEPTION 'An active template is locked — edit a new version' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'active' AND OLD.status = 'draft' THEN
      NEW.activated_at := now();
      NEW.effective_from := coalesce(NEW.effective_from,
        (date_trunc('month', (now() AT TIME ZONE 'Asia/Jakarta')) + interval '1 month')::date);
      UPDATE public.kpi_templates SET status = 'archived', archived_at = now()
      WHERE lineage_id = NEW.lineage_id AND id <> NEW.id AND status = 'active';
    ELSIF NEW.status = 'archived' THEN
      NEW.archived_at := now();
    ELSE
      RAISE EXCEPTION 'A template goes draft → active → archived' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER kpi_templates_guard BEFORE INSERT OR UPDATE ON public.kpi_templates
  FOR EACH ROW EXECUTE FUNCTION app.kpi_templates_guard();

CREATE OR REPLACE FUNCTION app.kpi_items_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  tid uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.template_id ELSE NEW.template_id END;
BEGIN
  IF app.via_rls() AND (SELECT t.status FROM public.kpi_templates t WHERE t.id = tid) <> 'draft' THEN
    RAISE EXCEPTION 'An active template is locked — edit a new version' USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER kpi_items_guard BEFORE INSERT OR UPDATE OR DELETE ON public.kpi_items
  FOR EACH ROW EXECUTE FUNCTION app.kpi_items_guard();

-- ---------------------------------------------------------------------------
-- Ratings: only an eligible rater, a comment under 3, the average derived.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.rating_responses_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  f public.rating_forms;
  vals numeric[];
  period_end date;
  eligible boolean;
BEGIN
  SELECT * INTO f FROM public.rating_forms WHERE id = NEW.form_id;
  SELECT array_agg(v::numeric) INTO vals FROM jsonb_each_text(NEW.scores) AS s(k, v);
  IF vals IS NULL OR EXISTS (SELECT 1 FROM unnest(vals) x WHERE x NOT IN (1, 2, 3, 4, 5)) THEN
    RAISE EXCEPTION 'Score every criterion from 1 to 5' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(vals) x WHERE x < 3) AND length(btrim(coalesce(NEW.comment, ''))) = 0 THEN
    RAISE EXCEPTION 'A comment is required for a score under 3' USING ERRCODE = '23514';
  END IF;
  NEW.average := (SELECT round(avg(x), 2) FROM unnest(vals) x);
  IF NOT app.via_rls() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.form_id, NEW.subject_id, NEW.rater_id, NEW.period_start)
     IS DISTINCT FROM (OLD.form_id, OLD.subject_id, OLD.rater_id, OLD.period_start) THEN
    RAISE EXCEPTION 'A rating can''t move' USING ERRCODE = '42501';
  END IF;
  IF (NEW.approved_by, NEW.approved_at) IS DISTINCT FROM (CASE WHEN TG_OP = 'UPDATE' THEN OLD.approved_by END, CASE WHEN TG_OP = 'UPDATE' THEN OLD.approved_at END) THEN
    IF NOT app.has_module('people') OR NEW.subject_id = app.uid() THEN
      RAISE EXCEPTION 'Only the People module approves a self-assessment' USING ERRCODE = '42501';
    END IF;
    NEW.approved_by := app.uid();
    NEW.approved_at := now();
    RETURN NEW;
  END IF;
  IF NEW.rater_id <> app.uid() THEN
    RAISE EXCEPTION 'You can only submit your own ratings' USING ERRCODE = '42501';
  END IF;
  period_end := CASE WHEN f.frequency = 'weekly' THEN NEW.period_start + 6 ELSE (NEW.period_start + interval '1 month' - interval '1 day')::date END;
  eligible := CASE f.rater_kind
    WHEN 'self' THEN NEW.subject_id = app.uid()
    WHEN 'manager' THEN EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = NEW.subject_id AND p.manager_id = app.uid())
    WHEN 'job_role' THEN NEW.subject_id <> app.uid() AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = app.uid() AND p.job_role_id = f.rater_job_role_id)
    WHEN 'assigned' THEN EXISTS (SELECT 1 FROM public.rating_form_raters r WHERE r.form_id = f.id AND r.subject_id = NEW.subject_id AND r.rater_id = app.uid())
    WHEN 'project_peer' THEN NEW.subject_id <> app.uid() AND EXISTS (
      SELECT 1 FROM (
        SELECT t.project_id FROM public.tasks t WHERE t.owner_id = NEW.subject_id AND t.updated_at::date BETWEEN NEW.period_start AND period_end
        UNION SELECT e.project_id FROM public.time_entries e WHERE e.user_id = NEW.subject_id AND e.project_id IS NOT NULL AND e.entry_date BETWEEN NEW.period_start AND period_end
      ) theirs JOIN (
        SELECT t.project_id FROM public.tasks t WHERE t.owner_id = app.uid() AND t.updated_at::date BETWEEN NEW.period_start AND period_end
        UNION SELECT e.project_id FROM public.time_entries e WHERE e.user_id = app.uid() AND e.project_id IS NOT NULL AND e.entry_date BETWEEN NEW.period_start AND period_end
      ) mine USING (project_id))
  END;
  IF NOT coalesce(eligible, false) THEN
    RAISE EXCEPTION 'You aren''t a rater for this person on this form' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.approved_at IS NOT NULL THEN
    RAISE EXCEPTION 'An approved rating is locked' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER rating_responses_guard BEFORE INSERT OR UPDATE ON public.rating_responses
  FOR EACH ROW EXECUTE FUNCTION app.rating_responses_guard();

-- Manual entries keep who recorded them.
CREATE OR REPLACE FUNCTION app.manual_entries_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.recorded_by := coalesce(app.uid(), NEW.recorded_by);
  RETURN NEW;
END $$;
CREATE TRIGGER manual_entries_guard BEFORE INSERT ON public.manual_entries
  FOR EACH ROW EXECUTE FUNCTION app.manual_entries_guard();

-- Objections: your own result, within 7 days of it being recorded; decided by People.
CREATE OR REPLACE FUNCTION app.kpi_objections_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r public.kpi_results;
BEGIN
  SELECT * INTO r FROM public.kpi_results WHERE id = NEW.result_id;
  IF TG_OP = 'INSERT' THEN
    IF app.via_rls() THEN
      IF r.user_id <> app.uid() THEN
        RAISE EXCEPTION 'You can only object to your own KPI' USING ERRCODE = '42501';
      END IF;
      IF now() > r.computed_at + interval '7 days' THEN
        RAISE EXCEPTION 'Objections close 7 days after the score is recorded' USING ERRCODE = '23514';
      END IF;
    END IF;
    NEW.created_by := coalesce(app.uid(), NEW.created_by);
    NEW.status := 'open';
    NEW.decided_by := NULL;
    NEW.decided_at := NULL;
    RETURN NEW;
  END IF;
  IF (NEW.result_id, NEW.reason, NEW.created_by) IS DISTINCT FROM (OLD.result_id, OLD.reason, OLD.created_by) THEN
    RAISE EXCEPTION 'An objection can''t be rewritten' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status <> 'open' THEN
      RAISE EXCEPTION 'This objection was already decided' USING ERRCODE = '42501';
    END IF;
    IF app.via_rls() AND NOT app.has_module('people') THEN
      RAISE EXCEPTION 'The People module decides objections' USING ERRCODE = '42501';
    END IF;
    NEW.decided_by := coalesce(app.uid(), NEW.decided_by);
    NEW.decided_at := now();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER kpi_objections_guard BEFORE INSERT OR UPDATE ON public.kpi_objections
  FOR EACH ROW EXECUTE FUNCTION app.kpi_objections_guard();

-- ---------------------------------------------------------------------------
-- OKR: members draft their own, managers propose for the team, the People
-- module approves; studio objectives belong to Studio Report.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.can_edit_objective(oid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT app.user_role() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.objectives o WHERE o.id = oid AND (
      app.has_module('people')
      OR (o.is_studio AND app.has_module('studio_report'))
      OR (o.status = 'proposed' AND (o.proposed_by = app.uid()
          OR EXISTS (SELECT 1 FROM public.objective_owners w WHERE w.objective_id = o.id AND w.user_id = app.uid())))
    )
  )
$$;

CREATE OR REPLACE FUNCTION app.is_objective_owner(oid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.objective_owners w WHERE w.objective_id = oid AND w.user_id = app.uid())
$$;

CREATE OR REPLACE FUNCTION app.objectives_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.proposed_by := coalesce(app.uid(), NEW.proposed_by);
    IF app.via_rls() THEN
      IF NEW.is_studio AND NOT app.has_module('studio_report') THEN
        RAISE EXCEPTION 'Studio objectives come from Studio Report' USING ERRCODE = '42501';
      END IF;
      -- Studio objectives and the People module's own start approved.
      IF NEW.is_studio OR app.has_module('people') THEN
        NEW.status := 'approved';
        NEW.approved_by := app.uid();
        NEW.approved_at := now();
      ELSE
        NEW.status := 'proposed';
        NEW.approved_by := NULL;
        NEW.approved_at := NULL;
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF NOT app.via_rls() THEN
    RETURN NEW;
  END IF;
  IF NEW.is_studio <> OLD.is_studio OR NEW.cycle_id <> OLD.cycle_id OR NEW.proposed_by IS DISTINCT FROM OLD.proposed_by THEN
    RAISE EXCEPTION 'These objective fields are fixed' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'approved' AND NOT (app.has_module('people') OR (OLD.is_studio AND app.has_module('studio_report'))) THEN
      RAISE EXCEPTION 'The People module approves objectives' USING ERRCODE = '42501';
    END IF;
    IF NEW.status = 'approved' THEN
      NEW.approved_by := app.uid();
      NEW.approved_at := now();
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER objectives_guard BEFORE INSERT OR UPDATE ON public.objectives
  FOR EACH ROW EXECUTE FUNCTION app.objectives_guard();

-- Key results: editors change everything; the owners mark a milestone done;
-- its approver (the direct manager) confirms it.
CREATE OR REPLACE FUNCTION app.key_results_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT app.via_rls() OR app.can_edit_objective(NEW.objective_id) THEN
    IF NEW.done_approved_by IS DISTINCT FROM OLD.done_approved_by AND NEW.done_approved_by IS NOT NULL
       AND NEW.approver_id IS DISTINCT FROM app.uid() AND app.via_rls() AND NOT app.has_module('people') THEN
      RAISE EXCEPTION 'Only the key result''s approver confirms it' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.objective_id, NEW.title, NEW.kind, NEW.source, NEW.metric_id, NEW.start_value, NEW.target_value, NEW.unit, NEW.done_definition, NEW.approver_id, NEW.position)
     IS DISTINCT FROM (OLD.objective_id, OLD.title, OLD.kind, OLD.source, OLD.metric_id, OLD.start_value, OLD.target_value, OLD.unit, OLD.done_definition, OLD.approver_id, OLD.position) THEN
    RAISE EXCEPTION 'An approved objective''s key results are changed by the People module' USING ERRCODE = '42501';
  END IF;
  IF NEW.done_approved_by IS DISTINCT FROM OLD.done_approved_by THEN
    IF NEW.done_approved_by IS NOT NULL AND (OLD.approver_id IS DISTINCT FROM app.uid() OR NEW.done_approved_by <> app.uid()) THEN
      RAISE EXCEPTION 'Only the key result''s approver confirms it' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.done_at IS DISTINCT FROM OLD.done_at AND NOT app.is_objective_owner(OLD.objective_id) THEN
    RAISE EXCEPTION 'Only the objective''s owners mark it done' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER key_results_guard BEFORE UPDATE ON public.key_results
  FOR EACH ROW EXECUTE FUNCTION app.key_results_guard();

CREATE OR REPLACE FUNCTION app.kr_checkins_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.created_by := coalesce(app.uid(), NEW.created_by);
  RETURN NEW;
END $$;
CREATE TRIGGER kr_checkins_guard BEFORE INSERT OR UPDATE ON public.kr_checkins
  FOR EACH ROW EXECUTE FUNCTION app.kr_checkins_guard();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE public.work_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rating_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rating_criteria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rating_form_raters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rating_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manual_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kpi_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kpi_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kpi_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kpi_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kpi_objections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.okr_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.objectives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.objective_owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.key_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kr_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kr_checkins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.work_logs, public.metrics, public.rating_forms, public.rating_criteria, public.rating_form_raters,
  public.rating_responses, public.manual_entries, public.kpi_templates, public.kpi_items, public.kpi_assignments,
  public.kpi_results, public.kpi_objections, public.okr_cycles, public.objectives, public.objective_owners,
  public.key_results, public.kr_links, public.kr_checkins FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_logs, public.metrics, public.rating_forms, public.rating_criteria,
  public.rating_form_raters, public.kpi_templates, public.kpi_items, public.kpi_assignments, public.objectives,
  public.objective_owners, public.key_results, public.kr_links, public.okr_cycles TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.rating_responses, public.kr_checkins, public.kpi_objections TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.manual_entries TO authenticated;
-- Results are snapshots written by the scheduled job only.
GRANT SELECT ON public.kpi_results TO authenticated;

CREATE POLICY work_logs_select ON public.work_logs FOR SELECT TO authenticated
  USING (app.can_view_kpi(user_id) OR reviewed_by = app.uid() OR (project_id IS NOT NULL AND app.can_manage_project(project_id)));
CREATE POLICY work_logs_insert ON public.work_logs FOR INSERT TO authenticated
  WITH CHECK (
    (user_id = app.uid() AND app.user_role() IS NOT NULL)
    OR app.is_manager_of(user_id) OR app.has_module('people')
    OR (project_id IS NOT NULL AND app.can_manage_project(project_id))
  );
CREATE POLICY work_logs_update ON public.work_logs FOR UPDATE TO authenticated
  USING (user_id = app.uid() OR app.can_review_log(user_id, project_id))
  WITH CHECK (user_id = app.uid() OR app.can_review_log(user_id, project_id));
CREATE POLICY work_logs_delete ON public.work_logs FOR DELETE TO authenticated
  USING ((user_id = app.uid() AND status = 'submitted') OR app.has_module('people'));

-- Definitions: everyone reads (people see how they're measured); People writes.
CREATE POLICY metrics_select ON public.metrics FOR SELECT TO authenticated USING (app.user_role() IS NOT NULL);
CREATE POLICY metrics_write ON public.metrics FOR ALL TO authenticated USING (app.has_module('people')) WITH CHECK (app.has_module('people'));
CREATE POLICY rating_forms_select ON public.rating_forms FOR SELECT TO authenticated USING (app.user_role() IS NOT NULL);
CREATE POLICY rating_forms_write ON public.rating_forms FOR ALL TO authenticated USING (app.has_module('people')) WITH CHECK (app.has_module('people'));
CREATE POLICY rating_criteria_select ON public.rating_criteria FOR SELECT TO authenticated USING (app.user_role() IS NOT NULL);
CREATE POLICY rating_criteria_write ON public.rating_criteria FOR ALL TO authenticated USING (app.has_module('people')) WITH CHECK (app.has_module('people'));
CREATE POLICY rating_form_raters_select ON public.rating_form_raters FOR SELECT TO authenticated
  USING (rater_id = app.uid() OR app.can_view_kpi(subject_id));
CREATE POLICY rating_form_raters_write ON public.rating_form_raters FOR ALL TO authenticated USING (app.has_module('people')) WITH CHECK (app.has_module('people'));
CREATE POLICY kpi_templates_select ON public.kpi_templates FOR SELECT TO authenticated USING (app.user_role() IS NOT NULL);
CREATE POLICY kpi_templates_write ON public.kpi_templates FOR ALL TO authenticated USING (app.has_module('people')) WITH CHECK (app.has_module('people'));
CREATE POLICY kpi_items_select ON public.kpi_items FOR SELECT TO authenticated USING (app.user_role() IS NOT NULL);
CREATE POLICY kpi_items_write ON public.kpi_items FOR ALL TO authenticated USING (app.has_module('people')) WITH CHECK (app.has_module('people'));
CREATE POLICY kpi_assignments_select ON public.kpi_assignments FOR SELECT TO authenticated USING (app.user_role() IS NOT NULL);
CREATE POLICY kpi_assignments_write ON public.kpi_assignments FOR ALL TO authenticated USING (app.has_module('people')) WITH CHECK (app.has_module('people'));

-- Individual ratings: the rater, the subject's managers and People / Studio
-- Report — the subject sees their score in the KPI result, not who gave what.
CREATE POLICY rating_responses_select ON public.rating_responses FOR SELECT TO authenticated
  USING (rater_id = app.uid() OR app.is_manager_of(subject_id) OR app.has_module('people', 'studio_report'));
CREATE POLICY rating_responses_insert ON public.rating_responses FOR INSERT TO authenticated
  WITH CHECK (rater_id = app.uid() AND app.user_role() IS NOT NULL);
CREATE POLICY rating_responses_update ON public.rating_responses FOR UPDATE TO authenticated
  USING (rater_id = app.uid() OR app.has_module('people')) WITH CHECK (rater_id = app.uid() OR app.has_module('people'));

CREATE POLICY manual_entries_select ON public.manual_entries FOR SELECT TO authenticated
  USING (app.can_view_kpi(user_id) OR recorded_by = app.uid());
CREATE POLICY manual_entries_insert ON public.manual_entries FOR INSERT TO authenticated
  WITH CHECK ((user_id = app.uid() AND app.user_role() IS NOT NULL) OR app.is_manager_of(user_id) OR app.has_module('people'));
CREATE POLICY manual_entries_delete ON public.manual_entries FOR DELETE TO authenticated
  USING (recorded_by = app.uid() OR app.has_module('people'));

CREATE POLICY kpi_results_select ON public.kpi_results FOR SELECT TO authenticated USING (app.can_view_kpi(user_id));
CREATE POLICY kpi_objections_select ON public.kpi_objections FOR SELECT TO authenticated
  USING (created_by = app.uid() OR EXISTS (SELECT 1 FROM public.kpi_results r WHERE r.id = result_id AND app.can_view_kpi(r.user_id)));
CREATE POLICY kpi_objections_insert ON public.kpi_objections FOR INSERT TO authenticated
  WITH CHECK (created_by = app.uid());
CREATE POLICY kpi_objections_update ON public.kpi_objections FOR UPDATE TO authenticated
  USING (app.has_module('people')) WITH CHECK (app.has_module('people'));

-- OKRs are open to the studio; who writes is in the guards above.
CREATE POLICY okr_cycles_select ON public.okr_cycles FOR SELECT TO authenticated USING (app.user_role() IS NOT NULL);
CREATE POLICY okr_cycles_write ON public.okr_cycles FOR ALL TO authenticated
  USING (app.has_module('people', 'studio_report')) WITH CHECK (app.has_module('people', 'studio_report'));
CREATE POLICY objectives_select ON public.objectives FOR SELECT TO authenticated USING (app.user_role() IS NOT NULL);
CREATE POLICY objectives_insert ON public.objectives FOR INSERT TO authenticated WITH CHECK (app.user_role() IS NOT NULL);
CREATE POLICY objectives_update ON public.objectives FOR UPDATE TO authenticated
  USING (app.can_edit_objective(id)) WITH CHECK (app.user_role() IS NOT NULL);
CREATE POLICY objectives_delete ON public.objectives FOR DELETE TO authenticated
  USING (app.has_module('people') OR (status = 'proposed' AND proposed_by = app.uid()));
CREATE POLICY objective_owners_select ON public.objective_owners FOR SELECT TO authenticated USING (app.user_role() IS NOT NULL);
CREATE POLICY objective_owners_write ON public.objective_owners FOR ALL TO authenticated
  USING (app.can_edit_objective(objective_id)) WITH CHECK (app.can_edit_objective(objective_id));
CREATE POLICY key_results_select ON public.key_results FOR SELECT TO authenticated USING (app.user_role() IS NOT NULL);
CREATE POLICY key_results_insert ON public.key_results FOR INSERT TO authenticated WITH CHECK (app.can_edit_objective(objective_id));
CREATE POLICY key_results_update ON public.key_results FOR UPDATE TO authenticated
  USING (app.can_edit_objective(objective_id) OR app.is_objective_owner(objective_id) OR approver_id = app.uid())
  WITH CHECK (app.user_role() IS NOT NULL);
CREATE POLICY key_results_delete ON public.key_results FOR DELETE TO authenticated USING (app.can_edit_objective(objective_id));
CREATE POLICY kr_links_select ON public.kr_links FOR SELECT TO authenticated USING (app.user_role() IS NOT NULL);
CREATE POLICY kr_links_write ON public.kr_links FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.key_results k WHERE k.id = key_result_id AND app.can_edit_objective(k.objective_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.key_results k WHERE k.id = key_result_id AND app.can_edit_objective(k.objective_id)));
CREATE POLICY kr_checkins_select ON public.kr_checkins FOR SELECT TO authenticated USING (app.user_role() IS NOT NULL);
CREATE POLICY kr_checkins_write ON public.kr_checkins FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.key_results k WHERE k.id = key_result_id AND (app.is_objective_owner(k.objective_id) OR app.has_module('people'))));
CREATE POLICY kr_checkins_update ON public.kr_checkins FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.key_results k WHERE k.id = key_result_id AND (app.is_objective_owner(k.objective_id) OR app.has_module('people'))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.key_results k WHERE k.id = key_result_id AND (app.is_objective_owner(k.objective_id) OR app.has_module('people'))));
