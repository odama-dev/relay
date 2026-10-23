-- CreateEnum
CREATE TYPE "division" AS ENUM ('design', 'development', 'project', 'sales', 'people', 'finance', 'executive');

-- CreateEnum
CREATE TYPE "access_level" AS ENUM ('manager', 'member');

-- CreateEnum
CREATE TYPE "app_module" AS ENUM ('people', 'finance', 'sales', 'studio_report');

-- CreateEnum
CREATE TYPE "review_decision" AS ENUM ('approved', 'changes_requested');

-- CreateEnum
CREATE TYPE "attendance_status" AS ENUM ('present', 'remote', 'off');

-- AlterTable
ALTER TABLE "profiles" ADD COLUMN     "access_level" "access_level" NOT NULL DEFAULT 'member',
ADD COLUMN     "division" "division",
ADD COLUMN     "job_role_id" UUID,
ADD COLUMN     "job_title" TEXT,
ADD COLUMN     "level" SMALLINT,
ADD COLUMN     "manager_id" UUID;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "approved_at" TIMESTAMPTZ,
ADD COLUMN     "deliverable_url" TEXT,
ADD COLUMN     "original_due_date" DATE,
ADD COLUMN     "reviewer_id" UUID,
ADD COLUMN     "type_id" UUID;

-- CreateTable
CREATE TABLE "job_roles" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "division" "division" NOT NULL,
    "level" SMALLINT NOT NULL,
    "default_access" "access_level" NOT NULL DEFAULT 'member',
    "default_modules" "app_module"[] DEFAULT ARRAY[]::"app_module"[],
    "has_okr" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "module_grants" (
    "user_id" UUID NOT NULL,
    "module" "app_module" NOT NULL,
    "granted_by" UUID,
    "granted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "module_grants_pkey" PRIMARY KEY ("user_id","module")
);

-- CreateTable
CREATE TABLE "task_types" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_rounds" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "reviewer_id" UUID,
    "submitted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sla_due_at" TIMESTAMPTZ NOT NULL,
    "decided_at" TIMESTAMPTZ,
    "decided_by" UUID,
    "decision" "review_decision",
    "note" TEXT,
    "sla_notified_at" TIMESTAMPTZ,

    CONSTRAINT "review_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "due_date_changes" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "from_date" DATE,
    "to_date" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "requested_by" UUID,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "due_date_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public_holidays" (
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "public_holidays_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "attendance" (
    "user_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "status" "attendance_status" NOT NULL,
    "checked_in_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "attendance_pkey" PRIMARY KEY ("user_id","date")
);

-- CreateIndex
CREATE UNIQUE INDEX "job_roles_name_key" ON "job_roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "task_types_name_key" ON "task_types"("name");

-- CreateIndex
CREATE UNIQUE INDEX "task_types_key_key" ON "task_types"("key");

-- CreateIndex
CREATE INDEX "review_rounds_task_id_submitted_at_idx" ON "review_rounds"("task_id", "submitted_at");

-- CreateIndex
CREATE INDEX "review_rounds_reviewer_id_decided_at_idx" ON "review_rounds"("reviewer_id", "decided_at");

-- CreateIndex
CREATE INDEX "due_date_changes_task_id_idx" ON "due_date_changes"("task_id");

-- CreateIndex
CREATE INDEX "profiles_manager_id_idx" ON "profiles"("manager_id");

-- CreateIndex
CREATE INDEX "tasks_reviewer_id_idx" ON "tasks"("reviewer_id");

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_job_role_id_fkey" FOREIGN KEY ("job_role_id") REFERENCES "job_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "task_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "module_grants" ADD CONSTRAINT "module_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "module_grants" ADD CONSTRAINT "module_grants_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_rounds" ADD CONSTRAINT "review_rounds_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_rounds" ADD CONSTRAINT "review_rounds_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "due_date_changes" ADD CONSTRAINT "due_date_changes_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "due_date_changes" ADD CONSTRAINT "due_date_changes_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "due_date_changes" ADD CONSTRAINT "due_date_changes_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ===========================================================================
-- Phase 2 · M6 Foundation (PRD/PRD_Fase-2.md "Role & akses", "Task sebagai
-- sumber kebenaran"). The six `user_role` values stay as dashboard presets and
-- keep driving the Phase 1 policies; new tables use modules, access and the
-- reporting line (decision in docs/DECISIONS.md "Phase 2 roles").
-- ===========================================================================

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_level_range CHECK (level IS NULL OR level BETWEEN 1 AND 5),
  ADD CONSTRAINT profiles_not_own_manager CHECK (manager_id IS NULL OR manager_id <> id);
ALTER TABLE public.job_roles
  ADD CONSTRAINT job_roles_level_range CHECK (level BETWEEN 1 AND 5),
  ADD CONSTRAINT job_roles_name_present CHECK (length(btrim(name)) > 0);
ALTER TABLE public.task_types
  ADD CONSTRAINT task_types_name_present CHECK (length(btrim(name)) > 0),
  ADD CONSTRAINT task_types_key_format CHECK (key ~ '^[a-z][a-z0-9_]*$');
ALTER TABLE public.due_date_changes
  ADD CONSTRAINT due_date_changes_reason_present CHECK (length(btrim(reason)) > 0);
ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_deliverable_url_format CHECK (deliverable_url IS NULL OR deliverable_url ~* '^https?://');

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The signed-in user holds one of the modules. Admins hold every module.
CREATE OR REPLACE FUNCTION app.has_module(VARIADIC mods public.app_module[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT app.user_role() IS NOT NULL AND (
    app.is_admin()
    OR EXISTS (SELECT 1 FROM public.module_grants g WHERE g.user_id = app.uid() AND g.module = ANY (mods))
  )
$$;

-- The signed-in user is `uid`'s manager, directly or further up the line.
CREATE OR REPLACE FUNCTION app.is_manager_of(uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH RECURSIVE line(id, depth) AS (
    SELECT p.manager_id, 1 FROM public.profiles p WHERE p.id = uid
    UNION ALL
    SELECT p.manager_id, l.depth + 1 FROM line l JOIN public.profiles p ON p.id = l.id
    WHERE l.depth < 12
  )
  SELECT app.user_role() IS NOT NULL AND EXISTS (SELECT 1 FROM line WHERE id = app.uid())
$$;

-- `d` is a working day: Monday–Friday and not a public holiday.
CREATE OR REPLACE FUNCTION app.is_workday(d date) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT extract(isodow FROM d) BETWEEN 1 AND 5
     AND NOT EXISTS (SELECT 1 FROM public.public_holidays h WHERE h.date = d)
$$;

-- `ts` moved forward by `n` working days, same wall-clock time (Asia/Jakarta).
CREATE OR REPLACE FUNCTION app.add_workdays(ts timestamptz, n int) RETURNS timestamptz
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  local timestamp := ts AT TIME ZONE 'Asia/Jakarta';
  d date := local::date;
  left_ int := n;
BEGIN
  WHILE left_ > 0 LOOP
    d := d + 1;
    IF app.is_workday(d) THEN
      left_ := left_ - 1;
    END IF;
  END LOOP;
  RETURN (d + local::time) AT TIME ZONE 'Asia/Jakarta';
END $$;

-- ---------------------------------------------------------------------------
-- Profiles: presets from the role, who changes the Phase 2 fields
-- ---------------------------------------------------------------------------

-- A new profile gets the division and access of its role preset when the
-- inviter didn't set them.
CREATE OR REPLACE FUNCTION app.profiles_preset() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.division := coalesce(NEW.division, CASE NEW.role
    WHEN 'c_level' THEN 'executive' WHEN 'pm' THEN 'project' WHEN 'designer_dev' THEN 'design'
    WHEN 'sales' THEN 'sales' WHEN 'finance' THEN 'finance' WHEN 'hr' THEN 'people' END::public.division);
  IF TG_OP = 'INSERT' AND NEW.role IN ('c_level', 'pm') THEN
    NEW.access_level := 'manager';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER profiles_preset BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION app.profiles_preset();

-- …and the modules of that preset (C-Level: all; Finance, Sales, HR: their own).
CREATE OR REPLACE FUNCTION app.role_modules(r public.user_role) RETURNS public.app_module[]
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE r
    WHEN 'c_level' THEN ARRAY['people', 'finance', 'sales', 'studio_report']::public.app_module[]
    WHEN 'finance' THEN ARRAY['finance']::public.app_module[]
    WHEN 'sales' THEN ARRAY['sales']::public.app_module[]
    WHEN 'hr' THEN ARRAY['people']::public.app_module[]
    ELSE ARRAY[]::public.app_module[] END
$$;

CREATE OR REPLACE FUNCTION app.profiles_preset_modules() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.module_grants (user_id, module)
  SELECT NEW.id, m FROM unnest(app.role_modules(NEW.role)) m
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END $$;
CREATE TRIGGER profiles_preset_modules AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION app.profiles_preset_modules();

-- Phase 1 rules plus: job role, division, level, title and manager are the
-- People module's (or an admin's); access is admin only; no reporting loops.
CREATE OR REPLACE FUNCTION app.profiles_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.manager_id IS NOT NULL AND NEW.manager_id IS DISTINCT FROM OLD.manager_id AND EXISTS (
    WITH RECURSIVE line(id, depth) AS (
      SELECT NEW.manager_id, 1
      UNION ALL
      SELECT p.manager_id, l.depth + 1 FROM line l JOIN public.profiles p ON p.id = l.id
      WHERE l.id IS NOT NULL AND l.depth < 12
    )
    SELECT 1 FROM line WHERE id = NEW.id
  ) THEN
    RAISE EXCEPTION 'This manager already reports to this person' USING ERRCODE = '23514';
  END IF;
  IF NOT app.via_rls() THEN
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id OR NEW.email <> OLD.email OR NEW.slack_user_id IS DISTINCT FROM OLD.slack_user_id THEN
    RAISE EXCEPTION 'These profile fields are managed by the system' USING ERRCODE = '42501';
  END IF;
  IF (NEW.role <> OLD.role OR NEW.employment_type <> OLD.employment_type OR NEW.status <> OLD.status
      OR NEW.deactivated_at IS DISTINCT FROM OLD.deactivated_at)
     AND NOT (app.is_admin() OR app.user_role() = 'hr') THEN
    RAISE EXCEPTION 'Only HR or an admin can change role, employment type or status' USING ERRCODE = '42501';
  END IF;
  IF (NEW.job_role_id, NEW.division, NEW.level, NEW.job_title, NEW.manager_id)
     IS DISTINCT FROM (OLD.job_role_id, OLD.division, OLD.level, OLD.job_title, OLD.manager_id)
     AND NOT app.has_module('people') THEN
    RAISE EXCEPTION 'Only the People module can change job role, division, level, title or manager' USING ERRCODE = '42501';
  END IF;
  IF (NEW.is_admin <> OLD.is_admin OR NEW.access_level <> OLD.access_level) AND NOT app.is_admin() THEN
    RAISE EXCEPTION 'Only an admin can change access' USING ERRCODE = '42501';
  END IF;
  IF NEW.id = app.uid() AND NEW.status <> 'active' THEN
    RAISE EXCEPTION 'You cannot deactivate yourself' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

-- Backfill the people already here from their role preset.
UPDATE public.profiles SET
  division = CASE role
    WHEN 'c_level' THEN 'executive' WHEN 'pm' THEN 'project' WHEN 'designer_dev' THEN 'design'
    WHEN 'sales' THEN 'sales' WHEN 'finance' THEN 'finance' WHEN 'hr' THEN 'people' END::public.division,
  access_level = CASE WHEN role IN ('c_level', 'pm') THEN 'manager' ELSE 'member' END::public.access_level;
INSERT INTO public.module_grants (user_id, module)
SELECT p.id, m FROM public.profiles p, unnest(app.role_modules(p.role)) m
ON CONFLICT DO NOTHING;

-- Module grants: admins only (access is an admin decision, PRD "Akses").
CREATE OR REPLACE FUNCTION app.module_grants_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF app.via_rls() AND NOT app.is_admin() THEN
    RAISE EXCEPTION 'Only an admin can change modules' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.granted_by := coalesce(app.uid(), NEW.granted_by);
    NEW.granted_at := now();
    RETURN NEW;
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER module_grants_guard BEFORE INSERT OR DELETE ON public.module_grants
  FOR EACH ROW EXECUTE FUNCTION app.module_grants_guard();

-- ---------------------------------------------------------------------------
-- Tasks: types, reviewer, review rounds with a one-working-day SLA, locked
-- first due date, due date changes with a reason.
-- ---------------------------------------------------------------------------

INSERT INTO public.task_types (id, name, key, position) VALUES
  (gen_random_uuid(), 'Regular', 'regular', 0),
  (gen_random_uuid(), 'Revision', 'revision', 1),
  (gen_random_uuid(), 'Bug', 'bug', 2),
  (gen_random_uuid(), 'Report', 'report', 3),
  (gen_random_uuid(), 'Content', 'content', 4);

-- Existing tasks: the due date they have now is the first one, and Done
-- tasks were approved when they were completed.
UPDATE public.tasks SET original_due_date = due_date, approved_at = CASE WHEN status = 'done' THEN completed_at END;

-- The reviewer approves (→ Done) or sends back (Review → In progress); the
-- project's PM and C-Level may act for them. Without a reviewer, the
-- project's PM reviews.
CREATE OR REPLACE FUNCTION app.can_review_task(t public.tasks) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT app.user_role() IS NOT NULL AND (
    t.reviewer_id = app.uid()
    OR app.can_manage_project(t.project_id)
  )
$$;

CREATE OR REPLACE FUNCTION app.tasks_review_flow() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  rls boolean := app.via_rls();
  open_round uuid;
BEGIN
  -- The first due date is kept; later changes go through due_date_changes.
  IF TG_OP = 'INSERT' THEN
    NEW.original_due_date := NEW.due_date;
  ELSE
    IF NEW.original_due_date IS DISTINCT FROM OLD.original_due_date AND rls THEN
      RAISE EXCEPTION 'The first due date is locked' USING ERRCODE = '42501';
    END IF;
    IF OLD.original_due_date IS NULL AND NEW.due_date IS NOT NULL THEN
      NEW.original_due_date := NEW.due_date;
    ELSIF rls AND OLD.due_date IS NOT NULL AND NEW.due_date IS DISTINCT FROM OLD.due_date AND NOT EXISTS (
      SELECT 1 FROM public.due_date_changes c
      WHERE c.task_id = NEW.id AND c.to_date IS NOT DISTINCT FROM NEW.due_date AND c.approved_at = now()
    ) THEN
      RAISE EXCEPTION 'Changing a due date needs a reason and the PM''s approval' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.reviewer_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.reviewer_id IS DISTINCT FROM OLD.reviewer_id)
     AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = NEW.reviewer_id AND p.status = 'active') THEN
    RAISE EXCEPTION 'The reviewer must be an active member of the studio' USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    -- Leaving review: the reviewer decides; the owner may only pull it back.
    IF OLD.status = 'review' THEN
      SELECT r.id INTO open_round FROM public.review_rounds r
      WHERE r.task_id = NEW.id AND r.decided_at IS NULL ORDER BY r.submitted_at DESC LIMIT 1;
      IF NOT rls OR app.can_review_task(OLD) THEN
        UPDATE public.review_rounds SET decided_at = now(), decided_by = app.uid(),
          decision = CASE WHEN NEW.status = 'done' THEN 'approved' ELSE 'changes_requested' END::public.review_decision
        WHERE id = open_round;
      ELSIF NEW.status = 'done' THEN
        RAISE EXCEPTION 'Only the reviewer can approve this task' USING ERRCODE = '42501';
      ELSE
        UPDATE public.review_rounds SET decided_at = now(), decided_by = app.uid() WHERE id = open_round;
      END IF;
    ELSIF NEW.status = 'done' AND rls AND NOT app.can_review_task(OLD) THEN
      RAISE EXCEPTION 'Send the task to review — the reviewer approves it' USING ERRCODE = '42501';
    END IF;

    IF NEW.status = 'review' THEN
      NEW.reviewer_id := coalesce(NEW.reviewer_id, (SELECT pr.pm_id FROM public.projects pr WHERE pr.id = NEW.project_id));
      INSERT INTO public.review_rounds (id, task_id, reviewer_id, submitted_at, sla_due_at)
      VALUES (gen_random_uuid(), NEW.id, NEW.reviewer_id, now(), app.add_workdays(now(), 1));
    END IF;
  END IF;

  -- A new reviewer takes over the open round.
  IF TG_OP = 'UPDATE' AND NEW.reviewer_id IS DISTINCT FROM OLD.reviewer_id AND NEW.status = 'review' AND OLD.status = 'review' THEN
    UPDATE public.review_rounds SET reviewer_id = NEW.reviewer_id, sla_notified_at = NULL
    WHERE task_id = NEW.id AND decided_at IS NULL;
  END IF;

  IF NEW.status = 'done' AND (TG_OP = 'INSERT' OR OLD.status <> 'done') THEN
    NEW.approved_at := now();
  ELSIF NEW.status <> 'done' THEN
    NEW.approved_at := NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tasks_review_flow BEFORE INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION app.tasks_review_flow();

-- A due date change: whoever edits the task asks; the PM (or C-Level)
-- approves, and their own changes are approved at once.
CREATE OR REPLACE FUNCTION app.due_date_changes_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  pid uuid;
BEGIN
  SELECT t.project_id INTO pid FROM public.tasks t WHERE t.id = NEW.task_id;
  IF TG_OP = 'INSERT' THEN
    NEW.requested_by := coalesce(app.uid(), NEW.requested_by);
    NEW.from_date := (SELECT t.due_date FROM public.tasks t WHERE t.id = NEW.task_id);
    IF app.via_rls() THEN
      IF app.can_manage_project(pid) THEN
        NEW.approved_by := app.uid();
        NEW.approved_at := now();
      ELSE
        NEW.approved_by := NULL;
        NEW.approved_at := NULL;
      END IF;
    END IF;
  ELSE
    IF (NEW.task_id, NEW.from_date, NEW.to_date, NEW.reason, NEW.requested_by)
       IS DISTINCT FROM (OLD.task_id, OLD.from_date, OLD.to_date, OLD.reason, OLD.requested_by) THEN
      RAISE EXCEPTION 'A due date request can''t be rewritten' USING ERRCODE = '42501';
    END IF;
    IF OLD.approved_at IS NOT NULL THEN
      RAISE EXCEPTION 'This change was already approved' USING ERRCODE = '42501';
    END IF;
    IF app.via_rls() AND NOT app.can_manage_project(pid) THEN
      RAISE EXCEPTION 'Only the project''s PM can approve a due date change' USING ERRCODE = '42501';
    END IF;
    NEW.approved_by := coalesce(app.uid(), NEW.approved_by);
    NEW.approved_at := now();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER due_date_changes_guard BEFORE INSERT OR UPDATE ON public.due_date_changes
  FOR EACH ROW EXECUTE FUNCTION app.due_date_changes_guard();

-- Owner, collaborator, the project's PM, C-Level — and now the reviewer.
CREATE OR REPLACE FUNCTION app.can_edit_task(tid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = tid
      AND app.user_role() IS NOT NULL
      AND (
        t.reviewer_id = app.uid()
        OR (
          app.has_role('designer_dev', 'pm', 'c_level')
          AND app.is_project_member(t.project_id)
          AND (
            app.can_manage_project(t.project_id)
            OR t.owner_id = app.uid()
            OR EXISTS (SELECT 1 FROM public.task_collaborators c WHERE c.task_id = t.id AND c.user_id = app.uid())
          )
        )
      )
  )
$$;

-- The reviewer sees the task even when they aren't on the project.
DROP POLICY tasks_select ON public.tasks;
CREATE POLICY tasks_select ON public.tasks FOR SELECT TO authenticated
  USING (app.can_view_tasks(project_id) OR (reviewer_id = app.uid() AND app.user_role() IS NOT NULL));
DROP POLICY tasks_update ON public.tasks;
CREATE POLICY tasks_update ON public.tasks FOR UPDATE TO authenticated
  USING (app.can_edit_task(id)) WITH CHECK (app.is_project_member(project_id) OR reviewer_id = app.uid());

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE public.job_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.module_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.due_date_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.job_roles, public.module_grants, public.task_types, public.review_rounds,
  public.due_date_changes, public.public_holidays, public.attendance FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.job_roles, public.task_types TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.module_grants TO authenticated;
GRANT SELECT ON public.review_rounds TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.due_date_changes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.public_holidays TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.attendance TO authenticated;

-- Job roles and task types: everyone reads; the People module manages.
CREATE POLICY job_roles_select ON public.job_roles FOR SELECT TO authenticated
  USING (app.user_role() IS NOT NULL);
CREATE POLICY job_roles_write ON public.job_roles FOR INSERT TO authenticated
  WITH CHECK (app.has_module('people'));
CREATE POLICY job_roles_update ON public.job_roles FOR UPDATE TO authenticated
  USING (app.has_module('people')) WITH CHECK (app.has_module('people'));
CREATE POLICY task_types_select ON public.task_types FOR SELECT TO authenticated
  USING (app.user_role() IS NOT NULL);
CREATE POLICY task_types_insert ON public.task_types FOR INSERT TO authenticated
  WITH CHECK (app.has_module('people'));
CREATE POLICY task_types_update ON public.task_types FOR UPDATE TO authenticated
  USING (app.has_module('people')) WITH CHECK (app.has_module('people'));

-- Modules aren't secret (the UI shows who holds what); admins change them.
CREATE POLICY module_grants_select ON public.module_grants FOR SELECT TO authenticated
  USING (app.user_role() IS NOT NULL);
CREATE POLICY module_grants_insert ON public.module_grants FOR INSERT TO authenticated
  WITH CHECK (app.is_admin());
CREATE POLICY module_grants_delete ON public.module_grants FOR DELETE TO authenticated
  USING (app.is_admin());

-- Review rounds are written by the task trigger only; read with the task.
CREATE POLICY review_rounds_select ON public.review_rounds FOR SELECT TO authenticated
  USING (reviewer_id = app.uid() OR EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id));

CREATE POLICY due_date_changes_select ON public.due_date_changes FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id));
CREATE POLICY due_date_changes_insert ON public.due_date_changes FOR INSERT TO authenticated
  WITH CHECK (app.can_edit_task(task_id));
CREATE POLICY due_date_changes_update ON public.due_date_changes FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id AND app.can_manage_project(t.project_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id AND app.can_manage_project(t.project_id)));

CREATE POLICY public_holidays_select ON public.public_holidays FOR SELECT TO authenticated
  USING (app.user_role() IS NOT NULL);
CREATE POLICY public_holidays_write ON public.public_holidays FOR ALL TO authenticated
  USING (app.has_module('people')) WITH CHECK (app.has_module('people'));

-- Attendance: you check yourself in; your managers and the People module
-- read it; the People module corrects it.
CREATE POLICY attendance_select ON public.attendance FOR SELECT TO authenticated
  USING (user_id = app.uid() OR app.is_manager_of(user_id) OR app.has_module('people', 'studio_report'));
CREATE POLICY attendance_insert ON public.attendance FOR INSERT TO authenticated
  WITH CHECK ((user_id = app.uid() AND app.user_role() IS NOT NULL) OR app.has_module('people'));
CREATE POLICY attendance_update ON public.attendance FOR UPDATE TO authenticated
  USING (user_id = app.uid() OR app.has_module('people'))
  WITH CHECK (user_id = app.uid() OR app.has_module('people'));
