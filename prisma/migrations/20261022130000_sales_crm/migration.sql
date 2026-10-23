-- CreateEnum
CREATE TYPE "crm_object" AS ENUM ('company', 'person');

-- CreateEnum
CREATE TYPE "crm_attribute_type" AS ENUM ('text', 'number', 'currency', 'date', 'checkbox', 'select', 'multi_select', 'url', 'email', 'phone');

-- CreateTable
CREATE TABLE "crm_attributes" (
    "id" UUID NOT NULL,
    "object" "crm_object" NOT NULL,
    "name" TEXT NOT NULL,
    "type" "crm_attribute_type" NOT NULL,
    "options" JSONB NOT NULL DEFAULT '[]',
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ,

    CONSTRAINT "crm_attributes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_companies" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "description" TEXT,
    "owner_id" UUID,
    "client_id" UUID,
    "values" JSONB NOT NULL DEFAULT '{}',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ,

    CONSTRAINT "crm_companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_people" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "job_title" TEXT,
    "company_id" UUID,
    "owner_id" UUID,
    "values" JSONB NOT NULL DEFAULT '{}',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ,

    CONSTRAINT "crm_people_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_attributes_object_position_idx" ON "crm_attributes"("object", "position");

-- CreateIndex
CREATE UNIQUE INDEX "crm_companies_client_id_key" ON "crm_companies"("client_id");

-- CreateIndex
CREATE INDEX "crm_people_company_id_idx" ON "crm_people"("company_id");

-- AddForeignKey
ALTER TABLE "crm_companies" ADD CONSTRAINT "crm_companies_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_companies" ADD CONSTRAINT "crm_companies_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_companies" ADD CONSTRAINT "crm_companies_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_people" ADD CONSTRAINT "crm_people_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "crm_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_people" ADD CONSTRAINT "crm_people_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_people" ADD CONSTRAINT "crm_people_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ===========================================================================
-- Sales CRM — Companies and People (Attio-style records) with custom
-- columns. The Sales module edits; Studio Report reads. Records and columns
-- are archived, not deleted.
-- ===========================================================================
ALTER TABLE public.crm_attributes
  ADD CONSTRAINT crm_attributes_name CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  ADD CONSTRAINT crm_attributes_options CHECK (jsonb_typeof(options) = 'array');
ALTER TABLE public.crm_companies
  ADD CONSTRAINT crm_companies_name CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  ADD CONSTRAINT crm_companies_values CHECK (jsonb_typeof("values") = 'object');
ALTER TABLE public.crm_people
  ADD CONSTRAINT crm_people_name CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  ADD CONSTRAINT crm_people_values CHECK (jsonb_typeof("values") = 'object');

-- Who made it is the system's to say; a column's object and type are fixed
-- once created (values already written depend on them).
CREATE OR REPLACE FUNCTION app.crm_stamp() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF app.via_rls() THEN
      NEW.created_by := app.uid();
    END IF;
  ELSIF NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'These fields are managed by the system' USING ERRCODE = '42501';
  END IF;
  IF TG_TABLE_NAME = 'crm_attributes' THEN
    IF TG_OP = 'UPDATE' AND (NEW.object <> OLD.object OR NEW.type <> OLD.type) THEN
      RAISE EXCEPTION 'A column''s type can''t change — add a new column instead' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER crm_attributes_stamp BEFORE INSERT OR UPDATE ON public.crm_attributes FOR EACH ROW EXECUTE FUNCTION app.crm_stamp();
CREATE TRIGGER crm_companies_stamp BEFORE INSERT OR UPDATE ON public.crm_companies FOR EACH ROW EXECUTE FUNCTION app.crm_stamp();
CREATE TRIGGER crm_people_stamp BEFORE INSERT OR UPDATE ON public.crm_people FOR EACH ROW EXECUTE FUNCTION app.crm_stamp();

ALTER TABLE public.crm_attributes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_people ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_attributes, public.crm_companies, public.crm_people FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.crm_attributes, public.crm_companies, public.crm_people TO authenticated;

CREATE POLICY crm_attributes_select ON public.crm_attributes FOR SELECT TO authenticated USING (app.has_module('sales', 'studio_report'));
CREATE POLICY crm_attributes_insert ON public.crm_attributes FOR INSERT TO authenticated WITH CHECK (app.has_module('sales'));
CREATE POLICY crm_attributes_update ON public.crm_attributes FOR UPDATE TO authenticated USING (app.has_module('sales')) WITH CHECK (app.has_module('sales'));
CREATE POLICY crm_companies_select ON public.crm_companies FOR SELECT TO authenticated USING (app.has_module('sales', 'studio_report'));
CREATE POLICY crm_companies_insert ON public.crm_companies FOR INSERT TO authenticated WITH CHECK (app.has_module('sales'));
CREATE POLICY crm_companies_update ON public.crm_companies FOR UPDATE TO authenticated USING (app.has_module('sales')) WITH CHECK (app.has_module('sales'));
CREATE POLICY crm_people_select ON public.crm_people FOR SELECT TO authenticated USING (app.has_module('sales', 'studio_report'));
CREATE POLICY crm_people_insert ON public.crm_people FOR INSERT TO authenticated WITH CHECK (app.has_module('sales'));
CREATE POLICY crm_people_update ON public.crm_people FOR UPDATE TO authenticated USING (app.has_module('sales')) WITH CHECK (app.has_module('sales'));

-- Existing clients and their contacts start as companies and people.
INSERT INTO public.crm_companies (id, name, client_id, created_at)
SELECT gen_random_uuid(), c.name, c.id, c.created_at FROM public.clients c WHERE NOT c.is_archived;
INSERT INTO public.crm_people (id, name, email, job_title, company_id, created_at)
SELECT gen_random_uuid(), ct.name, ct.email, ct.title, cc.id, now()
FROM public.client_contacts ct JOIN public.crm_companies cc ON cc.client_id = ct.client_id;
