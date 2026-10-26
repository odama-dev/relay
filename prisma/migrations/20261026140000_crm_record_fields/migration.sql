-- Companies and People get the Attio-style record fields: several domains /
-- emails / phones, location, socials, size and funding. The existing
-- `domain`, `email` and `phone` stay as the primary one — the first of the
-- list — so mail matching and the tables keep reading them. RLS is
-- row-level (crm_companies_* / crm_people_* in 20261022130000_sales_crm), so
-- the new columns fall under the same policies and grants.

-- AlterTable
ALTER TABLE "crm_companies" ADD COLUMN     "angellist" TEXT,
ADD COLUMN     "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "domains" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "employee_range" TEXT,
ADD COLUMN     "estimated_arr" TEXT,
ADD COLUMN     "facebook" TEXT,
ADD COLUMN     "founded_on" DATE,
ADD COLUMN     "funding_currency" TEXT,
ADD COLUMN     "funding_raised" DECIMAL(18,2),
ADD COLUMN     "instagram" TEXT,
ADD COLUMN     "linkedin" TEXT,
ADD COLUMN     "location" TEXT,
ADD COLUMN     "twitter" TEXT,
ADD COLUMN     "twitter_followers" INTEGER;

-- AlterTable
ALTER TABLE "crm_people" ADD COLUMN     "angellist" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "emails" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "facebook" TEXT,
ADD COLUMN     "instagram" TEXT,
ADD COLUMN     "linkedin" TEXT,
ADD COLUMN     "location" TEXT,
ADD COLUMN     "phones" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "twitter" TEXT,
ADD COLUMN     "twitter_followers" INTEGER;

-- ===========================================================================
-- Checks: ranges are codes from lib/crm/pure.ts; money is numeric + ISO code.
-- ===========================================================================
ALTER TABLE public.crm_companies
  ADD CONSTRAINT crm_companies_estimated_arr CHECK (estimated_arr IN ('0-1m', '1m-10m', '10m-50m', '50m-100m', '100m-250m', '250m-500m', '500m-1b', '1b-10b', '10b+')),
  ADD CONSTRAINT crm_companies_employee_range CHECK (employee_range IN ('1-10', '11-50', '51-200', '201-500', '501-1k', '1k-5k', '5k-10k', '10k-50k', '50k+')),
  ADD CONSTRAINT crm_companies_funding CHECK (funding_raised IS NULL OR (funding_raised >= 0 AND funding_currency ~ '^[A-Z]{3}$')),
  ADD CONSTRAINT crm_companies_twitter_followers CHECK (twitter_followers >= 0),
  ADD CONSTRAINT crm_companies_location CHECK (length(location) <= 200),
  ADD CONSTRAINT crm_companies_lists CHECK (cardinality(domains) <= 20 AND cardinality(categories) <= 30);
ALTER TABLE public.crm_people
  ADD CONSTRAINT crm_people_twitter_followers CHECK (twitter_followers >= 0),
  ADD CONSTRAINT crm_people_location CHECK (length(location) <= 200),
  ADD CONSTRAINT crm_people_lists CHECK (cardinality(emails) <= 20 AND cardinality(phones) <= 20);

-- ===========================================================================
-- The primary value follows its list, and an edit of the primary alone (a
-- table cell, an import) replaces the list's first entry. Lists are trimmed,
-- de-duplicated and never null; domains and emails are lowercase.
-- ===========================================================================
CREATE OR REPLACE FUNCTION app.crm_clean_list(list text[], lower_case boolean) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT coalesce(array_agg(v ORDER BY first), '{}')
  FROM (
    SELECT CASE WHEN lower_case THEN lower(btrim(x)) ELSE btrim(x) END AS v, min(i) AS first
    FROM unnest(coalesce(list, '{}')) WITH ORDINALITY AS t(x, i)
    WHERE btrim(x) <> ''
    GROUP BY 1
  ) s
$$;

-- The list after the primary was set on its own: it becomes the first entry.
CREATE OR REPLACE FUNCTION app.crm_set_primary(list text[], primary_value text, lower_case boolean) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN primary_value IS NULL OR btrim(primary_value) = '' THEN app.crm_clean_list(list[2:], lower_case)
    ELSE app.crm_clean_list(array_prepend(primary_value, list[2:]), lower_case)
  END
$$;

CREATE OR REPLACE FUNCTION app.crm_companies_lists() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.domains IS NOT DISTINCT FROM OLD.domains AND NEW.domain IS DISTINCT FROM OLD.domain THEN
    NEW.domains := app.crm_set_primary(NEW.domains, NEW.domain, true);
  ELSIF TG_OP = 'INSERT' AND cardinality(coalesce(NEW.domains, '{}')) = 0 THEN
    NEW.domains := app.crm_set_primary('{}', NEW.domain, true);
  ELSE
    NEW.domains := app.crm_clean_list(NEW.domains, true);
  END IF;
  NEW.domain := NEW.domains[1];
  NEW.categories := app.crm_clean_list(NEW.categories, false);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.crm_people_lists() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.emails IS NOT DISTINCT FROM OLD.emails AND NEW.email IS DISTINCT FROM OLD.email THEN
    NEW.emails := app.crm_set_primary(NEW.emails, NEW.email, true);
  ELSIF TG_OP = 'INSERT' AND cardinality(coalesce(NEW.emails, '{}')) = 0 THEN
    NEW.emails := app.crm_set_primary('{}', NEW.email, true);
  ELSE
    NEW.emails := app.crm_clean_list(NEW.emails, true);
  END IF;
  NEW.email := NEW.emails[1];
  IF TG_OP = 'UPDATE' AND NEW.phones IS NOT DISTINCT FROM OLD.phones AND NEW.phone IS DISTINCT FROM OLD.phone THEN
    NEW.phones := app.crm_set_primary(NEW.phones, NEW.phone, false);
  ELSIF TG_OP = 'INSERT' AND cardinality(coalesce(NEW.phones, '{}')) = 0 THEN
    NEW.phones := app.crm_set_primary('{}', NEW.phone, false);
  ELSE
    NEW.phones := app.crm_clean_list(NEW.phones, false);
  END IF;
  NEW.phone := NEW.phones[1];
  RETURN NEW;
END $$;

CREATE TRIGGER crm_companies_lists BEFORE INSERT OR UPDATE ON public.crm_companies FOR EACH ROW EXECUTE FUNCTION app.crm_companies_lists();
CREATE TRIGGER crm_people_lists BEFORE INSERT OR UPDATE ON public.crm_people FOR EACH ROW EXECUTE FUNCTION app.crm_people_lists();

-- Backfill: today's single values become the first (only) entry.
UPDATE public.crm_companies SET domains = app.crm_set_primary('{}', domain, true);
UPDATE public.crm_people SET emails = app.crm_set_primary('{}', email, true), phones = app.crm_set_primary('{}', phone, false);
