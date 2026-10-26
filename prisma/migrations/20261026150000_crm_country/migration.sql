-- Companies and People: the free-text location becomes a country, picked
-- from the world map's names (lib/geo/countries.ts) so the country tracker
-- can count it. What was typed before is kept as is.
ALTER TABLE public.crm_companies RENAME COLUMN location TO country;
ALTER TABLE public.crm_people RENAME COLUMN location TO country;
ALTER TABLE public.crm_companies RENAME CONSTRAINT crm_companies_location TO crm_companies_country;
ALTER TABLE public.crm_people RENAME CONSTRAINT crm_people_location TO crm_people_country;
