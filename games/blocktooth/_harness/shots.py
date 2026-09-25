#!/usr/bin/env python
"""BLOCKTOOTH shot battery — the evidence CONTRACT §15 gate 6's harsh visual critic judges.

    python _harness/shots.py                                  # the whole battery, headed Chrome
    python _harness/shots.py --groups titans --titans molo --biomes grideast
    python _harness/shots.py --groups bosses,tabloid --headless
    python _harness/shots.py --via bt                         # capture through __BT__.shot(name)

Groups (all by default, in this order):
  menus    title → select step 1 with EACH titan focused → step 2 with EACH biome focused →
           DROP IN → the open slate (all driven by real keys)
  titans   every titan × every biome at Size I / III / V in the gameplay camera, plus a centre
           crop (`*_close.png`, a crop of the same frame — not a re-render) for model detail; the
           first titan of each biome also captures that biome's open slate
  hud      HUD mid-fight (Size II, a spawned mix, real keys driving), a MUTATION REPORT draft,
           the MASS BREACH size-up sting
  bosses   every city boss (PARKADE-6 GRID-EAST, IRON GULLY WHITE STACKS, CAISSON-4 LOCKWATER): the entrance, then up to
           --boss-shots distinct attacks frozen MID-TELEGRAPH (sim frozen via __BT__.freeze while
           the paint is 30–85 % through its windup)
  tabloid  a run-end tabloid (a Size I titan left standing in front of a boss)
  v2fx     (FEATURES_V2 §15.4, lane L6) UPROAR per titan at Size I and V, zoom 1, fired with a real E
           and frozen mid-BLAST (ult_<titan>_s1 / _s5); the three objectives + their markers at Size
           I / III / V (obj_markers_s1/s3/s5); the five power-up tokens at Size III (powerups_s3)
  v2hud    (FEATURES_V2 §4.1 / §15.4, lane L8) the v2 HUD at 1280×720 and 1920×1080 (abilitybar_1280 /
           abilitybar_1920): a full ability bar + `+N`, UPROAR meter, ACTIVE panel, tracker rows, one
           broadcast toast alert and one v2 GOAL MET toast live together
  cine     (FEATURES_V2 §11 / §15.4, lane L10) the WARD-7 STREET CAM opening, FULL variant, one titan
           per biome (GRID-EAST MOLO · WHITE STACKS VOLT-KITE · LOCKWATER HEARTHBACK, or --titans in
           order): S1 street cam after the crash zoom, S2 low-angle close-up mid-SNARL, S3 mid-crane
           (cine_<biome>_s1 / _s2 / _s3). The profile's cineSeen is cleared first so the FULL cut plays.
  screens  (FEATURES_V2 §15.4, lane L9 flows) with a crafted profile + bests in localStorage (removed
           again afterwards): goals_screen (real G on the title), select_next_unlock (NEXT PERMIT
           PENDING slip), draft_evo_banish_lock (an evolution offered, then real X + C),
           tabloid_endless (clear → real K → a death → the EXTENDED COVERAGE EDITION)
  parkade  (FEATURES_V2 §15.4, lane L7 flow) PARKADE-6 vs MOLO at Size V in GRID-EAST, the sim frozen
           and stepped to each beat: parkade_intro / ramp / barrier / tow / deckdrop / collapse /
           till_open / jammed

Output: _shots/battery/<name>.png, _shots/battery/manifest.json (one entry per shot: group, kind,
titan, biome, rank, screen, state summary, capture method, ok) and labelled contact sheets
_shots/battery/_contact_<group>.png (Pillow). Cheats (?dev=1) are allowed here — this is a camera,
not a playtest; menus are still navigated with real keys.
Exit: 0 every planned shot captured · 1 some shots missing (listed) · 2 setup failed.
"""
import argparse
import json
import math
import os
import re
import shutil
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (BIOME_BOSS, BIOME_NAMES, BIOMES, ROMAN, ROOT, SHOTS, TITAN_NAMES, TITANS,  # noqa: E402
                    HarnessError, Session, add_common_args, build_url, compact_state, detect_focus,
                    diag_problems, ensure_play, navigate_cards, print_diagnostics, save_report, set_rank,
                    world_to_keys, xp_to_next)

GROUPS = ("menus", "titans", "hud", "bosses", "tabloid", "v2fx", "v2hud", "cine", "screens", "parkade")
RANK_ARG = {"I": 0, "II": 1, "III": 2, "IV": 3, "V": 4}
BOSS_NAMES = {"caisson4": "CAISSON-4", "irongully": "IRON GULLY", "parkade6": "PARKADE-6"}

# Boss paint in flight (read-only world): the boss's current attack + its un-fired telegraphs.
BOSS_TG_JS = r"""
() => {
  const W = window.__H_W__ && window.__H_W__();
  const B = window.__BT__;
  let s = null; try { s = B && B.state(); } catch (_) {}
  const out = { screen: s && s.screen, stateBoss: s && s.boss, world: !!W };
  if (!W) return out;
  const T = W.titan;
  out.titan = T ? { x: T.x, z: T.z, heading: T.heading, height: T.height, abilityCd: T.abilityCd } : null;
  const b = W.boss;
  if (!b) return out;
  out.boss = { id: b.id, alive: b.alive, x: b.x, z: b.z, introT: b.introT, attack: b.attack, phase: b.phase,
               hp: b.hp, maxHp: b.maxHp };
  let best = null;
  for (const tg of (W.telegraphs || [])) {
    if (!tg.alive || tg.owner !== 'boss' || tg.fired || !(tg.windup > 0)) continue;
    const frac = tg.t / tg.windup;
    const c = { id: tg.id, style: tg.style, tag: tg.tag || '', frac, windup: tg.windup, k: tg.shape && tg.shape.k };
    if (!best || Math.abs(frac - 0.55) < Math.abs(best.frac - 0.55)) best = c;
  }
  out.tg = best;
  return out;
}
"""

# Nearest live enemies (for the HUD fight drive).
ENEMY_DIR_JS = r"""
() => {
  const W = window.__H_W__ && window.__H_W__();
  if (!W || !W.titan) return null;
  const T = W.titan;
  let n = 0, sx = 0, sz = 0, best = null, bd = Infinity;
  for (const e of (W.enemies || [])) {
    if (!e.alive) continue;
    const d = Math.hypot(e.x - T.x, e.z - T.z);
    if (d < bd) { bd = d; best = e; }
    if (d < 60) { n++; sx += e.x; sz += e.z; }
  }
  const tx = n ? sx / n : (best ? best.x : T.x), tz = n ? sz / n : (best ? best.z : T.z);
  return { x: T.x, z: T.z, heading: T.heading, tx, tz, n, nearest: bd, abilityCd: T.abilityCd };
}
"""


def safe_name(s):
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", str(s)).strip("_") or "x"


class Battery:
    def __init__(self, sess, args, log):
        self.sess = sess
        self.args = args
        self.log = log
        self.out = os.path.abspath(args.out_dir)
        self.items = []
        self.missing = []
        self.planned = 0
        self.group = None
        self.overlays_cleared = 0
        os.makedirs(self.out, exist_ok=True)

    def olog(self, msg):
        """Log sink for ensure_play: Size V eats a building a second, so level-up drafts reopen
        constantly — count them, print only the first few."""
        self.overlays_cleared += 1
        if self.overlays_cleared <= 3:
            self.log(msg + ("  (further overlay clears are counted, not logged)" if self.overlays_cleared == 3 else ""))

    def play_shot(self, name, kind, tries=6, **meta):
        """A gameplay shot with NO overlay: the screen must read `play` right before AND right after
        the capture (a draft that pops in between voids it and the shot is retaken)."""
        for attempt in range(tries):
            ok, scr = ensure_play(self.sess, 10, self.olog)
            if not ok:
                self.miss(name, "overlay would not clear (screen=%r)" % (scr,))
                return False
            time.sleep(0.35)
            if self.sess.screen() != "play":
                continue
            n_items, n_missing, n_planned = len(self.items), len(self.missing), self.planned
            self.shot(name, kind, **meta)
            before = self.items[-1].get("screen") if len(self.items) > n_items else None
            after = self.sess.screen()
            if (before == "play" and after == "play") or attempt == tries - 1:
                if after != "play" or before != "play":
                    self.items[-1]["overlayRisk"] = [before, after]
                return self.items[-1].get("ok", False)
            del self.items[n_items:]
            del self.missing[n_missing:]
            self.planned = n_planned
        self.miss(name, "an overlay kept reopening around the capture")
        return False

    # ─────────────────────────────── capture ───────────────────────────────
    def shot(self, name, kind, **meta):
        """Capture one frame as <out>/<name>.png and append a manifest entry."""
        self.planned += 1
        sess = self.sess
        path = os.path.join(self.out, name + ".png")
        s = sess.state() or {}
        how = "page"
        ok = False
        if self.args.via == "bt":
            okc, v = sess.bt_call("shot", "battery_" + name)
            cand = []
            if okc and isinstance(v, str):
                cand.append(v if os.path.isabs(v) else os.path.join(ROOT, v))
            cand.append(os.path.join(SHOTS, "battery_" + name + ".png"))
            for c in cand:
                if os.path.exists(c):
                    try:
                        shutil.move(c, path)
                        ok, how = True, "__BT__.shot"
                        break
                    except Exception as e:
                        self.log("    could not move %s: %s" % (c, e))
            if not ok:
                self.log("    __BT__.shot(%s) gave %r — falling back to page.screenshot" % (name, v))
        if not ok:
            ok = sess.screenshot(path)
        entry = {
            "name": name, "file": os.path.relpath(path, ROOT).replace("\\", "/"), "group": self.group, "kind": kind,
            "ok": bool(ok), "how": how, "wallT": round(time.time() - self.args._t0, 1),
            "screen": s.get("screen"), "titan": s.get("titan"), "biome": s.get("biome"), "seed": s.get("seed"),
            "rank": s.get("rank"), "level": s.get("level"), "simT": s.get("t"), "height": s.get("height"),
            "enemies": s.get("enemies"), "boss": s.get("boss"), "drafts": s.get("drafts"),
        }
        entry.update(meta)
        self.items.append(entry)
        if ok and kind == "titan" and self.args.close:
            cp = self.crop_close(path, name)
            if cp:
                entry["close"] = os.path.relpath(cp, ROOT).replace("\\", "/")
        self.log("  %s %-44s screen=%s rank=%s %s" % ("[ok]" if ok else "[!!]", name, s.get("screen"), s.get("rank"),
                                                     json.dumps(meta)[:120] if meta else ""))
        if not ok:
            self.missing.append("%s (capture failed)" % name)
        return ok

    def crop_close(self, path, name):
        """Centre crop of the gameplay frame (the camera centres the titan), upscaled for detail."""
        try:
            from PIL import Image
        except Exception:
            return None
        try:
            im = Image.open(path)
            W, H = im.size
            cw, ch = int(W * 0.42), int(H * 0.46)
            cx, cy = W // 2, int(H * 0.50)
            box = (max(0, cx - cw // 2), max(0, cy - ch // 2), min(W, cx + cw // 2), min(H, cy + ch // 2))
            c = im.crop(box)
            scale = max(1.0, 1100.0 / c.size[0])
            c = c.resize((int(c.size[0] * scale), int(c.size[1] * scale)), Image.LANCZOS)
            out = os.path.join(self.out, name + "_close.png")
            c.save(out)
            return out
        except Exception as e:
            self.log("    close crop failed: %s" % e)
            return None

    def miss(self, name, why):
        self.planned += 1
        self.missing.append("%s (%s)" % (name, why))
        self.items.append({"name": name, "group": self.group, "ok": False, "why": why})
        self.log("  [!!] %-44s MISSING: %s" % (name, why))

    # ─────────────────────────────── run control ───────────────────────────────
    def start_run(self, titan, biome, seed, slate):
        """Fresh run straight to the slate (slate=True) or to play. Returns (ok, screen)."""
        sess, a = self.sess, self.args
        sess.release_all()
        if a.use_newrun and sess.has_world():
            ok, v = sess.bt_call("newRun", {"titan": titan, "biome": biome, "seed": seed, "skipSlate": not slate})
            if not ok:
                self.log("    __BT__.newRun failed (%s) — reloading the page instead" % v)
            else:
                ok2, scr = sess.wait_screen(("slate", "play", "draft"), 90)
                if ok2:
                    return True, scr
        url = build_url(a.base, autostart=1, dev=1, titan=titan, biome=biome, seed=seed,
                        noslate=None if slate else 1, quality=a.quality)
        try:
            sess.goto(url)
        except Exception as e:
            return False, "navigation failed: %s" % str(e).splitlines()[0]
        if not sess.wait_bt(90):
            return False, "__BT__ never appeared"
        return sess.wait_screen(("slate", "play", "draft"), 90)

    def walk(self, seconds):
        """Hold the key set that walks the titan along its current heading (real keys)."""
        sess = self.sess
        s = sess.state() or {}
        h = s.get("heading")
        if not isinstance(h, (int, float)):
            h = 0.0
        keys = world_to_keys(math.sin(h), math.cos(h)) or {"KeyW"}
        t_end = time.time() + seconds
        while time.time() < t_end:
            scr = sess.screen()
            if scr != "play":
                sess.release_all()
                ensure_play(sess, 6, self.olog)
                continue
            sess.hold(keys)
            time.sleep(0.1)
        sess.release_all()

    def cheats_on(self, god=True, no_spawns=None):
        ok, v = self.sess.cheat("god", god)
        if not ok:
            self.log("    cheat.god failed: %s" % v)
        if no_spawns is not None:
            self.sess.cheat("noSpawns", no_spawns)
        return ok

    # ─────────────────────────────── groups ───────────────────────────────
    def g_menus(self):
        self.group = "menus"
        sess, a = self.sess, self.args
        url = build_url(a.base, dev=1, seed=a.seed, quality=a.quality)
        self.log("menus: open %s" % url)
        try:
            sess.goto(url)
        except Exception as e:
            self.miss("menu_title", "navigation failed: %s" % str(e).splitlines()[0])
            return
        if not sess.wait_bt(90):
            self.miss("menu_title", "__BT__ never appeared")
            return
        ok, scr = sess.wait_screen(("title", "select"), 60)
        if not ok:
            self.miss("menu_title", "never reached the title (screen=%r)" % (scr,))
            return
        if scr == "title":
            time.sleep(1.5)
            self.shot("menu_title", "menu")
            deadline = time.time() + 15
            while time.time() < deadline and sess.screen() == "title":
                sess.press("Enter")
                time.sleep(0.9)
        else:
            self.miss("menu_title", "app opened on %r, not the title" % scr)
        if sess.screen() != "select":
            self.miss("select_titan_*", "Enter did not open the select screen (screen=%r)" % (sess.screen(),))
            return
        time.sleep(1.5)                                   # portraits render + cards settle
        for t in TITANS:
            okn, how = navigate_cards(sess, TITANS, TITAN_NAMES, t, self.log)
            time.sleep(0.5)
            self.shot("select_titan_%s" % t, "menu", focus=t, navOk=okn, nav=how)
        okn, _ = navigate_cards(sess, TITANS, TITAN_NAMES, a.menu_titan, self.log)
        sess.press("Enter")
        time.sleep(0.9)
        bn = [BIOME_NAMES[b] for b in BIOMES]
        cur, info = detect_focus(sess, bn)
        if cur is None and not info.get("visible") and sess.screen() == "select":
            self.log("    biome cards not visible after Enter — pressing Enter once more (confirm bar)")
            sess.press("Enter")
            time.sleep(0.9)
        for b in BIOMES:
            okn, how = navigate_cards(sess, BIOMES, BIOME_NAMES, b, self.log)
            time.sleep(0.5)
            self.shot("select_biome_%s" % b, "menu", focus=b, navOk=okn, nav=how)
        navigate_cards(sess, BIOMES, BIOME_NAMES, a.menu_biome, self.log)
        sess.press("Enter")
        ok, scr = sess.wait_screen(("slate", "play"), 90)
        if not ok:
            self.miss("slate_menu_%s" % a.menu_biome, "DROP IN never reached the slate (screen=%r)" % (scr,))
            return
        if scr == "slate":
            time.sleep(1.4)
            self.shot("slate_menu_%s_%s" % (a.menu_titan, a.menu_biome), "slate", via="menus")
        else:
            self.miss("slate_menu_%s" % a.menu_biome, "DROP IN went straight to play (no slate)")

    def g_titans(self):
        self.group = "titans"
        a = self.args
        for bi, b in enumerate(a.biomes):
            for ti, t in enumerate(a.titans):
                want_slate = ti == 0
                base = "titan_%s_%s" % (t, b)
                self.log("titans: %s / %s" % (TITAN_NAMES[t], BIOME_NAMES[b]))
                ok, scr = self.start_run(t, b, a.seed + 10 * bi + ti, want_slate)
                if not ok:
                    for r in a.ranks:
                        self.miss("%s_%s" % (base, r), "run did not start: %s" % scr)
                    continue
                if want_slate:
                    if scr == "slate":
                        time.sleep(1.4)
                        self.shot("slate_%s" % b, "slate", titan=t, biome=b)
                    else:
                        self.miss("slate_%s" % b, "autostart went to %r, not the slate" % scr)
                okp, scr = ensure_play(self.sess, 20, self.olog)
                if not okp:
                    for r in a.ranks:
                        self.miss("%s_%s" % (base, r), "never reached play (screen=%r)" % (scr,))
                    continue
                self.cheats_on(god=True)
                time.sleep(0.8)
                for r in a.ranks:
                    idx = RANK_ARG[r]
                    name = "%s_%s" % (base, r)
                    if idx > 0:
                        okr, seen = set_rank(self.sess, idx, self.log)
                        if seen != idx:
                            self.log("    cheat.rank(%d) → rank %s" % (idx, seen))
                    self.walk(a.walk)
                    time.sleep(a.settle if idx > 0 else 1.0)
                    st = self.sess.state() or {}
                    self.play_shot(name, "titan", wantRank=idx, rankOk=st.get("rank") == idx)

    def g_hud(self):
        self.group = "hud"
        a, sess = self.args, self.sess
        t, b = a.hud_titan, a.hud_biome
        self.log("hud: %s / %s" % (TITAN_NAMES[t], BIOME_NAMES[b]))
        ok, scr = self.start_run(t, b, a.seed + 50, False)
        if not ok or not ensure_play(sess, 20, self.olog)[0]:
            for n in ("hud_fight_1", "hud_fight_2", "draft", "massbreach"):
                self.miss(n, "run did not start (%s)" % (scr,))
            return
        self.cheats_on(god=True)
        set_rank(sess, 1, self.log)
        time.sleep(2.2)
        for kind, n in (("android", 10), ("squad", 5), ("drone", 6), ("buggy", 3), ("tank", 1)):
            okc, v = sess.cheat("spawn", kind, n)
            if not okc:
                self.log("    cheat.spawn(%s, %d) failed: %s" % (kind, n, v))
        # drive into the fight with real keys; Space whenever the hook is ready
        for shot_i in (1, 2):
            t_end = time.time() + (4.0 if shot_i == 1 else 2.5)
            last_space = 0.0
            while time.time() < t_end:
                if sess.screen() != "play":
                    sess.release_all()
                    ensure_play(sess, 8, self.olog)
                    continue
                o = sess.safe_js(ENEMY_DIR_JS) or {}
                if o.get("n") or o.get("nearest", math.inf) < math.inf:
                    keys = world_to_keys(o["tx"] - o["x"], o["tz"] - o["z"]) or {"KeyW"}
                else:
                    keys = {"KeyW"}
                sess.hold(keys)
                cd = o.get("abilityCd")
                if (cd is None or cd <= 0) and time.time() - last_space > 1.5:
                    sess.press("Space")
                    last_space = time.time()
                time.sleep(0.12)
            self.play_shot("hud_fight_%d" % shot_i, "hud", keysHeld=sorted(sess.held))
        sess.release_all()
        # MUTATION REPORT
        s = sess.state() or {}
        if s.get("screen") != "draft":
            need = xp_to_next(s.get("level") or 1) * 2 + 10
            okc, v = sess.cheat("xp", need)
            if not okc:
                self.log("    cheat.xp failed: %s" % v)
        okd, scr = sess.wait_screen("draft", 8)
        if okd:
            time.sleep(1.2)                               # dossier cards deal in
            self.shot("draft", "draft", offer=(sess.state() or {}).get("drafts"))
            sess.press("Digit1")
            ensure_play(sess, 10, self.olog)
        else:
            self.miss("draft", "no draft screen after cheat.xp (screen=%r)" % (scr,))
        # MASS BREACH sting (banner sweeps in right after the rank-up)
        ensure_play(sess, 8, self.olog)
        set_rank(sess, 2, self.log)
        time.sleep(max(0.0, a.sting_delay - 0.6))
        self.play_shot("massbreach_III", "sting", tries=2)
        time.sleep(0.8)
        self.play_shot("massbreach_III_late", "sting", tries=2)

    def g_bosses(self):
        self.group = "bosses"
        a, sess = self.args, self.sess
        for b in a.boss_biomes:
            boss = BIOME_BOSS[b]
            bname = BOSS_NAMES.get(boss, boss)
            self.log("bosses: %s in %s" % (bname, BIOME_NAMES[b]))
            ok, scr = self.start_run(a.boss_titan, b, a.seed + 100, False)
            if not ok or not ensure_play(sess, 20, self.olog)[0]:
                self.miss("boss_%s_telegraph" % boss, "run did not start (%s)" % (scr,))
                continue
            self.cheats_on(god=True, no_spawns=True)
            sess.cheat("killAll")
            set_rank(sess, 4, self.log)
            time.sleep(2.5)
            okc, v = sess.cheat("boss")
            if not okc:
                self.miss("boss_%s_telegraph" % boss, "cheat.boss failed: %s" % v)
                continue
            intro_done = False
            t_boss = time.time()
            got = []
            last_attack = None
            attack_seen_t = None
            deadline = time.time() + a.boss_seconds
            while time.time() < deadline and len(got) < a.boss_shots:
                scr = sess.screen()
                if scr == "end":
                    break
                if scr != "play":
                    sess.release_all()
                    ensure_play(sess, 8, self.olog)
                    continue
                o = sess.safe_js(BOSS_TG_JS) or {}
                bo = o.get("boss")
                sb = o.get("stateBoss") if isinstance(o.get("stateBoss"), dict) else None
                if not intro_done and time.time() - t_boss > 2.0 and (bo or sb):
                    self.shot("boss_%s_intro" % boss, "boss", bossId=boss)
                    intro_done = True
                # drive toward the boss so the titan's auto attacks push it into later phases
                T = o.get("titan")
                if T and bo:
                    dx, dz = bo["x"] - T["x"], bo["z"] - T["z"]
                    d = math.hypot(dx, dz) or 1.0
                    if d < 2.2 * (T.get("height") or 60):
                        dx, dz = -dz, dx                  # circle it instead of standing in its feet
                    sess.hold(world_to_keys(dx, dz) or {"KeyW"})
                tg = o.get("tg")
                if o.get("world"):
                    attack = (bo or {}).get("attack") or (tg or {}).get("tag") or "attack"
                    # freeze MID-windup: the animated fill is visibly part-way (not a fresh outline, not the flash)
                    ready = tg and 0.45 <= tg["frac"] <= 0.85 and attack not in got and (bo or {}).get("introT", 0) <= 0
                else:
                    # no read-only world: time the freeze from state().boss.attack starting
                    attack = (sb or {}).get("attack")
                    if attack and attack != last_attack:
                        attack_seen_t = time.time()
                    last_attack = attack
                    ready = attack and attack not in got and attack_seen_t and time.time() - attack_seen_t >= 0.55
                if ready:
                    sess.release_all()
                    okf, fv = sess.bt_call("freeze", True)
                    time.sleep(0.4)
                    if sess.screen() != "play":
                        # a level-up draft opened between the observation and the freeze (the sim
                        # froze on the granting tick and the report opens a frame later): this frame
                        # would show the MUTATION REPORT, not the tell — unfreeze, clear it, retry
                        if okf:
                            sess.bt_call("freeze", False)
                        continue
                    self.shot("boss_%s_%s" % (boss, safe_name(attack)), "boss", bossId=boss, attack=attack,
                              telegraph=tg, frozen=okf, phase=(bo or sb or {}).get("phase"))
                    if okf:
                        sess.bt_call("freeze", False)
                    got.append(attack)
                    time.sleep(0.3)
                time.sleep(0.08)
            sess.release_all()
            if not intro_done:
                self.miss("boss_%s_intro" % boss, "boss never appeared in state()/world")
            if not got:
                self.miss("boss_%s_telegraph" % boss, "no boss telegraph caught mid-windup in %.0f s" % a.boss_seconds)

    def g_tabloid(self):
        self.group = "tabloid"
        a, sess = self.args, self.sess
        self.log("tabloid: a Size I %s left standing in front of %s" % (TITAN_NAMES[a.hud_titan], BOSS_NAMES[BIOME_BOSS["grideast"]]))
        ok, scr = self.start_run(a.hud_titan, "grideast", a.seed + 200, False)
        if not ok or not ensure_play(sess, 20, self.olog)[0]:
            self.miss("tabloid", "run did not start (%s)" % (scr,))
            return
        sess.cheat("god", False)
        okc, v = sess.cheat("boss")
        if not okc:
            self.log("    cheat.boss failed (%s) — spawning heavy armour instead" % v)
        t0 = time.time()
        escalated = False
        ended = False
        while time.time() - t0 < a.tabloid_seconds:
            scr = sess.screen()
            if scr == "end":
                ended = True
                break
            if scr == "draft":
                sess.press("Digit1")
                time.sleep(0.6)
                continue
            if scr == "pause":
                sess.press("Escape")
                time.sleep(0.6)
                continue
            if not escalated and (time.time() - t0 > a.tabloid_seconds * 0.4 or not okc):
                for kind, n in (("tank", 6), ("walker", 2), ("elite", 1), ("buggy", 6)):
                    sess.cheat("spawn", kind, n)
                escalated = True
            time.sleep(0.4)
        if not ended:
            self.miss("tabloid", "the run did not end within %.0f s (screen=%r)" % (a.tabloid_seconds, sess.screen()))
            return
        time.sleep(a.tabloid_delay)                      # the paper drops + prints
        self.shot("tabloid", "tabloid", run=(sess.state() or {}).get("run"))

    # ─────────────────────────────── v2 views (lane L6) ───────────────────────────────
    # Waits in the page until w.ult reaches (phase, t) and freezes the sim there: the UPROAR view runs on
    # the sim clock, so the frozen frame IS that moment of the blast.
    V2_ULT_WAIT_JS = r"""
    async ([phase, t]) => {
      const B = window.__BT__;
      const t0 = performance.now();
      while (performance.now() - t0 < 6000) {
        const W = B.world;
        if (W && W.ult && W.ult.phase === phase && W.ult.t >= t) {
          B.freeze(true);
          return { phase: W.ult.phase, t: W.ult.t, r: W.ult.r, H: W.titan.height };
        }
        await new Promise(r => requestAnimationFrame(r));
      }
      return null;
    }
    """
    # Lay the live tokens out in a row up the −z street from the titan (runs start on an intersection; the
    # camera sits at +x+z, so a row behind the titan along a road is never hidden by a building in front).
    # A camera set-up, like the other cheats here.
    V2_SPREAD_PU_JS = r"""() => {
      const W = window.__BT__.world, T = W.titan, H = T.height;
      const live = W.map.powerups.filter(p => p.alive);
      live.forEach((p, i) => { p.x = T.x - 0.3 * H; p.z = T.z - (2.0 + 1.25 * i) * H; p.t = 0.5; });
      return live.map(p => p.kind);
    }"""
    V2_ULT_BIOME = {"molo": "grideast", "voltkite": "lockwater", "hearthback": "whitestacks", "briarwick": "grideast"}

    def g_v2fx(self):
        self.group = "v2fx"
        a, sess = self.args, self.sess
        # UPROAR: real E, frozen 0.35 s into the BLAST, a mixed crowd on screen
        for titan in a.titans:
            for rank in (0, 4):
                name = "ult_%s_s%d" % (titan, rank + 1)
                ok, scr = self.start_run(titan, self.V2_ULT_BIOME[titan], a.seed + 300 + rank, False)
                if not ok or not ensure_play(sess, 20, self.olog)[0]:
                    self.miss(name, "run did not start (%s)" % (scr,))
                    continue
                self.cheats_on(True, True)
                if rank:
                    set_rank(sess, rank, self.log, settle_s=a.settle)
                sess.cheat("noSpawns", False)
                # a modest crowd: enough to show the pulses + arcs, not so many that their aim paint
                # stacks over the titan (hostile telegraphs are drawn on top of everything)
                for kind, n in (("android", 14), ("buggy", 4), ("drone", 4)):
                    sess.cheat("spawn", kind, n)
                time.sleep(2.0)
                if not ensure_play(sess, 10, self.olog)[0]:
                    self.miss(name, "overlay would not clear")
                    continue
                sess.cheat("ult", 100)
                time.sleep(0.25)
                sess.press("KeyE")
                info = sess.js(self.V2_ULT_WAIT_JS, ["blast", 0.35])
                if not info:
                    sess.bt_call("freeze", False)
                    self.miss(name, "UPROAR did not reach its blast after a real E (ult=%s)" % json.dumps((sess.state() or {}).get("v2", {}).get("ult")))
                    continue
                time.sleep(0.3)
                self.shot(name, "uproar", ult=info)
                sess.bt_call("freeze", False)
        # objectives + markers at Size I / III / V
        for rank in (0, 2, 4):
            name = "obj_markers_s%d" % (rank + 1)
            ok, scr = self.start_run(a.hud_titan, a.hud_biome, a.seed + 400 + rank, False)
            if not ok or not ensure_play(sess, 20, self.olog)[0]:
                self.miss(name, "run did not start (%s)" % (scr,))
                continue
            self.cheats_on(True, True)
            sess.cheat("killAll")
            if rank:
                set_rank(sess, rank, self.log, settle_s=a.settle)
            H = sess.safe_js("() => window.__BT__.world.titan.height", default=1.2) or 1.2
            placed = {}
            for kind, ahead in (("overloadSite", None), ("reliefDepot", 3.5 * H), ("recordsAnnex", None)):
                okc, v = sess.cheat("objective", kind, ahead) if ahead else sess.cheat("objective", kind)
                placed[kind] = v if okc else None
            time.sleep(1.2)
            if not ensure_play(sess, 10, self.olog)[0]:
                self.miss(name, "overlay would not clear")
                continue
            self.shot(name, "objectives", placed=placed, dom=(sess.state() or {}).get("v2dom"))
            # the same scene pulled back to the zoom limit (hold '-'): the sites' dressing on screen
            sess.hold({"Minus"})
            time.sleep(1.4)
            sess.release_all()
            time.sleep(0.6)
            if ensure_play(sess, 10, self.olog)[0]:
                self.shot(name + "_far", "objectives", zoom="max", dom=(sess.state() or {}).get("v2dom"))
            sess.press("KeyZ")
            time.sleep(0.8)
            if rank == 2:
                # sim cap: 3 tokens alive at once, so two frames cover the five kinds
                for batch, suffix in ((("redLight", "rushHour", "backPay"), ""), (("cleanup", "demolition"), "b")):
                    for kind in batch:
                        sess.cheat("powerup", kind)
                    kinds = sess.safe_js(self.V2_SPREAD_PU_JS, default=[])
                    time.sleep(1.0)
                    if ensure_play(sess, 10, self.olog)[0]:
                        self.shot("powerups_s3" + suffix, "powerups", powerups=kinds)

    # ─────────────────────────────── v2 HUD (lane L8) ───────────────────────────────
    # 13 owned cards (mixed rarities / stacks) + one evolution → a full ability bar with a `+N` slot; UPROAR
    # at ~74 %; an OVERLOAD SITE (raises the broadcast toast alert) + a RELIEF DEPOT + a RED LIGHT timer in
    # the tracker; one v2 GOAL MET toast live next to the broadcast toast (§4.1: they must not touch).
    V2_HUD_CARDS_JS = r"""async ([n, evo]) => {
      const E = await import('/src/upgrades/engine.ts'), D = await import('/src/upgrades/draft.ts'), U = await import('/src/data/upgrades.ts');
      const w = window.__BT__.world;
      const pool = U.UPGRADES.filter((u) => !u.evo && !u.perk && !u.locked && (!u.titan || u.titan === w.titanId));
      const pick = []; for (let i = 0; pick.length < n && i < pool.length * 7; i += 7) { const u = pool[i % pool.length]; if (!pick.includes(u)) pick.push(u); }
      pick.forEach((u, i) => { const st = Math.min(u.maxStacks, 1 + (i % 4)); for (let k = 0; k < st; k++) E.applyUpgrade(w, u.id); });
      const d = U.UPGRADE_BY_ID[evo];
      if (d && d.evo && (!d.titan || d.titan === w.titanId)) {
        for (let k = 0; k < 8; k++) E.applyUpgrade(w, d.evo.base);
        E.applyUpgrade(w, d.evo.with); w.upgrades.offer = [evo]; D.pickUpgrade(w, evo);
      }
      return w.upgrades.order.length;
    }"""
    V2_HUD_TOAST_JS = r"""async () => { const T = await import('/src/ui/toast.ts');
      T.pushHudToast({ kicker: 'GOAL MET', title: 'CROWD CONTROL', sub: 'UNLOCKED: Airtime Ledger — NEXT RUN', glyph: 'ribbon' }); }"""

    def g_v2hud(self):
        self.group = "v2hud"
        a, sess = self.args, self.sess
        base_vp = sess.page.viewport_size or {"width": a.width, "height": a.height}
        try:
            for (w, h) in ((1280, 720), (1920, 1080)):
                name = "abilitybar_%d" % w
                sess.page.set_viewport_size({"width": w, "height": h})
                ok, scr = self.start_run("hearthback", "grideast", a.seed + 500, False)
                if not ok or not ensure_play(sess, 20, self.olog)[0]:
                    self.miss(name, "run did not start (%s)" % (scr,))
                    continue
                self.cheats_on(True, True)
                n = sess.safe_js(self.V2_HUD_CARDS_JS, [13, "evo_supervolcano_permit"], default=0)
                sess.cheat("ult", 74)
                sess.cheat("objective", "overloadSite")
                H = sess.safe_js("() => window.__BT__.world.titan.height", default=1.2) or 1.2
                sess.cheat("objective", "reliefDepot", 6 * H)
                sess.safe_js("() => { window.__BT__.world.map.redLightT = 4.5; }")
                sess.safe_js(self.V2_HUD_TOAST_JS)
                time.sleep(1.2)
                if not ensure_play(sess, 10, self.olog)[0]:
                    self.miss(name, "overlay would not clear")
                    continue
                self.shot(name, "hud_v2", cards=n, dom=(sess.state() or {}).get("v2dom"))
        finally:
            sess.page.set_viewport_size(base_vp)

    # (shot id, t into that shot) for S1 / S2 / S3 of the FULL cut (data/cine.ts CINE_TIMING / CINE_BEATS:
    # the crash zoom lands 1.5 s into the street shot; the SNARL starts 1.35 s into the close-up)
    CINE_AT = (("s1", "street", 1.65), ("s2", "closeup", 1.45), ("s3", "crane", 0.75))
    CINE_TITANS = {"grideast": "molo", "whitestacks": "voltkite", "lockwater": "hearthback"}
    CINE_UNSEE_JS = r"""
() => { try { const k = 'blocktooth.profile.v1'; const p = JSON.parse(localStorage.getItem(k) || 'null');
  if (p && p.cineSeen) { p.cineSeen = {}; localStorage.setItem(k, JSON.stringify(p)); return 'cleared'; } return 'none'; }
  catch (e) { return String(e); } }
"""

    def g_cine(self):
        """FEATURES_V2 §11: the cinematic opening, S1 / S2 / S3 per biome (the FULL cut)."""
        self.group = "cine"
        a, sess = self.args, self.sess
        for i, biome in enumerate(a.biomes):
            titan = self.CINE_TITANS.get(biome, a.titans[i % len(a.titans)])
            if titan not in a.titans:
                titan = a.titans[i % len(a.titans)]
            if sess.page:
                sess.safe_js(self.CINE_UNSEE_JS)
            url = build_url(a.base, autostart=1, dev=1, titan=titan, biome=biome, seed=a.seed + 700 + i, cine=2,
                            quality=a.quality)
            try:
                sess.goto(url)
            except Exception as e:
                for tag, _, _ in self.CINE_AT:
                    self.miss("cine_%s_%s" % (biome, tag), "navigation failed: %s" % str(e).splitlines()[0])
                continue
            sess.wait_bt(90)
            sess.safe_js(self.CINE_UNSEE_JS)
            ok, scr = sess.wait_screen(("slate", "play"), 90)
            want = list(self.CINE_AT)
            seen = []
            deadline = time.time() + 15
            while want and time.time() < deadline:
                st = sess.state() or {}
                c = (st.get("v2") or {}).get("cine")
                if st.get("screen") == "play":
                    break
                if c and c.get("shot"):
                    if c["shot"] not in seen:
                        seen.append(c["shot"])
                    tag, sid, tt = want[0]
                    order = [x[1] for x in self.CINE_AT]
                    if c["shot"] == sid and c.get("t", 0) >= tt:
                        self.shot("cine_%s_%s" % (biome, tag), "cine", titan=titan, biome=biome, cine=c)
                        want.pop(0)
                    elif c["shot"] in order and order.index(c["shot"]) > order.index(sid):
                        self.miss("cine_%s_%s" % (biome, tag), "the %s shot passed before the capture (seen %s)" % (sid, seen))
                        want.pop(0)
                time.sleep(0.02)
            for tag, sid, _ in want:
                self.miss("cine_%s_%s" % (biome, tag), "no %s shot observed (screen=%r, shots seen %s)" % (
                    sid, (sess.state() or {}).get("screen"), seen))
            ensure_play(sess, 15, self.olog)

    # ─────────────────────────────── v2 screens (lane L9 flows, orchestrator port) ───────────────────────────────
    # FEATURES_V2 §15.4: goals_screen, select_next_unlock, draft_evo_banish_lock, tabloid_endless. Real keys drive
    # every screen (G, Esc, Enter, X, C, K); cheats only set up state. A crafted profile + bests are written to
    # localStorage first so FILED rows, the NEXT PERMIT PENDING slip and YOUR BEST ON FILE have content (the
    # same data as scratch/l9/l9shots.py).
    V2_NOW = int(time.time() * 1000)
    V2_PROFILE = {
        "v": 1,
        "done": {"g_first_broadcast": V2_NOW - 86400000 * 3, "g_zoning_change": V2_NOW - 86400000 * 2,
                 "g_city_got_smaller": V2_NOW - 86400000, "g_molo_curbside_pickup": V2_NOW - 3600000,
                 "g_paperwork": V2_NOW - 7200000, "g_molo_bite_sized": V2_NOW - 5000000},
        "best": {"g_crowd_control": 412, "g_live_coverage": 7, "g_molo_speed_bump": 188, "g_urban_renewal": 19,
                 "g_lw_early_closing": 611},
        "life": {"runs": 6, "clears": 1, "banishes": 5, "evolutions": 0,
                 "clearedBy": {"molo": ["grideast"], "voltkite": [], "hearthback": [], "briarwick": []},
                 "bossKills": {"parkade6": 1}},
        "perk": "perk_red_tape", "palette": {"molo": 1, "voltkite": 0, "hearthback": 0, "briarwick": 0},
        "cineSeen": {}, "newUnlocks": ["u_block_captain", "u_sidewalk_sale"],
    }
    V2_BESTS = {
        "molo.grideast.level": 31, "molo.grideast.peakRank": 4, "molo.grideast.clearS": 552.4,
        "molo.grideast.survivedS": 552, "molo.grideast.tonnage": 81234, "molo.grideast.endlessS": 204,
        "molo.grideast.endlessScore": 48210, "molo.lockwater.level": 18, "molo.lockwater.peakRank": 2,
        "molo.lockwater.survivedS": 301, "voltkite.whitestacks.level": 12, "voltkite.whitestacks.peakRank": 1,
        "voltkite.whitestacks.survivedS": 190,
    }
    V2_SEED_JS = """([p, b]) => { try { localStorage.setItem('blocktooth.profile.v1', JSON.stringify(p));
      localStorage.setItem('blocktooth.best.v1', JSON.stringify(b)); return true; } catch (e) { return String(e); } }"""
    V2_CARDS_JS = "() => [...document.querySelectorAll('.bt-draft .bt-dossier')].map((e) => e.dataset.card)"

    def v2_vis(self, sel):
        return self.sess.safe_js("(s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect();"
                                 " return r.width > 0 && r.height > 0 && getComputedStyle(e).display !== 'none'; }", sel, default=False)

    def v2_run(self, titan, biome, seed, **extra):
        sess = self.sess
        sess.release_all()
        sess.goto(build_url(self.args.base, dev=1, noslate=1, autostart=1, titan=titan, biome=biome, seed=seed,
                            quality=self.args.quality, **extra))
        sess.wait_bt(90)
        return sess.wait_screen(("play", "draft"), 90)

    V2_UNSEED_JS = """() => { try { localStorage.removeItem('blocktooth.profile.v1'); localStorage.removeItem('blocktooth.best.v1');
      return true; } catch (e) { return String(e); } }"""

    def g_screens(self):
        """The crafted profile is removed again afterwards, so later groups see the canonical palettes."""
        try:
            self._g_screens()
        finally:
            try:
                self.sess.goto(build_url(self.args.base, dev=1, noslate=1, quality=self.args.quality))
                self.sess.wait_bt(60)
                self.sess.js(self.V2_UNSEED_JS)
            except Exception as e:
                self.log("    could not remove the crafted profile: %s" % str(e).splitlines()[0][:200])

    def _g_screens(self):
        self.group = "screens"
        a, sess = self.args, self.sess
        # goals_screen + select_next_unlock: title → real G → goals; Esc → title; Enter → select
        sess.goto(build_url(a.base, dev=1, noslate=1, quality=a.quality))
        sess.wait_bt(90)
        sess.js(self.V2_SEED_JS, [self.V2_PROFILE, self.V2_BESTS])
        sess.goto(build_url(a.base, dev=1, noslate=1, quality=a.quality))
        sess.wait_bt(90)
        ok, scr = sess.wait_screen(("title",), 60)
        if not ok:
            self.miss("goals_screen", "title not reached (screen=%r)" % (scr,))
            self.miss("select_next_unlock", "title not reached")
        else:
            time.sleep(0.8)
            sess.press("KeyG")
            time.sleep(0.8)
            if self.v2_vis(".bt2-goals:not(.bt-hidden)"):
                self.shot("goals_screen", "screen", via="real G on the title")
            else:
                self.miss("goals_screen", "real G did not open the goals screen (screen=%r)" % sess.screen())
            sess.press("Escape")
            sess.wait_screen(("title",), 8)
            time.sleep(0.6)
            sess.press("Enter")
            ok, scr = sess.wait_screen(("select",), 30)
            time.sleep(1.4)
            if ok and self.v2_vis(".bt2-permit"):
                self.shot("select_next_unlock", "screen",
                          permit=sess.safe_js("() => document.querySelector('.bt2-permit').textContent", default=None))
            else:
                self.miss("select_next_unlock", "select / NEXT PERMIT PENDING slip not visible (screen=%r)" % (scr,))
        # draft_evo_banish_lock: an evolution offered in a level-up draft, then real X (banish) + real C (lock)
        name = "draft_evo_banish_lock"
        ok, scr = self.v2_run("molo", "grideast", 1337, meta="full")
        if not ok:
            self.miss(name, "run did not start (%s)" % (scr,))
        else:
            self.cheats_on(True, True)
            sess.cheat("evolveReady", "evo_full_block_bite")
            ids = []
            got = False
            for _ in range(10):
                sess.cheat("xp", 5000)
                okd, _ = sess.wait_screen(("draft",), 8)
                if not okd:
                    continue
                time.sleep(1.0)
                ids = sess.safe_js(self.V2_CARDS_JS, default=[]) or []
                if any(x and str(x).startswith("evo_") for x in ids):
                    got = True
                    break
                sess.press("Digit1")
                time.sleep(0.8)
            if not got:
                self.miss(name, "no evolution offered in 10 drafts (last offer %s)" % ids)
            else:
                d0 = ((sess.state() or {}).get("v2") or {}).get("draft") or {}
                time.sleep(0.7)
                sess.press("KeyX")
                time.sleep(1.4)
                sess.press("KeyC")
                time.sleep(1.0)
                d1 = ((sess.state() or {}).get("v2") or {}).get("draft") or {}
                ids1 = sess.safe_js(self.V2_CARDS_JS, default=[]) or []
                if d1.get("banishLeft") == (d0.get("banishLeft") or 0) - 1 and d1.get("locked"):
                    self.shot(name, "screen", offerBefore=ids, offerAfter=ids1, draft=d1)
                else:
                    self.miss(name, "real X / C did not banish + lock (before %s, after %s)" % (d0, d1))
                sess.press("Digit2")
                time.sleep(0.8)
        # tabloid_endless: clear → real K → EXTENDED COVERAGE → a death → the endless edition
        name = "tabloid_endless"
        ok, scr = self.v2_run("molo", "grideast", 1337)
        if not ok:
            self.miss(name, "run did not start (%s)" % (scr,))
            return
        self.cheats_on(True, False)
        sess.cheat("level", 12)
        sess.cheat("boss")
        time.sleep(0.5)
        sess.js("() => { const w = window.__H_W__(); const b = w.boss; if (b) { b.introT = 0; b.hp = 0; b.alive = false; } }")
        ok, scr = sess.wait_screen(("end",), 40)
        if not ok:
            self.miss(name, "clear tabloid not reached (screen=%r)" % (scr,))
            return
        time.sleep(2.2)
        sess.press("KeyK")
        ok, scr = sess.wait_screen(("play",), 12)
        st = sess.state() or {}
        if not ok or (st.get("v2") or {}).get("endless") is None:
            self.miss(name, "real K did not start EXTENDED COVERAGE (screen=%r)" % (scr,))
            return
        time.sleep(2.0)
        sess.cheat("god", False)
        sess.js("() => { const w = window.__H_W__(); w.titan.hp = 0; w.titan.alive = false; }")
        ok, scr = sess.wait_screen(("end",), 40)
        time.sleep(2.4)
        if ok and self.v2_vis(".bt2-np-endless"):
            self.shot(name, "screen", endless=(sess.state() or {}).get("v2", {}).get("endless"))
        else:
            self.miss(name, "endless tabloid not up (screen=%r)" % (scr,))

    # ─────────────────────────────── PARKADE-6 (lane L7 flow, orchestrator port) ───────────────────────────────
    # FEATURES_V2 §15.4: parkade_intro/ramp/barrier/tow/deckdrop/collapse/till_open/jammed. MOLO at Size V in
    # GRID-EAST, cheat.bossSpawn('parkade6'); the sim is frozen and stepped (__BT__.step, frozen only) to the
    # wanted beat (same stepping as scratch/parkade-view/game_shots.py), then the views idle 1.2 s and the frame
    # is captured at the gameplay framing.
    PARKADE_AT = (("intro", "intro", 1.3, 1), ("ramp", "rampLaunch", 0.45, 1), ("barrier", "barrierSwing", -0.05, 1),
                  ("tow", "towChain", 0.6, 2), ("deckdrop", "deckDrop", 0.12, 2), ("collapse", "levelCollapse", 0.75, 3),
                  ("till_open", "rampLaunch", 1.1, 1), ("jammed", "jammed", 1.2, 1))
    PARKADE_STEP_JS = r"""
async ([mode, want, tStop, phase, maxTicks]) => {
  const B = window.__BT__; const W = B.world; if (!W) return { err: 'no world' };
  B.freeze(true);
  const tele = (tag) => W.telegraphs.find((t) => t.alive && t.owner === 'boss' && t.tag === tag);
  let n = 0, stag = false;
  for (; n < maxTicks; n++) {
    const b = W.boss; if (!b) return { err: 'no boss', n };
    if (mode === 'intro') { if (b.introT > 0 && b.introT < 4 - tStop) break; }
    else if (mode === 'jammed') {
      if (b.introT <= 0 && !stag) { b.staggerT = 5; b.attack = null; b.data.tillOpen = 5; stag = true; }
      if (stag && b.staggerT > 0 && b.staggerT < 5 - tStop) break;
    } else {
      if (b.introT <= 0 && b.phase < phase) b.phase = phase;
      if (b.attack === want) {
        if (tStop < 0) {
          const tg = tele(want);
          if (tg && tg.windup - tg.t <= -tStop) break;
        } else if (want === 'towChain' || want === 'deckDrop' || want === 'levelCollapse') {
          const tag = want === 'levelCollapse' ? 'levelCollapse:A' : want;
          const tg = tele(tag);
          if (tg) b.data.__wu = tg.windup;
          const wu = b.data.__wu;
          if (wu !== undefined && b.attackT >= wu + tStop) break;
        } else if (b.attackT >= tStop) break;
      }
    }
    B.step(1);
  }
  const b = W.boss;
  return { n, reached: n < maxTicks, attack: b && b.attack, attackT: b && +b.attackT.toFixed(2), phase: b && b.phase,
    introT: b && +b.introT.toFixed(2), till: b && +(b.data.tillOpen || 0).toFixed(2), staggerT: b && +b.staggerT.toFixed(2) };
}
"""

    def g_parkade(self):
        self.group = "parkade"
        a, sess = self.args, self.sess
        for tag, want, t_stop, phase in self.PARKADE_AT:
            name = "parkade_%s" % tag
            ok, scr = self.v2_run("molo", "grideast", 7)
            if not ok or not ensure_play(sess, 20, self.olog)[0]:
                self.miss(name, "run did not start (%s)" % (scr,))
                continue
            self.cheats_on(True, True)
            sess.cheat("killAll")
            sess.cheat("level", 35)
            time.sleep(3.2)                               # let the MASS BREACH banner (2.3 s sting) finish its exit
            ensure_play(sess, 10, self.olog)
            okb, v = sess.cheat("bossSpawn", "parkade6")
            if not okb:
                self.miss(name, "cheat.bossSpawn('parkade6') failed: %s" % v)
                continue
            mode = "intro" if tag == "intro" else ("jammed" if tag == "jammed" else "attack")
            r = sess.js(self.PARKADE_STEP_JS, [mode, want, t_stop, phase, 30 * 240]) or {}
            if r.get("err") or not r.get("reached"):
                sess.bt_call("freeze", False)
                self.miss(name, "the %s beat was not reached (%s)" % (want, json.dumps(r)[:200]))
                continue
            time.sleep(1.2)                               # frozen: the views keep idling, the pose settles
            self.shot(name, "boss", parkade=r)
            sess.bt_call("freeze", False)

    # ─────────────────────────────── contact sheets ───────────────────────────────
    def contact_sheets(self):
        try:
            from PIL import Image, ImageDraw, ImageFont
        except Exception:
            self.log("contact sheets skipped: Pillow not installed")
            return []
        outs = []
        groups = []
        for it in self.items:
            if it.get("group") not in groups:
                groups.append(it.get("group"))
        try:
            font = ImageFont.truetype("arial.ttf", 15)
        except Exception:
            font = ImageFont.load_default()
        for g in groups:
            items = [it for it in self.items if it.get("group") == g and it.get("ok") and it.get("file")]
            if not items:
                continue
            cols = 3 if g == "titans" else 4
            tw, th, lab = 480, 270, 24
            rows = int(math.ceil(len(items) / float(cols)))
            sheet = Image.new("RGB", (cols * tw, rows * (th + lab)), (27, 20, 38))
            d = ImageDraw.Draw(sheet)
            for i, it in enumerate(items):
                try:
                    im = Image.open(os.path.join(ROOT, it["file"])).convert("RGB")
                    im.thumbnail((tw, th), Image.LANCZOS)
                except Exception:
                    continue
                x, y = (i % cols) * tw, (i // cols) * (th + lab)
                sheet.paste(im, (x + (tw - im.size[0]) // 2, y + lab + (th - im.size[1]) // 2))
                label = it["name"]
                if isinstance(it.get("rank"), int):
                    label += "  [Size %s]" % ROMAN[max(0, min(4, it["rank"]))]
                d.text((x + 6, y + 4), label, fill=(246, 240, 224), font=font)
            p = os.path.join(self.out, "_contact_%s.png" % g)
            sheet.save(p)
            outs.append(os.path.relpath(p, ROOT).replace("\\", "/"))
        return outs


def main() -> int:
    ap = argparse.ArgumentParser(description="BLOCKTOOTH shot battery (gate 6 evidence)")
    add_common_args(ap)
    ap.set_defaults(width=1600, height=900)
    ap.add_argument("--groups", default=",".join(GROUPS), help="comma list of %s" % "|".join(GROUPS))
    ap.add_argument("--titans", default=",".join(TITANS))
    ap.add_argument("--biomes", default=",".join(BIOMES))
    ap.add_argument("--ranks", default="I,III,V", help="Size numerals for the titan close-ups")
    ap.add_argument("--seed", type=int, default=11)
    ap.add_argument("--via", choices=("page", "bt"), default="page",
                    help="page.screenshot (full composition incl. HUD) or __BT__.shot(name)")
    ap.add_argument("--use-newrun", action="store_true", help="switch runs with __BT__.newRun instead of a page reload")
    ap.add_argument("--no-close", dest="close", action="store_false", help="skip the *_close.png centre crops")
    ap.add_argument("--walk", type=float, default=1.2, help="seconds of real-key walking before each titan shot")
    ap.add_argument("--settle", type=float, default=2.2, help="seconds (keys released) after a rank-up before the shot")
    ap.add_argument("--sting-delay", type=float, default=0.7)
    ap.add_argument("--menu-titan", default="molo", choices=TITANS)
    ap.add_argument("--menu-biome", default="grideast", choices=BIOMES)
    ap.add_argument("--hud-titan", default="molo", choices=TITANS)
    ap.add_argument("--hud-biome", default="grideast", choices=BIOMES)
    ap.add_argument("--boss-titan", default="hearthback", choices=TITANS)
    ap.add_argument("--boss-biomes", default="grideast,whitestacks,lockwater",
                    help="one boss run per biome (grideast → PARKADE-6, whitestacks → IRON GULLY, lockwater → CAISSON-4)")
    ap.add_argument("--boss-shots", type=int, default=3, help="distinct attacks to freeze per boss")
    ap.add_argument("--boss-seconds", type=float, default=50.0)
    ap.add_argument("--tabloid-seconds", type=float, default=90.0)
    ap.add_argument("--tabloid-delay", type=float, default=3.0)
    ap.add_argument("--out-dir", default=os.path.join(SHOTS, "battery"))
    args = ap.parse_args()
    args._t0 = time.time()

    def csv(v, allowed, what):
        xs = [x.strip() for x in v.split(",") if x.strip()]
        for x in xs:
            if x not in allowed:
                ap.error("unknown %s %r (allowed: %s)" % (what, x, ", ".join(allowed)))
        return xs

    groups = csv(args.groups, GROUPS, "group")
    args.titans = csv(args.titans, TITANS, "titan")
    args.biomes = csv(args.biomes, BIOMES, "biome")
    args.ranks = csv(args.ranks, list(RANK_ARG), "rank")
    args.boss_biomes = csv(args.boss_biomes, BIOMES, "biome")

    logs = []

    def log(msg):
        logs.append(msg)
        print(msg, flush=True)

    sess = Session(args, "shots")
    try:
        sess.start()
    except Exception as e:
        sess.close()
        print("SETUP FAILED: %s" % (str(e) if isinstance(e, HarnessError) else repr(e)))
        print("RESULT: FAIL")
        return 2
    bat = Battery(sess, args, log)
    fatal = None
    try:
        for g in GROUPS:
            if g not in groups:
                continue
            log("── %s ──" % g)
            try:
                getattr(bat, "g_" + g)()
            except Exception as e:     # one broken group must not lose the rest of the battery
                msg = str(e).splitlines()[0][:300] if str(e) else repr(e)
                bat.miss("%s_group" % g, "harness exception: %s" % msg)
                sess.release_all()
    except Exception as e:
        fatal = "harness exception: %s" % str(e).splitlines()[0][:300]
    finally:
        diag = sess.diagnostics() if sess.page else {}
        sess.close()

    sheets = bat.contact_sheets()
    ok_n = sum(1 for it in bat.items if it.get("ok"))
    manifest = {
        "game": "BLOCKTOOTH", "created": time.strftime("%Y-%m-%dT%H:%M:%S"), "base": args.base,
        "headless": args.headless, "viewport": [args.width, args.height], "via": args.via, "groups": groups,
        "seed": args.seed, "shots": bat.items, "missing": bat.missing, "contactSheets": sheets,
        "captured": ok_n, "planned": bat.planned, "wallS": round(time.time() - args._t0, 1),
        "overlaysCleared": bat.overlays_cleared,
        "diagnostics": {k: (v if isinstance(v, list) else v) for k, v in diag.items()}, "fatal": fatal,
        "note": "*_close.png files are centre crops of the same gameplay frame (upscaled), not re-renders.",
    }
    mpath = os.path.join(bat.out, "manifest.json")
    with open(mpath, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, default=str)
    save_report("shots", {k: v for k, v in manifest.items() if k != "shots"}, args.base, args.report_dir)

    print("=" * 78)
    print("SHOT BATTERY: %d / %d captured in %.0f s → %s" % (ok_n, bat.planned, time.time() - args._t0, bat.out))
    print("manifest    : %s" % mpath)
    for s in sheets:
        print("contact     : %s" % s)
    print_diagnostics(diag, limit=10)
    probs = diag_problems(diag)
    if probs:
        print("diagnostics (not gating the battery): %s" % ", ".join(probs))
    if fatal:
        print("FATAL: %s" % fatal)
    for m in bat.missing:
        print("   X missing %s" % m)
    print("RESULT: %s" % ("OK" if not bat.missing and not fatal else "INCOMPLETE"))
    return 0 if not bat.missing and not fatal else 1


if __name__ == "__main__":
    raise SystemExit(main())
