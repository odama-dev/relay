-- Sales feedback, Oct 2026 (2): the pipeline follows outreach —
-- Researched → Contacted → Replied → Call booked → Proposal → Won / Lost.
-- Contacted and Replied move by themselves from synced email (auto_key):
-- an email sent to a deal's person / company marks it Contacted, one back
-- from them marks it Replied. Only forward, never past a later stage.

ALTER TABLE public.pipeline_stages ADD COLUMN auto_key text;
ALTER TABLE public.pipeline_stages
  ADD CONSTRAINT pipeline_stages_auto_key CHECK (auto_key IN ('contacted', 'replied')),
  ADD CONSTRAINT pipeline_stages_auto_key_unique UNIQUE (auto_key);

-- ---------------------------------------------------------------------------
-- The new stages, and every deal (and its history) moved onto them.
-- Old open stages map by name; anything unknown becomes Researched.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE stage_map (old_id uuid PRIMARY KEY, new_id uuid NOT NULL);

DO $$
DECLARE
  target record;
  sid uuid;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('Researched', 'open'::public.stage_category, 5, 0, NULL::text),
      ('Contacted', 'open', 15, 1, 'contacted'),
      ('Replied', 'open', 25, 2, 'replied'),
      ('Call booked', 'open', 40, 3, NULL),
      ('Proposal', 'open', 60, 4, NULL)
    ) AS t(name, category, probability, position, auto_key)
  LOOP
    INSERT INTO public.pipeline_stages (id, name, category, probability, position, auto_key, is_hidden, created_at)
    VALUES (gen_random_uuid(), target.name || ' (new)', target.category, target.probability, target.position, target.auto_key, false, now());
  END LOOP;

  INSERT INTO stage_map (old_id, new_id)
  SELECT s.id, n.id
  FROM public.pipeline_stages s
  JOIN public.pipeline_stages n ON n.name = CASE lower(s.name)
      WHEN 'lead' THEN 'Researched (new)'
      WHEN 'researched' THEN 'Researched (new)'
      WHEN 'qualified' THEN 'Contacted (new)'
      WHEN 'contacted' THEN 'Contacted (new)'
      WHEN 'replied' THEN 'Replied (new)'
      WHEN 'discovery call' THEN 'Call booked (new)'
      WHEN 'call booked' THEN 'Call booked (new)'
      ELSE 'Proposal (new)'
    END
  WHERE s.category = 'open' AND s.name NOT LIKE '% (new)'
    AND lower(s.name) IN ('lead', 'researched', 'qualified', 'contacted', 'replied', 'discovery call', 'call booked', 'committed', 'proposal sent', 'proposal', 'negotiation');

  -- Any other (custom) open stage starts over as Researched.
  SELECT id INTO sid FROM public.pipeline_stages WHERE name = 'Researched (new)';
  INSERT INTO stage_map (old_id, new_id)
  SELECT s.id, sid FROM public.pipeline_stages s
  WHERE s.category = 'open' AND s.name NOT LIKE '% (new)' AND s.id NOT IN (SELECT old_id FROM stage_map);
END $$;

-- A remap, not a move: no history rows, no new stage dates.
ALTER TABLE public.deals DISABLE TRIGGER USER;
UPDATE public.deals d SET stage_id = m.new_id, probability = n.probability
FROM stage_map m JOIN public.pipeline_stages n ON n.id = m.new_id
WHERE d.stage_id = m.old_id;
UPDATE public.deals d SET last_stage_id = m.new_id FROM stage_map m WHERE d.last_stage_id = m.old_id;
ALTER TABLE public.deals ENABLE TRIGGER USER;

UPDATE public.deal_stage_history h SET from_stage_id = m.new_id FROM stage_map m WHERE h.from_stage_id = m.old_id;
UPDATE public.deal_stage_history h SET to_stage_id = m.new_id FROM stage_map m WHERE h.to_stage_id = m.old_id;
-- Two old stages that became one leave a "Proposal → Proposal" step.
DELETE FROM public.deal_stage_history WHERE from_stage_id = to_stage_id;

DELETE FROM public.pipeline_stages WHERE id IN (SELECT old_id FROM stage_map);
UPDATE public.pipeline_stages SET name = replace(name, ' (new)', '') WHERE name LIKE '% (new)';
DROP TABLE stage_map;
-- Won and Lost close the board.
UPDATE public.pipeline_stages SET position = 5 WHERE category = 'won';
UPDATE public.pipeline_stages SET position = 6 WHERE category = 'lost';

-- ---------------------------------------------------------------------------
-- auto_key is the system's: it can't be set or moved from the app.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.pipeline_stages_auto_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF app.via_rls() AND (
    (TG_OP = 'INSERT' AND NEW.auto_key IS NOT NULL)
    OR (TG_OP = 'UPDATE' AND NEW.auto_key IS DISTINCT FROM OLD.auto_key)
  ) THEN
    RAISE EXCEPTION 'Contacted and Replied are set by the system' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.auto_key IS NOT NULL AND NEW.category <> 'open' THEN
    RAISE EXCEPTION 'An automatic stage stays open' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER pipeline_stages_auto_guard BEFORE INSERT OR UPDATE ON public.pipeline_stages
  FOR EACH ROW EXECUTE FUNCTION app.pipeline_stages_auto_guard();

-- ---------------------------------------------------------------------------
-- Deals advanced by email (mail sync / send, after a write; system only).
-- Mail counts from the deal's lead date. Replied first, so a deal answered
-- before it was marked contacted lands on Replied. Last contact follows the
-- newest email either way. Returns the deals moved.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.mail_advance_deals(p_account uuid DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  tz text := coalesce((SELECT value #>> '{}' FROM public.app_settings WHERE key = 'timezone'), 'Asia/Jakarta');
  moved integer := 0;
  n integer;
  st record;
BEGIN
  UPDATE public.deals d SET last_contact_on = m.last_on
  FROM (
    SELECT d2.id, max((mm.sent_at AT TIME ZONE tz)::date) AS last_on
    FROM public.deals d2
    JOIN public.mail_messages mm ON (mm.person_id = d2.person_id OR mm.company_id = d2.company_id)
    WHERE (p_account IS NULL OR mm.account_id = p_account) AND (mm.sent_at AT TIME ZONE tz)::date >= d2.lead_date
    GROUP BY d2.id
  ) m
  WHERE d.id = m.id AND (d.last_contact_on IS NULL OR d.last_contact_on < m.last_on);

  FOR st IN
    SELECT s.id, s.position, CASE s.auto_key WHEN 'replied' THEN 'inbound' ELSE 'outbound' END::public.mail_direction AS dir
    FROM public.pipeline_stages s WHERE s.auto_key IS NOT NULL
    ORDER BY CASE s.auto_key WHEN 'replied' THEN 0 ELSE 1 END
  LOOP
    UPDATE public.deals d SET stage_id = st.id
    FROM public.pipeline_stages cur
    WHERE cur.id = d.stage_id AND cur.category = 'open' AND cur.position < st.position
      AND EXISTS (
        SELECT 1 FROM public.mail_messages mm
        WHERE mm.direction = st.dir
          AND (mm.person_id = d.person_id OR mm.company_id = d.company_id)
          AND (p_account IS NULL OR mm.account_id = p_account)
          AND (mm.sent_at AT TIME ZONE tz)::date >= d.lead_date
      );
    GET DIAGNOSTICS n = ROW_COUNT;
    moved := moved + n;
  END LOOP;
  RETURN moved;
END $$;

REVOKE ALL ON FUNCTION app.mail_advance_deals(uuid) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION app.mail_advance_deals(uuid) TO service_role;

-- Mail already synced before this release.
SELECT app.mail_advance_deals(NULL);
