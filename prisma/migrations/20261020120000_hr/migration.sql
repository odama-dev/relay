-- CreateEnum
CREATE TYPE "hr_event_recurrence" AS ENUM ('none', 'weekly', 'monthly');

-- CreateEnum
CREATE TYPE "hr_event_color" AS ENUM ('gray', 'blue', 'green', 'amber', 'red', 'purple', 'teal');

-- CreateEnum
CREATE TYPE "leave_kind" AS ENUM ('annual_leave', 'permit', 'sick', 'other');

-- CreateEnum
CREATE TYPE "leave_status" AS ENUM ('pending', 'approved', 'rejected', 'cancelled');

-- AlterTable
ALTER TABLE "capacity_overrides" ADD COLUMN     "kind" "leave_kind",
ADD COLUMN     "leave_request_id" UUID;

-- CreateTable
CREATE TABLE "hr_events" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "color" "hr_event_color" NOT NULL DEFAULT 'blue',
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "all_day" BOOLEAN NOT NULL DEFAULT true,
    "start_time" TEXT,
    "end_time" TEXT,
    "recurrence" "hr_event_recurrence" NOT NULL DEFAULT 'none',
    "repeat_until" DATE,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_event_exceptions" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "occurrence_date" DATE NOT NULL,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT,
    "notes" TEXT,
    "color" "hr_event_color",
    "start_date" DATE,
    "end_date" DATE,
    "all_day" BOOLEAN,
    "start_time" TEXT,
    "end_time" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_event_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_requests" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "leave_kind" NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "half_day" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "status" "leave_status" NOT NULL DEFAULT 'pending',
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ,
    "decision_note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hr_events_start_date_idx" ON "hr_events"("start_date");

-- CreateIndex
CREATE UNIQUE INDEX "hr_event_exceptions_event_id_occurrence_date_key" ON "hr_event_exceptions"("event_id", "occurrence_date");

-- CreateIndex
CREATE INDEX "leave_requests_user_id_start_date_idx" ON "leave_requests"("user_id", "start_date");

-- CreateIndex
CREATE INDEX "leave_requests_status_idx" ON "leave_requests"("status");

-- CreateIndex
CREATE UNIQUE INDEX "capacity_overrides_leave_request_id_key" ON "capacity_overrides"("leave_request_id");

-- AddForeignKey
ALTER TABLE "capacity_overrides" ADD CONSTRAINT "capacity_overrides_leave_request_id_fkey" FOREIGN KEY ("leave_request_id") REFERENCES "leave_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_events" ADD CONSTRAINT "hr_events_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_event_exceptions" ADD CONSTRAINT "hr_event_exceptions_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "hr_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Rules — HR calendar
-- ---------------------------------------------------------------------------

ALTER TABLE public.hr_events
  ADD CONSTRAINT hr_events_title_present CHECK (length(btrim(title)) > 0),
  ADD CONSTRAINT hr_events_range CHECK (end_date >= start_date),
  ADD CONSTRAINT hr_events_time_format CHECK (
    (start_time IS NULL OR start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
    AND (end_time IS NULL OR end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')),
  -- All day: no times. Timed: both times, and a one-day event ends after it starts.
  ADD CONSTRAINT hr_events_times CHECK (
    CASE WHEN all_day THEN start_time IS NULL AND end_time IS NULL
    ELSE start_time IS NOT NULL AND end_time IS NOT NULL AND (end_date > start_date OR end_time > start_time) END),
  ADD CONSTRAINT hr_events_repeat CHECK (
    CASE WHEN recurrence = 'none' THEN repeat_until IS NULL ELSE repeat_until IS NULL OR repeat_until >= start_date END);

ALTER TABLE public.hr_event_exceptions
  ADD CONSTRAINT hr_event_exceptions_range CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date),
  ADD CONSTRAINT hr_event_exceptions_time_format CHECK (
    (start_time IS NULL OR start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
    AND (end_time IS NULL OR end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'));

-- ---------------------------------------------------------------------------
-- Rules — leave requests. A member asks; HR (or an admin) decides, never on
-- their own request. Details change only while pending, by the requester.
-- ---------------------------------------------------------------------------

ALTER TABLE public.leave_requests
  ADD CONSTRAINT leave_requests_range CHECK (end_date >= start_date),
  ADD CONSTRAINT leave_requests_half_day CHECK (NOT half_day OR end_date = start_date);

CREATE OR REPLACE FUNCTION app.leave_requests_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  decider boolean := app.has_role('hr') OR app.is_admin();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' OR NEW.decided_by IS NOT NULL OR NEW.decided_at IS NOT NULL OR NEW.decision_note IS NOT NULL THEN
      RAISE EXCEPTION 'A leave request starts as pending' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'A leave request can''t move to someone else' USING ERRCODE = '42501';
    END IF;
    IF (NEW.kind, NEW.start_date, NEW.end_date, NEW.half_day, NEW.reason)
       IS DISTINCT FROM (OLD.kind, OLD.start_date, OLD.end_date, OLD.half_day, OLD.reason)
       AND (OLD.status <> 'pending' OR OLD.user_id IS DISTINCT FROM app.uid()) THEN
      RAISE EXCEPTION 'Only a pending request can be changed, by the person who asked' USING ERRCODE = '42501';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NEW.status IN ('approved', 'rejected') THEN
        IF OLD.status <> 'pending' THEN
          RAISE EXCEPTION 'This request was already decided' USING ERRCODE = '42501';
        END IF;
        IF NOT decider THEN
          RAISE EXCEPTION 'Only HR can decide leave requests' USING ERRCODE = '42501';
        END IF;
        IF OLD.user_id = app.uid() THEN
          RAISE EXCEPTION 'You can''t decide your own leave request' USING ERRCODE = '42501';
        END IF;
        NEW.decided_by := app.uid();
        NEW.decided_at := now();
      ELSIF NEW.status = 'cancelled' THEN
        IF OLD.status NOT IN ('pending', 'approved') THEN
          RAISE EXCEPTION 'Only a pending or approved request can be cancelled' USING ERRCODE = '42501';
        END IF;
        IF OLD.user_id IS DISTINCT FROM app.uid() AND NOT decider THEN
          RAISE EXCEPTION 'Only the person who asked, or HR, can cancel a request' USING ERRCODE = '42501';
        END IF;
      ELSE
        RAISE EXCEPTION 'A decided request can''t go back to pending' USING ERRCODE = '42501';
      END IF;
    ELSIF (NEW.decided_by, NEW.decided_at) IS DISTINCT FROM (OLD.decided_by, OLD.decided_at) THEN
      RAISE EXCEPTION 'The decision can''t be rewritten' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF NEW.status IN ('pending', 'approved') AND EXISTS (
    SELECT 1 FROM public.leave_requests r
    WHERE r.user_id = NEW.user_id AND r.id <> NEW.id AND r.status IN ('pending', 'approved')
      AND r.start_date <= NEW.end_date AND r.end_date >= NEW.start_date
  ) THEN
    RAISE EXCEPTION 'These dates overlap another leave request' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER leave_requests_guard BEFORE INSERT OR UPDATE ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION app.leave_requests_guard();

-- Approval writes the person's time off into capacity_overrides (so
-- utilization and capacity count it); cancelling an approved request removes
-- it. Runs as the owner: the requester may cancel without HR's write rights.
-- A half day is half of a fifth of the person's weekly hours (4h if unknown).
CREATE OR REPLACE FUNCTION app.leave_requests_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  half numeric;
BEGIN
  IF NEW.status = 'approved' AND OLD.status <> 'approved' THEN
    SELECT c.weekly_hours / 10 INTO half FROM public.person_capacity c
    WHERE c.user_id = NEW.user_id AND c.effective_from <= NEW.start_date
    ORDER BY c.effective_from DESC LIMIT 1;
    PERFORM set_config('app.leave_sync', 'on', true);
    INSERT INTO public.capacity_overrides (id, user_id, period_start, period_end, available_hours, reason, kind, leave_request_id, created_by, updated_at)
    VALUES (gen_random_uuid(), NEW.user_id, NEW.start_date, NEW.end_date,
            CASE WHEN NEW.half_day THEN coalesce(half, 4) ELSE 0 END,
            NEW.reason, NEW.kind, NEW.id, NEW.decided_by, now());
    PERFORM set_config('app.leave_sync', 'off', true);
  ELSIF OLD.status = 'approved' AND NEW.status <> 'approved' THEN
    PERFORM set_config('app.leave_sync', 'on', true);
    DELETE FROM public.capacity_overrides WHERE leave_request_id = NEW.id;
    PERFORM set_config('app.leave_sync', 'off', true);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER leave_requests_sync AFTER UPDATE OF status ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION app.leave_requests_sync();

-- Overrides created from a leave request change only through the request.
CREATE OR REPLACE FUNCTION app.capacity_overrides_leave_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF (CASE WHEN TG_OP = 'DELETE' THEN OLD.leave_request_id ELSE coalesce(NEW.leave_request_id, OLD.leave_request_id) END) IS NOT NULL
     AND current_setting('app.leave_sync', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'This time off comes from a leave request — cancel the request instead' USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER capacity_overrides_leave_guard BEFORE INSERT OR UPDATE OR DELETE ON public.capacity_overrides
  FOR EACH ROW EXECUTE FUNCTION app.capacity_overrides_leave_guard();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE public.hr_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_event_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hr_events, public.hr_event_exceptions, public.leave_requests FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hr_events, public.hr_event_exceptions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.leave_requests TO authenticated;

-- The HR calendar is HR's own timeline: HR only — not C-Level, not admins.
CREATE POLICY hr_events_all ON public.hr_events FOR ALL TO authenticated
  USING (app.has_role('hr'))
  WITH CHECK (app.has_role('hr'));
CREATE POLICY hr_event_exceptions_all ON public.hr_event_exceptions FOR ALL TO authenticated
  USING (app.has_role('hr'))
  WITH CHECK (app.has_role('hr'));

-- Leave: your own requests; HR and admins see and decide everyone's.
CREATE POLICY leave_requests_select ON public.leave_requests FOR SELECT TO authenticated
  USING (user_id = app.uid() OR app.has_role('hr') OR app.is_admin());
CREATE POLICY leave_requests_insert ON public.leave_requests FOR INSERT TO authenticated
  WITH CHECK (user_id = app.uid() AND app.user_role() IS NOT NULL);
CREATE POLICY leave_requests_update ON public.leave_requests FOR UPDATE TO authenticated
  USING (user_id = app.uid() OR app.has_role('hr') OR app.is_admin())
  WITH CHECK (user_id = app.uid() OR app.has_role('hr') OR app.is_admin());

-- HR reads every task (and with it sections, comments, collaborators and
-- activity) to see each person's to-do and what they're working on. Writing
-- stays with project members (decision in docs/DECISIONS.md).
CREATE OR REPLACE FUNCTION app.can_view_tasks(pid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT app.has_role('hr') OR (app.has_role('designer_dev', 'pm', 'sales', 'c_level') AND app.is_project_member(pid))
$$;
