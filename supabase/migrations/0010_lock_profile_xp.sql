-- ForgeFlow Games -- lock profile XP/level and achievement unlocks to the server, PART B (2026-10-05)
-- Project: qkidwgyapmitrdxnavmi. Spec: forgeflow-games/docs/portal_xp_fix_proposal.md Part B.
--
-- APPLY ONLY AFTER (1) 0009_unlock_achievement_rpc.sql is live AND (2) the new portal client (gameBridge calls
-- supabase.rpc('unlock_achievement', ...)) is deployed and one real unlock has been seen to land with the right XP.
-- If this goes first, the OLD client's user_achievements insert is denied (its error is ignored) and its addXP write is
-- silently pinned: unlocks are lost until the tab reloads (stale open tabs behave the same way after this migration).
--
-- WHAT IT DOES
--   * BEFORE INSERT OR UPDATE trigger on public.profiles: when the statement runs as an API role (anon / authenticated, i.e.
--     the publishable key or a user JWT) xp and level are pinned (INSERT -> 0 / 1, UPDATE -> OLD values), silently, no error.
--     SECURITY DEFINER functions run as their owner (postgres) and service_role / the SQL editor / the Management API run as
--     themselves, so unlock_achievement(), handle_new_user, bt_* RPCs, the portal admin "edit"/"reset" and any repair pass.
--   * user_achievements: the owner-insert policy is dropped and INSERT/UPDATE/DELETE/TRUNCATE are revoked from anon and
--     authenticated; SELECT stays (profile + achievements pages read it). Writes go through unlock_achievement() only.
--   * The sequence user_achievements_id_seq is deliberately NOT touched, so the rollback below stays a two-liner.
--
-- UPSERT SEMANTICS (the thing the self-test proves): a client upsert (INSERT ... ON CONFLICT (id) DO UPDATE SET xp =
-- EXCLUDED.xp, as PostgREST generates for supabase-js .upsert()) runs the BEFORE INSERT trigger first (EXCLUDED then carries
-- xp 0 / level 1), then, on conflict, the BEFORE UPDATE trigger fires on the DO UPDATE path and pins xp/level back to the
-- row's OLD values. The BEFORE UPDATE trigger runs last, so an existing player's xp is NOT reset by UserMenu's/signUp's upsert.
--
-- HOW TO APPLY: same as 0009 (Management API / dry-run helper; the file ends with COMMIT;). No NOTIFY needed (no schema shape change).
--
-- ROLLBACK (also valid inside the same session if something unexpected shows up):
--   DROP TRIGGER profiles_protect_xp ON public.profiles;
--   CREATE POLICY "user_achievements_owner_insert" ON public.user_achievements FOR INSERT WITH CHECK (auth.uid() = user_id);
--   GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.user_achievements TO anon, authenticated;
--   (the policy is the only thing that let authenticated insert; anon/authenticated had the table grants from Supabase defaults)
--
-- OPTIONAL belt and braces, NOT in this file: a column-level UPDATE grant on profiles. Do NOT apply the proposal's version
-- (GRANT UPDATE (username, avatar_url, is_online, current_game_slug, last_seen_at)): PostgREST upserts emit
-- ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id, ..., and Postgres checks UPDATE privilege on every SET column, so without
-- 'id' in the list every client profile upsert would fail with 42501. The trigger above already closes the hole.
--
-- SELF-TEST (in-transaction, fake signed-in users, rolled back by a subtransaction; a failed check raises XP_SELFTEST_FAIL and
-- aborts the WHOLE migration; success writes "self-test PASS" into the comment on profiles_protect_xp()):
--   trigger shape | table privileges + dropped policy | direct xp/level UPDATE pinned (row visible, so the pin and not RLS held) |
--   PostgREST-style upsert cannot reset or raise an existing player's xp (UserMenu payload and a hostile payload) |
--   fresh INSERT cannot start above 0/1 | presence/profile updates still work | the definer RPC still adds xp through the trigger |
--   direct user_achievements insert denied, reads still work | service_role + postgres writes pass (service_role skipped, and
--   reported as skipped, if the session user cannot SET ROLE service_role) | nothing left behind.

BEGIN;

SET LOCAL lock_timeout = '10s';     -- fail fast (and roll back) instead of queueing behind a long transaction on profiles

DO $pre$
BEGIN
  IF to_regprocedure('public.unlock_achievement(bigint,text)') IS NULL
     OR to_regprocedure('public.ff_level_from_xp(integer)') IS NULL THEN
    RAISE EXCEPTION 'XP_LOCK_PRECHECK_FAIL: apply 0009_unlock_achievement_rpc.sql first (unlock_achievement / ff_level_from_xp missing)';
  END IF;
END
$pre$;

-- ------------------------------ 1. profiles: API roles cannot set xp / level ------------------------------
CREATE OR REPLACE FUNCTION public.profiles_protect_xp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.xp := 0;  NEW.level := 1;
    ELSE
      NEW.xp := OLD.xp;  NEW.level := OLD.level;
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS profiles_protect_xp ON public.profiles;
CREATE TRIGGER profiles_protect_xp
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_protect_xp();

-- ------------------------------ 2. user_achievements: unlocks only through unlock_achievement() ------------------------------
DROP POLICY IF EXISTS "user_achievements_owner_insert" ON public.user_achievements;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.user_achievements FROM anon, authenticated;

-- ------------------------------ 3. self-test (inside this transaction) ------------------------------
DO $selftest$
DECLARE
  u1 uuid := gen_random_uuid();
  u2 uuid := gen_random_uuid();
  v_sfx    text := left(gen_random_uuid()::text, 8);
  v_un1    text;
  v_un2    text;
  v_game   bigint;
  sa text; sb text;
  rec      record;
  r        jsonb;
  x        integer;
  lv       integer;
  n        bigint;
  v_en     text;
  v_type   integer;
  v_online boolean;
  v_slug   text;
  ok       boolean;
  can_sr   boolean;
  checks   integer := 0;
  skipped  integer := 0;
  msg      text;
  v_comment text;
BEGIN
  v_un1 := 'xp_selftest_' || left(u1::text, 8);
  v_un2 := 'xp_selftest_' || left(u2::text, 8);

  BEGIN   -- subtransaction: everything below is rolled back at the end (on top of the explicit deletes)

    -- 1. trigger shape: enabled, row-level, BEFORE, INSERT + UPDATE (not DELETE)
    SELECT t.tgenabled::text, t.tgtype::integer INTO v_en, v_type
      FROM pg_trigger t
     WHERE t.tgrelid = 'public.profiles'::regclass AND t.tgname = 'profiles_protect_xp' AND NOT t.tgisinternal;
    IF v_en IS DISTINCT FROM 'O' OR (v_type & 1) <> 1 OR (v_type & 2) <> 2 OR (v_type & 4) <> 4
       OR (v_type & 16) <> 16 OR (v_type & 8) <> 0 THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 1 trigger shape wrong (enabled=% tgtype=%)', v_en, v_type;
    END IF;
    checks := checks + 1;

    -- 2. table privileges: no write for anon/authenticated, SELECT kept, service_role keeps what the portal admin tool needs
    FOR rec IN SELECT ro.rolname, pr.priv
                 FROM (VALUES ('anon'), ('authenticated')) AS ro(rolname),
                      (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) AS pr(priv)
    LOOP
      IF has_table_privilege(rec.rolname, 'public.user_achievements', rec.priv) THEN
        RAISE EXCEPTION 'XP_SELFTEST_FAIL 2 % still has % on user_achievements', rec.rolname, rec.priv;
      END IF;
    END LOOP;
    IF NOT has_table_privilege('anon', 'public.user_achievements', 'SELECT')
       OR NOT has_table_privilege('authenticated', 'public.user_achievements', 'SELECT')
       OR NOT has_table_privilege('service_role', 'public.user_achievements', 'INSERT')
       OR NOT has_table_privilege('service_role', 'public.user_achievements', 'DELETE') THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 2 SELECT lost for anon/authenticated, or service_role lost INSERT/DELETE';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies pp
                WHERE pp.schemaname = 'public' AND pp.tablename = 'user_achievements'
                  AND pp.policyname = 'user_achievements_owner_insert') THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 2 user_achievements_owner_insert policy still exists';
    END IF;
    checks := checks + 1;

    -- fixtures (as postgres): any existing game, two achievements of our own (5 and 15 points), two fake users
    SELECT g.id INTO v_game FROM public.games g ORDER BY g.id LIMIT 1;
    IF v_game IS NULL THEN
      INSERT INTO public.games (slug, title) VALUES ('xp-selftest-' || v_sfx, 'XP selftest') RETURNING id INTO v_game;
    END IF;
    sa := 'zz_xpt_a_' || v_sfx;  sb := 'zz_xpt_b_' || v_sfx;
    INSERT INTO public.achievements (game_id, slug, name, description, tier, points) VALUES
      (v_game, sa, 'xpt a', 'selftest fixture', 'bronze', 5),
      (v_game, sb, 'xpt b', 'selftest fixture', 'silver', 15);

    INSERT INTO auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at) VALUES
      (u1, 'authenticated', 'authenticated', 'xp-selftest-' || u1 || '@invalid.test', jsonb_build_object('username', v_un1), now(), now()),
      (u2, 'authenticated', 'authenticated', 'xp-selftest-' || u2 || '@invalid.test', jsonb_build_object('username', v_un2), now(), now());
    INSERT INTO public.profiles (id, username) VALUES (u1, v_un1), (u2, v_un2) ON CONFLICT (id) DO NOTHING;
    SELECT count(*) INTO n FROM public.profiles p WHERE p.id IN (u1, u2) AND p.xp = 0 AND p.level = 1;
    IF n <> 2 THEN RAISE EXCEPTION 'XP_SELFTEST_FAIL setup: expected 2 fresh profiles (handle_new_user through the trigger), got %', n; END IF;
    DELETE FROM public.profiles p WHERE p.id = u2;                    -- u2 plays "a user whose profile row does not exist yet"

    -- postgres seeds u1 at 310 xp / level 3 (a write by the owner role must pass the trigger)
    UPDATE public.profiles p SET xp = 310, level = 3 WHERE p.id = u1;
    SELECT p.xp, p.level INTO x, lv FROM public.profiles p WHERE p.id = u1;
    IF x <> 310 OR lv <> 3 THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL setup: the trigger blocked a write by the owner role (xp=% level=%)', x, lv;
    END IF;

    -- -- act as u1, signed in --
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', u1::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';

    -- 3. direct write of xp/level is pinned; the row IS visible to the UPDATE (ROW_COUNT 1), so the pin, not RLS, held
    UPDATE public.profiles p SET xp = 999999, level = 50 WHERE p.id = u1;
    GET DIAGNOSTICS n = ROW_COUNT;
    SELECT p.xp, p.level INTO x, lv FROM public.profiles p WHERE p.id = u1;
    IF n <> 1 OR x <> 310 OR lv <> 3 THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 3 direct write: rows=% xp=% level=% (expected 1 / 310 / 3)', n, x, lv;
    END IF;
    checks := checks + 1;

    -- 4. PostgREST-style upsert on an EXISTING profile (supabase-js .upsert -> ON CONFLICT (id) DO UPDATE SET <every sent column> =
    --    EXCLUDED.<column>): UserMenu's payload (level 1, xp 0) must not reset xp 310, a hostile payload must not raise it
    INSERT INTO public.profiles (id, username, avatar_url, level, xp)
    VALUES (u1, v_un1, NULL, 1, 0)
    ON CONFLICT (id) DO UPDATE SET avatar_url = EXCLUDED.avatar_url, id = EXCLUDED.id, level = EXCLUDED.level,
                                   username = EXCLUDED.username, xp = EXCLUDED.xp;
    SELECT p.xp, p.level INTO x, lv FROM public.profiles p WHERE p.id = u1;
    IF x <> 310 OR lv <> 3 THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 4a upsert (level 1, xp 0) changed an existing profile: xp=% level=% (expected 310 / 3)', x, lv;
    END IF;
    INSERT INTO public.profiles (id, username, avatar_url, level, xp)
    VALUES (u1, v_un1, NULL, 50, 999999)
    ON CONFLICT (id) DO UPDATE SET avatar_url = EXCLUDED.avatar_url, id = EXCLUDED.id, level = EXCLUDED.level,
                                   username = EXCLUDED.username, xp = EXCLUDED.xp;
    SELECT p.xp, p.level INTO x, lv FROM public.profiles p WHERE p.id = u1;
    IF x <> 310 OR lv <> 3 THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 4b hostile upsert changed an existing profile: xp=% level=% (expected 310 / 3)', x, lv;
    END IF;
    checks := checks + 1;

    -- 5. presence / profile updates still work for the client (setOnlineStatus, signOut): only xp/level are pinned
    UPDATE public.profiles p SET is_online = true, last_seen_at = now(), current_game_slug = 'xp-selftest' WHERE p.id = u1;
    GET DIAGNOSTICS n = ROW_COUNT;
    SELECT p.is_online, p.current_game_slug INTO v_online, v_slug FROM public.profiles p WHERE p.id = u1;
    IF n <> 1 OR NOT coalesce(v_online, false) OR v_slug IS DISTINCT FROM 'xp-selftest' THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 5 presence update: rows=% is_online=% slug=%', n, v_online, v_slug;
    END IF;
    checks := checks + 1;

    -- 6. the SECURITY DEFINER RPC still adds xp through the trigger (current_user inside it is the owner, not authenticated)
    r := public.unlock_achievement(v_game, sa);
    SELECT p.xp, p.level INTO x, lv FROM public.profiles p WHERE p.id = u1;
    IF NOT coalesce((r->>'unlocked')::boolean, false) OR (r->>'xp_gained')::integer IS DISTINCT FROM 5
       OR x <> 315 OR lv <> 3 THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 6 unlock_achievement through the trigger: % profile xp=% level=% (expected 315 / 3)', r, x, lv;
    END IF;
    checks := checks + 1;

    -- 7. direct unlock insert is denied (42501) and writes nothing; reads (profile + achievements pages) still work
    ok := false;
    BEGIN
      INSERT INTO public.user_achievements (user_id, achievement_id)
      SELECT u1, a.id FROM public.achievements a WHERE a.game_id = v_game AND a.slug = sb;
    EXCEPTION WHEN insufficient_privilege THEN
      ok := true;
    END;
    SELECT count(*) INTO n FROM public.user_achievements ua WHERE ua.user_id = u1;
    IF NOT ok OR n <> 1 THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 7 direct insert denied=% unlock_rows_visible=% (expected true / 1)', ok, n;
    END IF;
    checks := checks + 1;

    -- -- act as u2: signed in, NO profile row yet (the self-heal upsert path) --
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', u2::text, true);

    -- 8. a fresh profile cannot start above xp 0 / level 1 (INSERT path of the trigger)
    INSERT INTO public.profiles (id, username, level, xp) VALUES (u2, v_un2, 50, 999999);
    SELECT p.xp, p.level INTO x, lv FROM public.profiles p WHERE p.id = u2;
    IF x <> 0 OR lv <> 1 THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 8 fresh insert: xp=% level=% (expected 0 / 1)', x, lv;
    END IF;
    checks := checks + 1;

    -- 9. service_role (portal admin "edit"/"reset", repairs) still writes xp/level. The role switch is probed on its own so a
    --    session that may not SET ROLE service_role is reported as SKIPPED instead of failing for the wrong reason.
    EXECUTE 'RESET ROLE';
    can_sr := true;
    BEGIN
      EXECUTE 'SET LOCAL ROLE service_role';
      EXECUTE 'RESET ROLE';
    EXCEPTION WHEN insufficient_privilege THEN
      can_sr := false;
    END;
    IF can_sr THEN
      EXECUTE 'SET LOCAL ROLE service_role';
      UPDATE public.profiles p SET xp = 777, level = 5 WHERE p.id = u1;
      GET DIAGNOSTICS n = ROW_COUNT;
      EXECUTE 'RESET ROLE';
      SELECT p.xp, p.level INTO x, lv FROM public.profiles p WHERE p.id = u1;
      IF n <> 1 OR x <> 777 OR lv <> 5 THEN
        RAISE EXCEPTION 'XP_SELFTEST_FAIL 9 service_role write blocked: rows=% xp=% level=%', n, x, lv;
      END IF;
      checks := checks + 1;
    ELSE
      skipped := skipped + 1;
      RAISE NOTICE 'XP_SELFTEST check 9 (service_role write) SKIPPED: the session user cannot SET ROLE service_role';
    END IF;

    -- 10. postgres / SQL editor (Part C repair path) still writes xp/level
    UPDATE public.profiles p SET xp = 123, level = 2 WHERE p.id = u1;
    SELECT p.xp, p.level INTO x, lv FROM public.profiles p WHERE p.id = u1;
    IF x <> 123 OR lv <> 2 THEN
      RAISE EXCEPTION 'XP_SELFTEST_FAIL 10 owner-role write blocked: xp=% level=%', x, lv;
    END IF;
    checks := checks + 1;

    -- 11. clean up: delete the fake users (cascades profiles + unlock rows), fixtures, any fixture game
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
    DELETE FROM auth.users WHERE id IN (u1, u2);
    DELETE FROM public.achievements WHERE game_id = v_game AND slug IN (sa, sb);
    DELETE FROM public.games WHERE slug = 'xp-selftest-' || v_sfx;
    SELECT (SELECT count(*) FROM auth.users WHERE id IN (u1, u2))
         + (SELECT count(*) FROM public.profiles WHERE id IN (u1, u2))
         + (SELECT count(*) FROM public.user_achievements WHERE user_id IN (u1, u2))
         + (SELECT count(*) FROM public.achievements WHERE game_id = v_game AND slug IN (sa, sb))
         + (SELECT count(*) FROM public.games WHERE slug = 'xp-selftest-' || v_sfx)
      INTO n;
    IF n <> 0 THEN RAISE EXCEPTION 'XP_SELFTEST_FAIL 11 % test rows left after cleanup', n; END IF;
    checks := checks + 1;

    -- success: unwind the subtransaction (belt and braces: nothing the test touched survives)
    RAISE EXCEPTION USING ERRCODE = 'XP000', MESSAGE = format('XP_SELFTEST_PASS %s checks', checks);
  EXCEPTION WHEN SQLSTATE 'XP000' THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
  END;

  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  IF msg IS NULL OR msg NOT LIKE 'XP_SELFTEST_PASS%' OR checks + skipped <> 11 THEN
    RAISE EXCEPTION 'XP_SELFTEST_FAIL did not complete (msg=%, checks=%, skipped=%)', msg, checks, skipped;
  END IF;
  IF (SELECT count(*) FROM auth.users WHERE id IN (u1, u2)) <> 0
     OR (SELECT count(*) FROM public.achievements WHERE slug LIKE 'zz\_xpt\_%\_' || v_sfx) <> 0 THEN
    RAISE EXCEPTION 'XP_SELFTEST_FAIL rows survived the rollback';
  END IF;

  v_comment := format('Pins xp/level for API roles (0010_lock_profile_xp.sql). Migration self-test PASS: %s/11 checks (%s skipped) at %s UTC.',
                      checks, skipped, to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'));
  EXECUTE format('COMMENT ON FUNCTION public.profiles_protect_xp() IS %L', v_comment);
  RAISE NOTICE '%', v_comment;
END;
$selftest$;

COMMIT;
