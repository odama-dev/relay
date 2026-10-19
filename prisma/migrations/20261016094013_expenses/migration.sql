-- CreateEnum
CREATE TYPE "expense_kind" AS ENUM ('opex', 'capex');

-- CreateEnum
CREATE TYPE "expense_category" AS ENUM ('software', 'utilities', 'rent', 'internet', 'equipment', 'marketing', 'professional_services', 'travel', 'other');

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "expense_date" DATE NOT NULL,
    "vendor" TEXT NOT NULL,
    "description" TEXT,
    "category" "expense_category" NOT NULL,
    "kind" "expense_kind" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "notes" TEXT,
    "receipt_path" TEXT,
    "receipt_name" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expenses_expense_date_idx" ON "expenses"("expense_date");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------

ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_amount_positive CHECK (amount > 0),
  ADD CONSTRAINT expenses_currency_iso CHECK (currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT expenses_vendor_present CHECK (length(btrim(vendor)) > 0);

-- ---------------------------------------------------------------------------
-- Row Level Security — Finance and C-Level read and record expenses; nobody
-- else sees them (not even through the Supabase API).
-- ---------------------------------------------------------------------------

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.expenses FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expenses TO authenticated;

CREATE POLICY expenses_select ON public.expenses FOR SELECT TO authenticated
  USING (app.has_role('finance', 'c_level'));
CREATE POLICY expenses_insert ON public.expenses FOR INSERT TO authenticated
  WITH CHECK (app.has_role('finance', 'c_level') AND created_by = app.uid());
CREATE POLICY expenses_update ON public.expenses FOR UPDATE TO authenticated
  USING (app.has_role('finance', 'c_level')) WITH CHECK (app.has_role('finance', 'c_level'));
CREATE POLICY expenses_delete ON public.expenses FOR DELETE TO authenticated
  USING (app.has_role('finance', 'c_level'));

-- The recorder can't be rewritten after the fact.
CREATE OR REPLACE FUNCTION app.expenses_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'The person who recorded an expense can''t change' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER expenses_guard BEFORE UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION app.expenses_guard();
