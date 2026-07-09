-- 0007_cosmic_coils_leaderboard.sql
-- Global leaderboard for Cosmic Coils (anonymous arcade play — no auth).
--
-- APPLIED 2026-07-09 to the MULTIPLAYER project wugoxdewcdxzfppgzohy (the same
-- project coilnet's Realtime uses — it has Postgres too), via the pooler DB
-- connection in api_config.json → supabase.db. This file is the record of that
-- change; it is idempotent (IF NOT EXISTS / OR REPLACE) so re-running is safe.
--
-- Model: a flat scores table with public READ (RLS policy) and a single
-- SECURITY DEFINER submit RPC callable by anon (players aren't signed in).
-- All validation is server-side so the public anon key can't spam garbage.

CREATE TABLE IF NOT EXISTS public.cc_leaderboard (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       text NOT NULL,
  length     integer NOT NULL,
  biome      text NOT NULL,
  mode       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- top-N by length is the only query; index it descending
CREATE INDEX IF NOT EXISTS idx_cc_leaderboard_length ON public.cc_leaderboard (length DESC);
CREATE INDEX IF NOT EXISTS idx_cc_leaderboard_created ON public.cc_leaderboard (created_at DESC);

ALTER TABLE public.cc_leaderboard ENABLE ROW LEVEL SECURITY;
-- public read (leaderboards are public); writes ONLY via the RPC below
DROP POLICY IF EXISTS "cc_leaderboard_public_read" ON public.cc_leaderboard;
CREATE POLICY "cc_leaderboard_public_read" ON public.cc_leaderboard FOR SELECT USING (true);

-- ── SUBMIT RPC ──────────────────────────────────────────────────────────────
-- Anonymous-safe score submission with server-side clamping/sanitising.
-- Returns the new row's global rank (1 = best) so the client can celebrate.
CREATE OR REPLACE FUNCTION public.cc_submit_score(
  p_name text, p_len integer, p_biome text, p_mode text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name  text;
  v_len   integer;
  v_biome text;
  v_mode  text;
  v_rank  integer;
BEGIN
  -- sanitise
  v_name  := left(coalesce(nullif(btrim(p_name), ''), 'Serpent'), 14);
  v_len   := least(greatest(coalesce(p_len, 0), 1), 5000000);   -- 1 .. 5M (mass is uncapped, but sane)
  v_biome := lower(coalesce(p_biome, ''));
  IF v_biome NOT IN ('verdant','ember','glacier','dune','abyss') THEN v_biome := 'verdant'; END IF;
  v_mode  := lower(coalesce(p_mode, ''));
  IF v_mode NOT IN ('practice','online') THEN v_mode := 'practice'; END IF;

  -- ignore trivially small runs (spawn deaths) so the board stays meaningful
  IF v_len < 20 THEN
    RETURN jsonb_build_object('stored', false, 'reason', 'too_small');
  END IF;

  INSERT INTO public.cc_leaderboard (name, length, biome, mode)
  VALUES (v_name, v_len, v_biome, v_mode);

  SELECT count(*) + 1 INTO v_rank FROM public.cc_leaderboard WHERE length > v_len;

  -- keep the table bounded: prune everything below the top 1000 occasionally
  IF (random() < 0.02) THEN
    DELETE FROM public.cc_leaderboard
    WHERE id IN (
      SELECT id FROM public.cc_leaderboard ORDER BY length DESC OFFSET 1000
    );
  END IF;

  RETURN jsonb_build_object('stored', true, 'rank', v_rank, 'length', v_len);
END;
$$;

REVOKE ALL ON FUNCTION public.cc_submit_score(text, integer, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.cc_submit_score(text, integer, text, text) TO anon, authenticated;
GRANT SELECT ON public.cc_leaderboard TO anon, authenticated;
