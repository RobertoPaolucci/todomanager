-- Store the complete tariff on its existing experience/channel row: atomic edits,
-- existing RLS (server/service_role only), no new public access or booking updates.
CREATE FUNCTION public.valid_participant_price_tiers(tiers jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path = '' AS $$
DECLARE t jsonb; k text; lo integer; hi integer; previous_hi integer := 0; amount numeric;
BEGIN
  IF jsonb_typeof(tiers) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  FOR t IN SELECT value FROM jsonb_array_elements(tiers) ORDER BY (value->>'min_participants')::numeric LOOP
    IF jsonb_typeof(t) IS DISTINCT FROM 'object'
      OR jsonb_typeof(t->'min_participants') IS DISTINCT FROM 'number'
      OR jsonb_typeof(t->'max_participants') IS DISTINCT FROM 'number'
      OR (t->>'min_participants')::numeric <> trunc((t->>'min_participants')::numeric)
      OR (t->>'max_participants')::numeric <> trunc((t->>'max_participants')::numeric) THEN RETURN false; END IF;
    lo := (t->>'min_participants')::integer; hi := (t->>'max_participants')::integer;
    IF lo < 1 OR hi < lo OR hi > 100000 OR lo <= previous_hi THEN RETURN false; END IF;
    previous_hi := hi;
    FOREACH k IN ARRAY ARRAY['your_unit_price','public_unit_price','supplier_adult_unit_cost'] LOOP
      IF jsonb_typeof(t->k) IS DISTINCT FROM 'number' THEN RETURN false; END IF;
      amount := (t->>k)::numeric;
      IF amount < 0 OR amount > 9999999999.99 OR amount <> round(amount, 2) THEN RETURN false; END IF;
    END LOOP;
  END LOOP;
  RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public.valid_participant_price_tiers(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.valid_participant_price_tiers(jsonb) TO service_role;

ALTER TABLE public.experience_channel_prices
  ADD COLUMN pricing_mode text NOT NULL DEFAULT 'fixed',
  ADD COLUMN price_tiers jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD CONSTRAINT experience_channel_pricing_mode CHECK (pricing_mode IN ('fixed','tiered')),
  ADD CONSTRAINT experience_channel_valid_tiers CHECK (public.valid_participant_price_tiers(price_tiers)),
  ADD CONSTRAINT experience_channel_tiers_required CHECK (pricing_mode <> 'tiered' OR jsonb_array_length(price_tiers) > 0);
ALTER TABLE public.experience_channel_prices ENABLE ROW LEVEL SECURITY;
-- Snapshot the selected tariff for invoices even if the list is later edited or disabled.
-- NULL on all historical rows; never infer or backfill their pricing.
ALTER TABLE public.bookings ADD COLUMN price_tier_snapshot jsonb;

-- Guard the requested configuration; never reinterpret mappings or touch bookings.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.experiences WHERE id = 12 AND bokun_id = '1052970' AND NOT is_group_pricing)
    OR NOT EXISTS (SELECT 1 FROM public.channels WHERE id = 4 AND lower(replace(name, ' ', '')) = 'todointheworld')
    OR (SELECT count(*) FROM public.experience_channel_prices WHERE experience_id = 12 AND channel_id = 4) <> 1
  THEN RAISE EXCEPTION 'Expected E-Bike experience/channel configuration not found'; END IF;
  UPDATE public.experience_channel_prices SET pricing_mode = 'tiered', price_tiers = (
    SELECT jsonb_agg(jsonb_build_object('min_participants', n, 'max_participants', n,
      'your_unit_price', price, 'public_unit_price', price, 'supplier_adult_unit_cost', price) ORDER BY n)
    FROM (VALUES (2,110),(3,95),(4,85),(5,80),(6,76)) AS rates(n,price)
  ) WHERE experience_id = 12 AND channel_id = 4;
END;
$$;
