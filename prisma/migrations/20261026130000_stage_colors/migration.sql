-- A stage's own dot colour on the board (the CRM option palette); none
-- follows its category. The outreach stages read as a heat scale:
-- Researched gray, Contacted orange, Replied red.
ALTER TABLE public.pipeline_stages ADD COLUMN color text;
ALTER TABLE public.pipeline_stages
  ADD CONSTRAINT pipeline_stages_color CHECK (color IN ('gray', 'blue', 'green', 'amber', 'red', 'purple', 'teal', 'orange'));

UPDATE public.pipeline_stages SET color = 'gray' WHERE lower(name) = 'researched';
UPDATE public.pipeline_stages SET color = 'orange' WHERE auto_key = 'contacted';
UPDATE public.pipeline_stages SET color = 'red' WHERE auto_key = 'replied';
