-- CreateEnum
CREATE TYPE "client_payment_status" AS ENUM ('on_track', 'due_soon', 'late');

-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "payment_status_override" "client_payment_status",
ADD COLUMN     "payment_status_override_at" TIMESTAMPTZ,
ADD COLUMN     "payment_status_override_by" UUID;

-- ---------------------------------------------------------------------------
-- clients: the payment status (Late / Due soon / On track) follows the
-- client's pending payment requests; PM, Sales and C-Level may set it by hand
-- (payment_status_override) until it's cleared. Who set it and when are
-- stamped here, never written by the caller.
--
-- A new client code — or a changed one — is 2–3 capital letters (ACM). Codes
-- set before this rule (2–6 letters, clients_code_format) stay valid on their
-- client; they're locked once it has projects anyway.
--
-- Existing RLS policies and grants on clients cover the new columns.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.clients_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.code <> OLD.code AND EXISTS (SELECT 1 FROM public.projects p WHERE p.client_id = OLD.id) THEN
    RAISE EXCEPTION 'The client code can''t change once the client has projects' USING ERRCODE = 'check_violation';
  END IF;
  IF (TG_OP = 'INSERT' OR NEW.code <> OLD.code) AND NEW.code !~ '^[A-Z]{2,3}$' THEN
    RAISE EXCEPTION 'A client code is 2–3 letters, no numbers' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' OR NEW.payment_status_override IS DISTINCT FROM OLD.payment_status_override THEN
    NEW.payment_status_override_by := CASE WHEN NEW.payment_status_override IS NULL THEN NULL ELSE app.uid() END;
    NEW.payment_status_override_at := CASE WHEN NEW.payment_status_override IS NULL THEN NULL ELSE now() END;
  ELSE
    NEW.payment_status_override_by := OLD.payment_status_override_by;
    NEW.payment_status_override_at := OLD.payment_status_override_at;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER clients_guard ON public.clients;
CREATE TRIGGER clients_guard BEFORE INSERT OR UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION app.clients_guard();
