-- CreateEnum
CREATE TYPE "obligation_kind" AS ENUM ('payroll', 'bpjs', 'tax', 'other');

-- CreateEnum
CREATE TYPE "obligation_recurrence" AS ENUM ('monthly', 'yearly', 'once');

-- CreateTable
CREATE TABLE "obligations" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "kind" "obligation_kind" NOT NULL,
    "recurrence" "obligation_recurrence" NOT NULL DEFAULT 'monthly',
    "day_of_month" INTEGER NOT NULL,
    "month" INTEGER,
    "on_date" DATE,
    "amount_estimate" DECIMAL(14,2),
    "currency" TEXT NOT NULL DEFAULT 'IDR',
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "obligations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "obligation_completions" (
    "id" UUID NOT NULL,
    "obligation_id" UUID NOT NULL,
    "due_date" DATE NOT NULL,
    "done_by" UUID,
    "done_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "obligation_completions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "obligation_completions_obligation_id_due_date_key" ON "obligation_completions"("obligation_id", "due_date");

-- AddForeignKey
ALTER TABLE "obligation_completions" ADD CONSTRAINT "obligation_completions_obligation_id_fkey" FOREIGN KEY ("obligation_id") REFERENCES "obligations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligation_completions" ADD CONSTRAINT "obligation_completions_done_by_fkey" FOREIGN KEY ("done_by") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ===========================================================================
-- Phase 2 · M10 Finance — obligations (PRD/PRD_Fase-2.md "Finance":
-- kalender kewajiban). Finance keeps them; the People module keeps payroll
-- and BPJS, which the HR calendar shows too. Studio Report reads.
-- ===========================================================================
ALTER TABLE public.obligations
  ADD CONSTRAINT obligations_day CHECK (day_of_month BETWEEN 1 AND 31),
  ADD CONSTRAINT obligations_month CHECK (month IS NULL OR month BETWEEN 1 AND 12),
  ADD CONSTRAINT obligations_shape CHECK (
    (recurrence = 'monthly') OR (recurrence = 'yearly' AND month IS NOT NULL) OR (recurrence = 'once' AND on_date IS NOT NULL)
  ),
  ADD CONSTRAINT obligations_amount CHECK (amount_estimate IS NULL OR amount_estimate >= 0);

-- Who may keep an obligation of this kind.
CREATE OR REPLACE FUNCTION app.can_manage_obligation(k public.obligation_kind) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT app.has_module('finance') OR (k IN ('payroll', 'bpjs') AND app.has_module('people'))
$$;

CREATE OR REPLACE FUNCTION app.can_view_obligation(k public.obligation_kind) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT app.has_module('finance', 'studio_report') OR (k IN ('payroll', 'bpjs') AND app.has_module('people'))
$$;

CREATE OR REPLACE FUNCTION app.obligations_derive() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' AND app.via_rls() THEN
    NEW.created_by := app.uid();
  ELSIF TG_OP = 'UPDATE' AND (NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at <> OLD.created_at) THEN
    RAISE EXCEPTION 'These fields are managed by the system' USING ERRCODE = '42501';
  END IF;
  IF NEW.recurrence = 'once' THEN
    NEW.day_of_month := extract(day FROM NEW.on_date)::int;
    NEW.month := NULL;
  ELSIF NEW.recurrence = 'monthly' THEN
    NEW.month := NULL;
    NEW.on_date := NULL;
  ELSE
    NEW.on_date := NULL;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER obligations_derive BEFORE INSERT OR UPDATE ON public.obligations
  FOR EACH ROW EXECUTE FUNCTION app.obligations_derive();

CREATE OR REPLACE FUNCTION app.obligation_completions_derive() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF app.via_rls() THEN
    NEW.done_by := app.uid();
    NEW.done_at := now();
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER obligation_completions_derive BEFORE INSERT ON public.obligation_completions
  FOR EACH ROW EXECUTE FUNCTION app.obligation_completions_derive();

ALTER TABLE public.obligations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.obligation_completions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.obligations, public.obligation_completions FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.obligations TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.obligation_completions TO authenticated;

CREATE POLICY obligations_select ON public.obligations FOR SELECT TO authenticated
  USING (app.can_view_obligation(kind));
CREATE POLICY obligations_write ON public.obligations FOR ALL TO authenticated
  USING (app.can_manage_obligation(kind)) WITH CHECK (app.can_manage_obligation(kind));

CREATE POLICY obligation_completions_select ON public.obligation_completions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.obligations o WHERE o.id = obligation_id));
CREATE POLICY obligation_completions_insert ON public.obligation_completions FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.obligations o WHERE o.id = obligation_id AND app.can_manage_obligation(o.kind)));
CREATE POLICY obligation_completions_delete ON public.obligation_completions FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.obligations o WHERE o.id = obligation_id AND app.can_manage_obligation(o.kind)));

-- Defaults to edit (PRD open question: the studio's own tax dates). Indonesian
-- standard deadlines: PPh setor by the 15th, SPT Masa by the 20th, BPJS by
-- the 10th, SPT Tahunan Badan by 30 April. Payroll on the 25th.
INSERT INTO public.obligations (id, title, kind, recurrence, day_of_month, month, notes) VALUES
  (gen_random_uuid(), 'Payroll', 'payroll', 'monthly', 25, NULL, 'Salaries transferred.'),
  (gen_random_uuid(), 'BPJS Kesehatan & Ketenagakerjaan', 'bpjs', 'monthly', 10, NULL, 'Contributions for the month.'),
  (gen_random_uuid(), 'PPh 21 / 23 / 4(2) payment', 'tax', 'monthly', 15, NULL, 'Pay last month''s withholding tax.'),
  (gen_random_uuid(), 'SPT Masa PPh filing', 'tax', 'monthly', 20, NULL, 'File last month''s returns.'),
  (gen_random_uuid(), 'SPT Tahunan Badan', 'tax', 'yearly', 30, 4, 'Annual corporate return.');
