-- Odama OS — access control, derived rules and defaults (PRD "Role & hak akses",
-- "Aturan turunan", "Helper untuk RLS").
--
-- Every access rule of the PRD matrix is a policy here. The app's own server
-- code runs user queries as the `authenticated` role with the user's JWT claims
-- (lib/db.ts → withRls), so these policies apply to the app and to direct
-- Supabase API calls alike. The migration owner (postgres) bypasses RLS and is
-- only used for system work: auth resolution, webhooks, scheduled jobs.
--
-- Helpers live in the private `app` schema, which PostgREST does not expose.
-- (`current_role` is a reserved SQL word, so the PRD's current_role() is
-- app.user_role() here.)

-- ---------------------------------------------------------------------------
-- Roles — present on Supabase; created here for plain Postgres / the shadow DB.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
  -- The app connection must be able to `SET ROLE authenticated`.
  BEGIN
    EXECUTE format('GRANT authenticated TO %I', current_user);
  EXCEPTION WHEN OTHERS THEN
    NULL; -- already a member, or a superuser
  END;
END $$;

CREATE SCHEMA IF NOT EXISTS app;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Identity helpers
-- ---------------------------------------------------------------------------

-- The signed-in user's id, from the PostgREST / withRls() JWT claims.
CREATE OR REPLACE FUNCTION app.uid() RETURNS uuid
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
    ),
    ''
  )::uuid
$$;

-- Role of the signed-in user; NULL unless the profile is active.
CREATE OR REPLACE FUNCTION app.user_role() RETURNS public.user_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p.role FROM public.profiles p WHERE p.id = app.uid() AND p.status = 'active'
$$;

CREATE OR REPLACE FUNCTION app.is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(
    (SELECT p.is_admin FROM public.profiles p WHERE p.id = app.uid() AND p.status = 'active'),
    false
  )
$$;

CREATE OR REPLACE FUNCTION app.has_role(VARIADIC roles public.user_role[]) RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT coalesce(app.user_role() = ANY (roles), false)
$$;

-- `uid` is on the project: its PM or a member.
CREATE OR REPLACE FUNCTION app.is_member_of(pid uuid, uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.projects pr WHERE pr.id = pid AND pr.pm_id = uid)
      OR EXISTS (SELECT 1 FROM public.project_members m WHERE m.project_id = pid AND m.user_id = uid)
$$;

-- PRD is_project_member(pid): member, the project's PM, or C-Level.
CREATE OR REPLACE FUNCTION app.is_project_member(pid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT app.user_role() IS NOT NULL
     AND (app.user_role() = 'c_level' OR app.is_member_of(pid, app.uid()))
$$;

-- PRD can_manage_project(pid): the project's PM, or C-Level.
CREATE OR REPLACE FUNCTION app.can_manage_project(pid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT app.user_role() IS NOT NULL
     AND (
       app.user_role() = 'c_level'
       OR EXISTS (SELECT 1 FROM public.projects pr WHERE pr.id = pid AND pr.pm_id = app.uid())
     )
$$;

-- Matrix "Project (info umum)": everyone but Designer & Dev sees every
-- project; Designer & Dev only the ones they are on.
CREATE OR REPLACE FUNCTION app.can_view_project(pid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT app.user_role() IS NOT NULL
     AND (app.user_role() <> 'designer_dev' OR app.is_member_of(pid, app.uid()))
$$;

-- Matrix "Project (info umum)" edit: Sales and C-Level any project; a PM the
-- projects they run or are a member of.
CREATE OR REPLACE FUNCTION app.can_edit_project(pid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT app.has_role('sales', 'c_level')
      OR (app.user_role() = 'pm' AND app.is_member_of(pid, app.uid()))
$$;

-- Matrix "Client": PM, Sales, Finance, C-Level all; Designer & Dev only
-- clients of their projects; HR none.
CREATE OR REPLACE FUNCTION app.can_view_client(cid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT app.has_role('pm', 'sales', 'finance', 'c_level')
      OR (
        app.user_role() = 'designer_dev'
        AND EXISTS (
          SELECT 1 FROM public.projects pr
          WHERE pr.client_id = cid AND app.is_member_of(pr.id, app.uid())
        )
      )
$$;

-- Matrix "Section & task": Designer & Dev, PM and Sales on their projects,
-- C-Level everywhere. Finance and HR never.
CREATE OR REPLACE FUNCTION app.can_view_tasks(pid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT app.has_role('designer_dev', 'pm', 'sales', 'c_level') AND app.is_project_member(pid)
$$;

-- Owner, collaborator, the project's PM or C-Level may change a task (M2.2).
CREATE OR REPLACE FUNCTION app.can_edit_task(tid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = tid
      AND app.has_role('designer_dev', 'pm', 'c_level')
      AND app.is_project_member(t.project_id)
      AND (
        app.can_manage_project(t.project_id)
        OR t.owner_id = app.uid()
        OR EXISTS (SELECT 1 FROM public.task_collaborators c WHERE c.task_id = t.id AND c.user_id = app.uid())
      )
  )
$$;

CREATE OR REPLACE FUNCTION app.week_start(d date) RETURNS date
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT date_trunc('week', d)::date
$$;

CREATE OR REPLACE FUNCTION app.is_week_locked(d date) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.timesheet_locks l WHERE l.week_start = app.week_start(d))
$$;

-- True while a statement runs through RLS (the app's withRls or the
-- Supabase API) rather than as the system connection. Reads the `role`
-- setting, not current_user, which SECURITY DEFINER functions replace with
-- their owner.
CREATE OR REPLACE FUNCTION app.via_rls() RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT coalesce(current_setting('role', true), 'none') IN ('authenticated', 'anon')
$$;

-- Next number of the yearly invoice sequence (M5.2). Row-locked upsert, so
-- two invoices issued at once never share a number. System only.
CREATE OR REPLACE FUNCTION app.next_invoice_number(p_year int) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  n int;
BEGIN
  INSERT INTO public.invoice_sequences (year, last_number, updated_at)
  VALUES (p_year, 1, now())
  ON CONFLICT (year) DO UPDATE
    SET last_number = public.invoice_sequences.last_number + 1, updated_at = now()
  RETURNING last_number INTO n;
  RETURN n;
END $$;

-- ---------------------------------------------------------------------------
-- Constraints the schema language can't express
-- ---------------------------------------------------------------------------

ALTER TABLE public.clients
  ADD CONSTRAINT clients_code_format CHECK (code ~ '^[A-Z]{2,6}$' AND code <> 'INT');

ALTER TABLE public.projects
  ADD CONSTRAINT projects_kind_fields CHECK (
    (kind = 'internal' AND client_id IS NULL AND contract_type IS NULL)
    OR (kind = 'client' AND client_id IS NOT NULL AND contract_type IS NOT NULL)
  );

ALTER TABLE public.time_entries
  ADD CONSTRAINT time_entries_minutes_positive CHECK (minutes > 0),
  ADD CONSTRAINT time_entries_target CHECK (task_id IS NOT NULL OR category_id IS NOT NULL),
  ADD CONSTRAINT time_entries_one_target CHECK (task_id IS NULL OR category_id IS NULL);

ALTER TABLE public.invoice_items
  ADD CONSTRAINT invoice_items_quantity_positive CHECK (quantity > 0);

ALTER TABLE public.invoice_payment_requests
  ADD CONSTRAINT invoice_payment_requests_amount_positive CHECK (amount > 0);

-- At most one primary contact per client.
CREATE UNIQUE INDEX client_contacts_one_primary ON public.client_contacts (client_id) WHERE is_primary;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- updated_at for writes that don't come through Prisma (Supabase API, SQL).
CREATE OR REPLACE FUNCTION app.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.column_name = 'updated_at'
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at()',
      t || '_touch_updated_at', t
    );
  END LOOP;
END $$;

-- profiles: a user edits their own name, avatar, time zone and notification
-- preferences; role, employment type and status are HR / admin only, and the
-- admin flag is admin only (M0.3, M0.4).
CREATE OR REPLACE FUNCTION app.profiles_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
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
  IF NEW.is_admin <> OLD.is_admin AND NOT app.is_admin() THEN
    RAISE EXCEPTION 'Only an admin can grant or remove admin access' USING ERRCODE = '42501';
  END IF;
  IF NEW.id = app.uid() AND NEW.status <> 'active' THEN
    RAISE EXCEPTION 'You cannot deactivate yourself' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER profiles_guard BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION app.profiles_guard();

-- clients: the code is fixed once the client has a project (M1.1).
CREATE OR REPLACE FUNCTION app.clients_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.code <> OLD.code AND EXISTS (SELECT 1 FROM public.projects p WHERE p.client_id = OLD.id) THEN
    RAISE EXCEPTION 'The client code can''t change once the client has projects' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER clients_guard BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION app.clients_guard();

-- projects: code = client code + per-client sequence (ACME-001), INT-001 for
-- internal projects. Kind and client are fixed after creation.
CREATE OR REPLACE FUNCTION app.projects_assign_code() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  prefix text;
  next_no int;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.kind <> OLD.kind OR NEW.client_id IS DISTINCT FROM OLD.client_id THEN
      RAISE EXCEPTION 'A project''s kind and client can''t change after it is created' USING ERRCODE = 'check_violation';
    END IF;
    NEW.code := OLD.code;
    RETURN NEW;
  END IF;

  IF NEW.kind = 'internal' THEN
    prefix := 'INT';
  ELSE
    SELECT c.code INTO prefix FROM public.clients c WHERE c.id = NEW.client_id;
    IF prefix IS NULL THEN
      RAISE EXCEPTION 'Client not found' USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('project_code:' || prefix));
  SELECT coalesce(max(substring(p.code FROM length(prefix) + 2)::int), 0) + 1
    INTO next_no
    FROM public.projects p
   WHERE p.code LIKE prefix || '-%'
     AND substring(p.code FROM length(prefix) + 2) ~ '^[0-9]+$';
  NEW.code := prefix || '-' || lpad(next_no::text, 3, '0');
  RETURN NEW;
END $$;

CREATE TRIGGER projects_assign_code BEFORE INSERT OR UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION app.projects_assign_code();

-- The PM is always a member (M1.2), and every new project gets a "General"
-- section (M2.1).
CREATE OR REPLACE FUNCTION app.projects_after_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.project_members (project_id, user_id, added_by, updated_at)
  VALUES (NEW.id, NEW.pm_id, app.uid(), now())
  ON CONFLICT DO NOTHING;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.sections (id, project_id, name, position, updated_at)
    VALUES (gen_random_uuid(), NEW.id, 'General', 0, now());
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER projects_after_write AFTER INSERT OR UPDATE OF pm_id ON public.projects
  FOR EACH ROW EXECUTE FUNCTION app.projects_after_write();

-- Only active people can be added to a project, and the project's PM can't be
-- removed from it.
CREATE OR REPLACE FUNCTION app.project_members_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = NEW.user_id AND p.status <> 'deactivated') THEN
      RAISE EXCEPTION 'Only active people can join a project' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.projects p WHERE p.id = OLD.project_id AND p.pm_id = OLD.user_id) THEN
    RAISE EXCEPTION 'The project''s PM can''t be removed from it' USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;

CREATE TRIGGER project_members_guard BEFORE INSERT OR DELETE ON public.project_members
  FOR EACH ROW EXECUTE FUNCTION app.project_members_guard();

-- tasks: the section belongs to the task's project, the owner is an active
-- member, completed_at follows the Done status.
CREATE OR REPLACE FUNCTION app.tasks_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.project_id <> OLD.project_id THEN
    RAISE EXCEPTION 'A task can''t move to another project' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sections s WHERE s.id = NEW.section_id AND s.project_id = NEW.project_id) THEN
    RAISE EXCEPTION 'The section belongs to another project' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.owner_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.owner_id IS DISTINCT FROM OLD.owner_id)
     AND NOT (
       app.is_member_of(NEW.project_id, NEW.owner_id)
       AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = NEW.owner_id AND p.status = 'active')
     ) THEN
    RAISE EXCEPTION 'The owner must be an active member of the project' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'done' AND (TG_OP = 'INSERT' OR OLD.status <> 'done') THEN
    NEW.completed_at := now();
  ELSIF NEW.status <> 'done' THEN
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER tasks_guard BEFORE INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION app.tasks_guard();

CREATE OR REPLACE FUNCTION app.task_collaborators_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  pid uuid;
BEGIN
  SELECT t.project_id INTO pid FROM public.tasks t WHERE t.id = NEW.task_id;
  IF NOT (
    app.is_member_of(pid, NEW.user_id)
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = NEW.user_id AND p.status = 'active')
  ) THEN
    RAISE EXCEPTION 'Collaborators must be active members of the project' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER task_collaborators_guard BEFORE INSERT ON public.task_collaborators
  FOR EACH ROW EXECUTE FUNCTION app.task_collaborators_guard();

-- task_comments: through RLS only the author edits; the body of a deleted
-- comment can't change again, and deleted_by is always the author.
CREATE OR REPLACE FUNCTION app.task_comments_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NOT app.via_rls() THEN
    RETURN NEW;
  END IF;
  IF NEW.task_id <> OLD.task_id OR NEW.author_id <> OLD.author_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'Comment metadata is read-only' USING ERRCODE = '42501';
  END IF;
  IF OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'A deleted comment can''t be changed' USING ERRCODE = '42501';
  END IF;
  IF NEW.deleted_at IS NOT NULL THEN
    NEW.deleted_by := app.uid();
    NEW.body := OLD.body; -- the original stays stored, never shown
  ELSIF NEW.body IS DISTINCT FROM OLD.body THEN
    NEW.edited_at := now();
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER task_comments_guard BEFORE UPDATE ON public.task_comments
  FOR EACH ROW EXECUTE FUNCTION app.task_comments_guard();

-- time_entries — derived rules (PRD "Aturan turunan") and the M3 guards:
--  * a task entry takes the task's project; billable = task in a client project
--  * category entries have no project and are never billable
--  * out-of-scope only on client-project tasks, with a note
--  * through RLS: the user must be on the project, the project Active/On hold,
--    the week not locked, and only the project's PM reviews out-of-scope
CREATE OR REPLACE FUNCTION app.time_entries_derive() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t_project uuid;
  p_kind public.project_kind;
  p_status public.project_status;
  core_changed boolean;
  is_owner boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF app.via_rls() AND app.is_week_locked(OLD.entry_date) THEN
      RAISE EXCEPTION 'This week is locked. Request a correction instead.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.task_id IS NOT NULL THEN
    SELECT t.project_id INTO t_project FROM public.tasks t WHERE t.id = NEW.task_id;
    NEW.project_id := t_project;
    NEW.category_id := NULL;
    SELECT p.kind, p.status INTO p_kind, p_status FROM public.projects p WHERE p.id = t_project;
    NEW.is_billable := (p_kind = 'client');
  ELSE
    NEW.project_id := NULL;
    NEW.is_billable := false;
  END IF;

  IF NEW.oos_status <> 'none' AND (NEW.task_id IS NULL OR p_kind <> 'client') THEN
    RAISE EXCEPTION 'Only work on a client project can be out of scope' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.oos_status = 'pending' AND coalesce(btrim(NEW.note), '') = '' THEN
    RAISE EXCEPTION 'Describe the out-of-scope request in the note' USING ERRCODE = 'check_violation';
  END IF;

  IF NOT app.via_rls() THEN
    RETURN NEW;
  END IF;

  core_changed := TG_OP = 'INSERT'
    OR NEW.user_id <> OLD.user_id
    OR NEW.entry_date <> OLD.entry_date
    OR NEW.minutes <> OLD.minutes
    OR NEW.task_id IS DISTINCT FROM OLD.task_id
    OR NEW.category_id IS DISTINCT FROM OLD.category_id
    OR NEW.note IS DISTINCT FROM OLD.note;
  is_owner := NEW.user_id = app.uid() AND (TG_OP = 'INSERT' OR OLD.user_id = app.uid());

  IF core_changed THEN
    IF NOT is_owner THEN
      RAISE EXCEPTION 'Only the person who logged the time can change it' USING ERRCODE = '42501';
    END IF;
    IF app.is_week_locked(NEW.entry_date) OR (TG_OP = 'UPDATE' AND app.is_week_locked(OLD.entry_date)) THEN
      RAISE EXCEPTION 'This week is locked. Request a correction instead.' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.task_id IS NOT NULL THEN
      IF p_status NOT IN ('active', 'on_hold') THEN
        RAISE EXCEPTION 'Time can only be logged to Active or On hold projects' USING ERRCODE = 'check_violation';
      END IF;
      IF NOT (app.user_role() = 'c_level' OR app.is_member_of(NEW.project_id, NEW.user_id)) THEN
        RAISE EXCEPTION 'You are not a member of this project' USING ERRCODE = '42501';
      END IF;
    ELSIF NOT EXISTS (SELECT 1 FROM public.work_categories c WHERE c.id = NEW.category_id AND c.is_active) THEN
      RAISE EXCEPTION 'This category is no longer active' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Out-of-scope review fields: the user may flag (pending) or unflag (none)
  -- their own entry; approve / reject is the project's PM (M4.3).
  IF TG_OP = 'INSERT' THEN
    IF NEW.oos_status NOT IN ('none', 'pending') OR NEW.oos_reviewed_by IS NOT NULL OR NEW.billed_at IS NOT NULL THEN
      RAISE EXCEPTION 'New entries can''t carry a review' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.oos_status IS DISTINCT FROM OLD.oos_status
     OR NEW.oos_reviewed_by IS DISTINCT FROM OLD.oos_reviewed_by
     OR NEW.oos_note IS DISTINCT FROM OLD.oos_note
     OR NEW.billed_at IS DISTINCT FROM OLD.billed_at THEN
    IF app.can_manage_project(NEW.project_id) THEN
      IF NEW.oos_status IN ('approved', 'rejected') AND NEW.oos_status IS DISTINCT FROM OLD.oos_status THEN
        NEW.oos_reviewed_by := app.uid();
        NEW.oos_reviewed_at := now();
      END IF;
    ELSIF is_owner AND NEW.oos_status IN ('none', 'pending') AND OLD.oos_status IN ('none', 'pending')
          AND NEW.oos_reviewed_by IS NOT DISTINCT FROM OLD.oos_reviewed_by
          AND NEW.billed_at IS NOT DISTINCT FROM OLD.billed_at THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'Only the project''s PM reviews out-of-scope work' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER time_entries_derive BEFORE INSERT OR UPDATE OR DELETE ON public.time_entries
  FOR EACH ROW EXECUTE FUNCTION app.time_entries_derive();

-- time_corrections: the reviewer follows the project (its PM), or HR for
-- non-billable categories (M3.5). project_id is derived, never trusted.
CREATE OR REPLACE FUNCTION app.time_corrections_derive() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  proposed_task uuid;
  entry_owner uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    proposed_task := nullif(NEW.proposed ->> 'taskId', '')::uuid;
    IF proposed_task IS NOT NULL THEN
      SELECT t.project_id INTO NEW.project_id FROM public.tasks t WHERE t.id = proposed_task;
    ELSIF NEW.time_entry_id IS NOT NULL AND nullif(NEW.proposed ->> 'categoryId', '') IS NULL THEN
      SELECT e.project_id INTO NEW.project_id FROM public.time_entries e WHERE e.id = NEW.time_entry_id;
    ELSE
      NEW.project_id := NULL;
    END IF;
    IF app.via_rls() THEN
      IF NEW.time_entry_id IS NOT NULL THEN
        SELECT e.user_id INTO entry_owner FROM public.time_entries e WHERE e.id = NEW.time_entry_id;
        IF entry_owner IS DISTINCT FROM app.uid() THEN
          RAISE EXCEPTION 'You can only correct your own time' USING ERRCODE = '42501';
        END IF;
      END IF;
      NEW.status := 'pending';
      NEW.reviewed_by := NULL;
      NEW.reviewed_at := NULL;
    END IF;
    RETURN NEW;
  END IF;

  IF app.via_rls() THEN
    IF NEW.proposed IS DISTINCT FROM OLD.proposed OR NEW.requested_by <> OLD.requested_by
       OR NEW.time_entry_id IS DISTINCT FROM OLD.time_entry_id OR NEW.project_id IS DISTINCT FROM OLD.project_id THEN
      RAISE EXCEPTION 'A correction request can''t be edited' USING ERRCODE = '42501';
    END IF;
    IF OLD.status <> 'pending' THEN
      RAISE EXCEPTION 'This correction was already reviewed' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status <> OLD.status THEN
      NEW.reviewed_by := app.uid();
      NEW.reviewed_at := now();
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER time_corrections_derive BEFORE INSERT OR UPDATE ON public.time_corrections
  FOR EACH ROW EXECUTE FUNCTION app.time_corrections_derive();

-- invoices: once sent, amounts, items and payment requests are locked (M5.1).
-- Through RLS a sent invoice can only be voided.
CREATE OR REPLACE FUNCTION app.invoices_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NOT app.via_rls() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' OR NEW.number IS NOT NULL OR NEW.amount_paid <> 0 THEN
      RAISE EXCEPTION 'New invoices start as drafts' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.number IS DISTINCT FROM OLD.number OR NEW.amount_paid <> OLD.amount_paid OR NEW.sent_at IS DISTINCT FROM OLD.sent_at
     OR NEW.project_id <> OLD.project_id OR NEW.client_id <> OLD.client_id THEN
    RAISE EXCEPTION 'These invoice fields are managed by the system' USING ERRCODE = '42501';
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

CREATE TRIGGER invoices_guard BEFORE INSERT OR UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION app.invoices_guard();

CREATE OR REPLACE FUNCTION app.invoice_is_draft(iid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = iid AND i.status = 'draft')
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

GRANT USAGE ON SCHEMA public TO authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;

DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON public._prisma_migrations FROM authenticated, anon';
    EXECUTE 'ALTER TABLE public._prisma_migrations ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION app.next_invoice_number(int) FROM authenticated;

-- System-only tables: RLS on, no policies, no grants.
REVOKE ALL ON public.user_invitations, public.invoice_sequences, public.job_runs FROM authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security — one block per table, in matrix order
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- User & role — everyone reads; own row or HR / admin writes (guarded above).
CREATE POLICY profiles_select ON public.profiles FOR SELECT TO authenticated
  USING (app.user_role() IS NOT NULL);
CREATE POLICY profiles_insert ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (app.is_admin() OR app.has_role('hr'));
CREATE POLICY profiles_update ON public.profiles FOR UPDATE TO authenticated
  USING (id = app.uid() OR app.is_admin() OR app.has_role('hr'))
  WITH CHECK (id = app.uid() OR app.is_admin() OR app.has_role('hr'));

-- Settings — everyone reads (defaults drive the UI), admins write.
CREATE POLICY app_settings_select ON public.app_settings FOR SELECT TO authenticated
  USING (app.user_role() IS NOT NULL);
CREATE POLICY app_settings_write ON public.app_settings FOR ALL TO authenticated
  USING (app.is_admin()) WITH CHECK (app.is_admin());

-- Notifications — your own inbox.
CREATE POLICY notification_log_select ON public.notification_log FOR SELECT TO authenticated
  USING (user_id = app.uid());
CREATE POLICY notification_log_update ON public.notification_log FOR UPDATE TO authenticated
  USING (user_id = app.uid()) WITH CHECK (user_id = app.uid());

-- Audit trail — admins and C-Level read; written by the system.
CREATE POLICY activity_log_select ON public.activity_log FOR SELECT TO authenticated
  USING (app.is_admin() OR app.has_role('c_level'));

-- Client
CREATE POLICY clients_select ON public.clients FOR SELECT TO authenticated
  USING (app.can_view_client(id));
CREATE POLICY clients_insert ON public.clients FOR INSERT TO authenticated
  WITH CHECK (app.has_role('pm', 'sales', 'c_level'));
CREATE POLICY clients_update ON public.clients FOR UPDATE TO authenticated
  USING (app.has_role('pm', 'sales', 'c_level')) WITH CHECK (app.has_role('pm', 'sales', 'c_level'));
-- Only a client with no projects or invoices can be deleted (FKs restrict).
CREATE POLICY clients_delete ON public.clients FOR DELETE TO authenticated
  USING (app.has_role('pm', 'sales', 'c_level'));

CREATE POLICY client_contacts_select ON public.client_contacts FOR SELECT TO authenticated
  USING (app.can_view_client(client_id));
CREATE POLICY client_contacts_write ON public.client_contacts FOR ALL TO authenticated
  USING (app.has_role('pm', 'sales', 'c_level')) WITH CHECK (app.has_role('pm', 'sales', 'c_level'));

-- Project (info umum)
CREATE POLICY projects_select ON public.projects FOR SELECT TO authenticated
  USING (app.can_view_project(id));
CREATE POLICY projects_insert ON public.projects FOR INSERT TO authenticated
  WITH CHECK (app.has_role('pm', 'sales', 'c_level') AND created_by = app.uid());
CREATE POLICY projects_update ON public.projects FOR UPDATE TO authenticated
  USING (app.can_edit_project(id)) WITH CHECK (app.can_edit_project(id));

-- Nilai kontrak project — Sales / C-Level edit, Finance reads, PM reads on
-- their projects, Designer & Dev and HR never.
CREATE POLICY project_contracts_select ON public.project_contracts FOR SELECT TO authenticated
  USING (
    app.has_role('sales', 'finance', 'c_level')
    OR (app.has_role('pm') AND app.is_project_member(project_id))
  );
CREATE POLICY project_contracts_write ON public.project_contracts FOR ALL TO authenticated
  USING (app.has_role('sales', 'c_level')) WITH CHECK (app.has_role('sales', 'c_level'));

-- Budget jam & health — PM (their projects) and C-Level edit; Sales and
-- Finance read; Designer & Dev read on their projects; HR never. Whoever
-- creates the project sets the first budget.
CREATE POLICY project_budgets_select ON public.project_budgets FOR SELECT TO authenticated
  USING (
    app.has_role('sales', 'finance', 'c_level')
    OR (app.has_role('pm', 'designer_dev') AND app.is_project_member(project_id))
  );
CREATE POLICY project_budgets_insert ON public.project_budgets FOR INSERT TO authenticated
  WITH CHECK (
    app.has_role('c_level')
    OR (app.has_role('pm') AND app.is_project_member(project_id))
    OR (app.has_role('pm', 'sales') AND EXISTS (
      SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.created_by = app.uid()
    ))
  );
CREATE POLICY project_budgets_update ON public.project_budgets FOR UPDATE TO authenticated
  USING (app.has_role('c_level') OR (app.has_role('pm') AND app.is_project_member(project_id)))
  WITH CHECK (app.has_role('c_level') OR (app.has_role('pm') AND app.is_project_member(project_id)));

-- Frozen retainer settings per month — read like the budget; written by the
-- system when the settings change or a month closes.
CREATE POLICY retainer_periods_select ON public.retainer_periods FOR SELECT TO authenticated
  USING (
    app.has_role('sales', 'finance', 'c_level')
    OR (app.has_role('pm', 'designer_dev') AND app.is_project_member(project_id))
  );

-- Anggota project — visible with the project; the project's PM and C-Level manage.
CREATE POLICY project_members_select ON public.project_members FOR SELECT TO authenticated
  USING (app.can_view_project(project_id));
CREATE POLICY project_members_insert ON public.project_members FOR INSERT TO authenticated
  WITH CHECK (app.can_manage_project(project_id));
CREATE POLICY project_members_delete ON public.project_members FOR DELETE TO authenticated
  USING (app.can_manage_project(project_id));

-- Section & task
CREATE POLICY sections_select ON public.sections FOR SELECT TO authenticated
  USING (app.can_view_tasks(project_id));
CREATE POLICY sections_insert ON public.sections FOR INSERT TO authenticated
  WITH CHECK (app.can_manage_project(project_id));
CREATE POLICY sections_update ON public.sections FOR UPDATE TO authenticated
  USING (app.can_manage_project(project_id)) WITH CHECK (app.can_manage_project(project_id));

CREATE POLICY tasks_select ON public.tasks FOR SELECT TO authenticated
  USING (app.can_view_tasks(project_id));
CREATE POLICY tasks_insert ON public.tasks FOR INSERT TO authenticated
  WITH CHECK (
    app.has_role('designer_dev', 'pm', 'c_level')
    AND app.is_project_member(project_id)
    AND created_by = app.uid()
  );
CREATE POLICY tasks_update ON public.tasks FOR UPDATE TO authenticated
  USING (app.can_edit_task(id)) WITH CHECK (app.is_project_member(project_id));
-- Tasks with logged time can't be deleted (time_entries FK restricts).
CREATE POLICY tasks_delete ON public.tasks FOR DELETE TO authenticated
  USING (app.can_manage_project(project_id));

CREATE POLICY task_collaborators_select ON public.task_collaborators FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id));
CREATE POLICY task_collaborators_insert ON public.task_collaborators FOR INSERT TO authenticated
  WITH CHECK (app.can_edit_task(task_id));
CREATE POLICY task_collaborators_delete ON public.task_collaborators FOR DELETE TO authenticated
  USING (app.can_edit_task(task_id));

-- Komentar task — members comment; authors edit / delete their own.
CREATE POLICY task_comments_select ON public.task_comments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id));
CREATE POLICY task_comments_insert ON public.task_comments FOR INSERT TO authenticated
  WITH CHECK (
    author_id = app.uid()
    AND EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id)
  );
CREATE POLICY task_comments_update ON public.task_comments FOR UPDATE TO authenticated
  USING (author_id = app.uid()) WITH CHECK (author_id = app.uid());

CREATE POLICY task_activity_select ON public.task_activity FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id));
CREATE POLICY task_activity_insert ON public.task_activity FOR INSERT TO authenticated
  WITH CHECK (actor_id = app.uid() AND EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id));

-- Work categories — everyone reads, admins manage.
CREATE POLICY work_categories_select ON public.work_categories FOR SELECT TO authenticated
  USING (app.user_role() IS NOT NULL);
CREATE POLICY work_categories_write ON public.work_categories FOR ALL TO authenticated
  USING (app.is_admin()) WITH CHECK (app.is_admin());

-- Jam kerja — your own; PM reads (and reviews) their projects; HR and C-Level read all.
CREATE POLICY time_entries_select ON public.time_entries FOR SELECT TO authenticated
  USING (
    user_id = app.uid()
    OR app.has_role('hr', 'c_level')
    OR (project_id IS NOT NULL AND app.has_role('pm') AND app.is_project_member(project_id))
  );
CREATE POLICY time_entries_insert ON public.time_entries FOR INSERT TO authenticated
  WITH CHECK (user_id = app.uid() AND app.user_role() IS NOT NULL);
CREATE POLICY time_entries_update ON public.time_entries FOR UPDATE TO authenticated
  USING (user_id = app.uid() OR (project_id IS NOT NULL AND app.can_manage_project(project_id)))
  WITH CHECK (user_id = app.uid() OR (project_id IS NOT NULL AND app.can_manage_project(project_id)));
CREATE POLICY time_entries_delete ON public.time_entries FOR DELETE TO authenticated
  USING (user_id = app.uid());

CREATE POLICY timesheet_locks_select ON public.timesheet_locks FOR SELECT TO authenticated
  USING (app.user_role() IS NOT NULL);

-- Corrections — the requester, the reviewer (project PM, or HR for
-- categories), and C-Level.
CREATE POLICY time_corrections_select ON public.time_corrections FOR SELECT TO authenticated
  USING (
    requested_by = app.uid()
    OR app.has_role('hr', 'c_level')
    OR (project_id IS NOT NULL AND app.can_manage_project(project_id))
  );
CREATE POLICY time_corrections_insert ON public.time_corrections FOR INSERT TO authenticated
  WITH CHECK (requested_by = app.uid() AND app.user_role() IS NOT NULL);
CREATE POLICY time_corrections_update ON public.time_corrections FOR UPDATE TO authenticated
  USING (
    (project_id IS NOT NULL AND app.can_manage_project(project_id))
    OR (project_id IS NULL AND app.has_role('hr'))
  )
  WITH CHECK (
    (project_id IS NOT NULL AND app.can_manage_project(project_id))
    OR (project_id IS NULL AND app.has_role('hr'))
  );

-- Budget alerts already sent — read with project health.
CREATE POLICY project_alerts_select ON public.project_alerts FOR SELECT TO authenticated
  USING (app.has_role('c_level', 'sales', 'finance') OR (app.has_role('pm') AND app.is_project_member(project_id)));

-- Invoice — Sales and Finance edit, C-Level reads, PM reads on their projects.
CREATE POLICY invoices_select ON public.invoices FOR SELECT TO authenticated
  USING (
    app.has_role('sales', 'finance', 'c_level')
    OR (app.has_role('pm') AND app.is_project_member(project_id))
  );
CREATE POLICY invoices_insert ON public.invoices FOR INSERT TO authenticated
  WITH CHECK (app.has_role('sales', 'finance') AND created_by = app.uid());
CREATE POLICY invoices_update ON public.invoices FOR UPDATE TO authenticated
  USING (app.has_role('sales', 'finance')) WITH CHECK (app.has_role('sales', 'finance'));
CREATE POLICY invoices_delete ON public.invoices FOR DELETE TO authenticated
  USING (app.has_role('sales', 'finance') AND status = 'draft');

CREATE POLICY invoice_items_select ON public.invoice_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_id));
CREATE POLICY invoice_items_write ON public.invoice_items FOR ALL TO authenticated
  USING (app.has_role('sales', 'finance') AND app.invoice_is_draft(invoice_id))
  WITH CHECK (app.has_role('sales', 'finance') AND app.invoice_is_draft(invoice_id));

CREATE POLICY invoice_payment_requests_select ON public.invoice_payment_requests FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_id));
CREATE POLICY invoice_payment_requests_write ON public.invoice_payment_requests FOR ALL TO authenticated
  USING (app.has_role('sales', 'finance') AND app.invoice_is_draft(invoice_id))
  WITH CHECK (app.has_role('sales', 'finance') AND app.invoice_is_draft(invoice_id));

CREATE POLICY invoice_deliveries_select ON public.invoice_deliveries FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_id));

-- Pembayaran — Finance edits (manual matching); Sales and C-Level read; PM
-- reads payments of their projects.
CREATE POLICY payments_select ON public.payments FOR SELECT TO authenticated
  USING (
    app.has_role('finance', 'sales', 'c_level')
    OR (
      app.has_role('pm') AND invoice_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_id)
    )
  );
CREATE POLICY payments_update ON public.payments FOR UPDATE TO authenticated
  USING (app.has_role('finance')) WITH CHECK (app.has_role('finance'));

-- ---------------------------------------------------------------------------
-- Defaults (M0.5, M3.2)
-- ---------------------------------------------------------------------------

INSERT INTO public.app_settings (key, value, updated_at) VALUES
  ('reminder_time', '"17:00"', now()),
  ('workdays', '[1, 2, 3, 4, 5]', now()),
  ('timezone', '"Asia/Jakarta"', now()),
  ('default_alert_thresholds', '[75, 100]', now()),
  ('currencies', '["IDR", "USD", "EUR", "SGD", "AUD"]', now()),
  ('base_currency', '"IDR"', now()),
  ('invoice_number_format', '"ODAMA/{YY}/{SEQ}"', now()),
  ('invoice_sender_email', '"finance@odama.io"', now()),
  ('invoice_sender_name', '"Odama Studio"', now()),
  ('studio_profile', '{"name": "Odama Studio", "address": "", "email": "finance@odama.io", "website": "odama.io"}', now())
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.work_categories (id, name, position, updated_at) VALUES
  (gen_random_uuid(), 'Meeting internal', 0, now()),
  (gen_random_uuid(), 'Riset', 1, now()),
  (gen_random_uuid(), 'Pitching', 2, now()),
  (gen_random_uuid(), 'Belajar', 3, now()),
  (gen_random_uuid(), 'Admin', 4, now())
ON CONFLICT (name) DO NOTHING;
