-- Phase 2 · M6: the PM can turn a due date request down.
ALTER TABLE "due_date_changes" ADD COLUMN "rejected_at" TIMESTAMPTZ, ADD COLUMN "rejected_by" UUID;
ALTER TABLE "due_date_changes" ADD CONSTRAINT "due_date_changes_rejected_by_fkey" FOREIGN KEY ("rejected_by") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- Review notes live on the round (written by the server after the decision
-- passed RLS through the task update).
ALTER TABLE public.review_rounds ADD CONSTRAINT review_rounds_note_length CHECK (note IS NULL OR length(note) <= 2000);

CREATE OR REPLACE FUNCTION app.due_date_changes_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  pid uuid;
BEGIN
  SELECT t.project_id INTO pid FROM public.tasks t WHERE t.id = NEW.task_id;
  IF TG_OP = 'INSERT' THEN
    NEW.requested_by := coalesce(app.uid(), NEW.requested_by);
    NEW.from_date := (SELECT t.due_date FROM public.tasks t WHERE t.id = NEW.task_id);
    NEW.rejected_at := NULL;
    NEW.rejected_by := NULL;
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
    IF OLD.approved_at IS NOT NULL OR OLD.rejected_at IS NOT NULL THEN
      RAISE EXCEPTION 'This change was already decided' USING ERRCODE = '42501';
    END IF;
    IF app.via_rls() AND NOT app.can_manage_project(pid) THEN
      RAISE EXCEPTION 'Only the project''s PM can decide a due date change' USING ERRCODE = '42501';
    END IF;
    IF NEW.rejected_at IS NOT NULL OR NEW.rejected_by IS NOT NULL THEN
      NEW.rejected_by := coalesce(app.uid(), NEW.rejected_by);
      NEW.rejected_at := now();
      NEW.approved_by := NULL;
      NEW.approved_at := NULL;
    ELSE
      NEW.approved_by := coalesce(app.uid(), NEW.approved_by);
      NEW.approved_at := now();
    END IF;
  END IF;
  RETURN NEW;
END $$;
