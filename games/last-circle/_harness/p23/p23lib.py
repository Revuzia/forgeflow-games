#!/usr/bin/env python
"""p23lib - shared helpers of the parity-wave P2 + P3 gates (_harness/p23/, lane P2-F "harness", 2026-10-20).

Every p23 gate follows the harness convention (common.py): one verdict table, exit 0 pass / 1 fail / 2 could-not-judge, JSON in
_harness/_reports/, the common flags (--disk / --rev / --base / --headed / --gpu, plus --overlay / --inject for VALIDATION runs only).

Contract-first. The P2/P3 features are built by other lanes against the shared contracts of the wave (C-MODE, C-DBNO, C-FALL, C-SMOKE,
C-GFX, C-HEAL, C-PING, C-HOUSE; README "Parity waves P2 + P3"). A gate reads ONLY the contract surface (W.*, K.*, W.events, the DOM the
contract names), never a lane's private internals, so it judges whichever implementation lands. Until a contract handle exists the gate's
first row ("contract ...") FAILS: a missing feature is a failing gate, never a silent pass and never could-not-judge.

Each gate carries:
  * its BAR rows (the plan / owner-decision numbers, never lowered);
  * planted faults (`--plant NAME`), applied at the CONTRACT level (a K constant, a W handle wrapped, an event swallowed), so they bite on
    any implementation; gate.py's NEGATIVE list runs each and requires exit 1;
  * a frozen control: BASE_P23 (int-p1, every lane's base: the feature is absent) or PREP1_REV (the Wave-8 snapshot before P1) for the
    ported P1 probes - each must FAIL;
  * a validation recipe against the contract STUBS in F:/lc_p23/harness/stubs/ (`--inject stub.js`), recorded in README.
"""
from __future__ import annotations

import io
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))            # _harness/p23
HARNESS = os.path.dirname(HERE)
sys.path.insert(0, HARNESS)
import common as C  # noqa: E402

BASE_P23 = "9aa2b746"        # int-p1: the Wave-8 snapshot + the verified P1 lanes = the base of every P2/P3 lane (no P2/P3 feature). NEVER moves
PREP1_REV = "e10b9836"       # the Wave-8 working-tree snapshot BEFORE P1 (no recoil climb, camera-ear audio, no ping, the 92 % -> 15 % bar): the
                             # frozen "must fail" build of the ported P1 probes. NEVER moves
NODE_TIMEOUT = 3600


LANE_ROOT = "F:/lcwt"         # the wave's lane worktrees (F:/lcwt/p23-<lane>): READ-ONLY sources of a --lanes validation run
LANES = ("sim", "player", "bots", "hud", "boot", "loot", "maps", "net", "fx", "audio", "towns", "nav")


def add_args(ap, plants=()):
    C.add_common_args(ap)
    if plants:
        ap.add_argument("--plant", default=None, choices=sorted(plants), help="a planted fault (this gate must then FAIL): " + ", ".join(sorted(plants)))
    ap.add_argument("--lanes", default=None, help="VALIDATION ONLY: serve the files each named lane changed in its worktree (%s/p23-<lane>, read-only) over the "
                                                   "served build = an integration preview; 'all' = every lane. Expands to --overlay <dir>=@changed" % LANE_ROOT)
    return ap


def parse(ap, argv=None):
    """ap.parse_args + the --lanes expansion (each lane's changed files as an --overlay, in LANES order)."""
    args = ap.parse_args(argv)
    if getattr(args, "lanes", None):
        names = LANES if args.lanes == "all" else [x for x in args.lanes.split(",") if x]
        for n in names:
            d = os.path.join(LANE_ROOT, "p23-" + n)
            if os.path.isdir(d):
                args.overlay = list(getattr(args, "overlay", None) or []) + [d + "=@changed"]
        if not getattr(args, "rev", None):
            args.disk = True
    return args


# ───────────────────────── Node gates: the tree a Node run reads ─────────────────────────
def _rev_root(rev, parts=("runtime", "assets/props")):
    sha = subprocess.run(["git", "-C", C.REPO, "rev-parse", rev], capture_output=True, text=True).stdout.strip()
    if not sha:
        raise C.HarnessError("unknown git revision %r" % rev)
    dst = os.path.join(tempfile.gettempdir(), "lc_p23_rev", sha)
    mark = os.path.join(dst, ".complete")
    if not os.path.exists(mark):
        os.makedirs(dst, exist_ok=True)
        p = subprocess.run(["git", "-C", C.REPO, "archive", sha] + ["games/last-circle/" + x for x in parts] + ["games/last-circle/index.html"],
                           capture_output=True)
        if p.returncode != 0:
            raise C.HarnessError("git archive %s failed: %s" % (rev, p.stderr.decode("utf-8", "replace")[:300]))
        with tarfile.open(fileobj=io.BytesIO(p.stdout)) as tf:
            for m in tf.getmembers():
                if not m.isfile():
                    continue
                rel = m.name[len("games/last-circle/"):] if m.name.startswith("games/last-circle/") else m.name
                out = os.path.join(dst, rel.replace("/", os.sep))
                os.makedirs(os.path.dirname(out), exist_ok=True)
                with open(out, "wb") as fh:
                    fh.write(tf.extractfile(m).read())
        open(mark, "w").write(sha)
    return dst, sha[:8]


def node_root(args, rev=None):
    """The game directory a Node gate reads: the working copy (--disk / default), a frozen revision (--rev or `rev`), with --overlay files
    copied over a scratch copy of runtime/ + assets/props. Returns (root, label)."""
    rev = rev or getattr(args, "rev", None)
    if rev:
        root, label = _rev_root(rev)
        label = "git " + label
    else:
        root, label = C.ROOT, "working copy"
    ovl = C.overlay_specs(args) if getattr(args, "overlay", None) else []
    if ovl:
        dst = tempfile.mkdtemp(prefix="lc_p23_ovl_")
        for part in ("runtime", os.path.join("assets", "props")):
            shutil.copytree(os.path.join(root, part), os.path.join(dst, part))
        shutil.copy2(os.path.join(root, "index.html"), os.path.join(dst, "index.html"))
        n = 0
        for d, rels in ovl:
            for base, _dirs, files in os.walk(os.path.join(d, "runtime")):
                for f in files:
                    src = os.path.join(base, f)
                    rel = os.path.relpath(src, d).replace(os.sep, "/")
                    if rels is not None and rel not in rels:
                        continue
                    out = os.path.join(dst, rel.replace("/", os.sep))
                    os.makedirs(os.path.dirname(out), exist_ok=True)
                    shutil.copy2(src, out)
                    n += 1
        root, label = dst, label + " + %d overlay file(s)" % n
    return root, label


def run_node(argv, timeout=NODE_TIMEOUT, cwd=None):
    """node <argv...> with the report JSON path appended as --out; returns (json | None, tail text, seconds)."""
    out = os.path.join(tempfile.gettempdir(), "lc_p23_%d_%d.json" % (os.getpid(), int(time.time() * 1000) % 10_000_000))
    t0 = time.time()
    try:
        r = subprocess.run(["node"] + list(argv) + ["--out", out], cwd=cwd or C.ROOT, capture_output=True, text=True, encoding="utf-8",
                           errors="replace", timeout=timeout)
    except subprocess.TimeoutExpired:
        raise C.EnvFailure("node %s timed out after %d s" % (os.path.basename(argv[0]), timeout))
    except FileNotFoundError:
        raise C.EnvFailure("node not found on PATH")
    tail = ((r.stdout or "") + (r.stderr or "")).strip().splitlines()[-12:]
    for ln in tail:
        print("    node| " + ln[:300], flush=True)
    if r.returncode != 0 or not os.path.isfile(out):
        raise C.HarnessError("node %s exit %s: %s" % (os.path.basename(argv[0]), r.returncode, " | ".join(tail)[-900:]))
    with open(out, encoding="utf-8") as fh:
        data = json.load(fh)
    try:
        os.remove(out)
    except OSError:
        pass
    return data, tail, round(time.time() - t0, 1)


# ───────────────────────── browser gates ─────────────────────────
GOT_IT_JS = r"""() => { const b = [...document.querySelectorAll('button')].find((x) => x.offsetParent && /^\s*GOT IT\s*$/.test(x.textContent));
  if (!b) return null; const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }"""


def dismiss_cards(s, n=3):
    for _ in range(n):
        b = s.js(GOT_IT_JS)
        if not b:
            break
        s.page.mouse.click(b[0], b[1])
        s.sleep(0.4)


def lock_pointer(s):
    cv = s.js("() => { const c = window.__LC__.W.kernel.renderer.domElement; const r = c.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }")
    s.page.mouse.click(cv["x"], cv["y"])
    return s.wait_js("() => !!document.pointerLockElement", 3, 0.1)


def practice(s, seed=4242, map_id="ashgrid", freeze=True, guard=True):
    """boot -> GOT IT -> a PRACTICE match through the real lobby Enter -> landed (protected) -> loop frozen + pump + guard."""
    res = {"boot_s": s.boot()}
    dismiss_cards(s)
    res["start"] = s.start_match("practice", seed, map_id, enter=True, guard=guard)
    res["land"] = s.land(120, protect=True)
    if freeze:
        s.freeze_loop()
    s.install_pump()
    if guard:
        s.guard_player(True)
    return res


def contract(s, exprs):
    """{name: JS expression} -> {name: bool} (a throw reads False)."""
    out = {}
    for k, e in exprs.items():
        out[k] = bool(s.safe_js("() => { try { const W = window.__LC__.W, K = W.SIM; return !!(%s); } catch (e) { return false; } }" % e, default=False))
    return out


def contract_row(v, name, have, need=None):
    """the gate's FIRST row: every contract handle it reads exists. need = the subset that must exist (default all)."""
    need = list(need or have.keys())
    miss = [k for k in need if not have.get(k)]
    return v.check(name, not miss, {"present": [k for k, b in have.items() if b], "missing": miss}, "every handle of the contract present")


def errors_row(v, s, name="0 page errors / console errors / failed requests"):
    d = s.diagnostics()
    probs = C.diag_problems(d, rig=False)
    return v.check(name, not probs, {"problems": probs, "first": (d["pageErrors"] + d["consoleErrors"] + d["failedRequests"])[:4]})


def programs(s):
    return s.safe_js("() => window.__LC__.W.kernel.renderer.info.programs.length", default=None)


def plant_js(s, js):
    """run a planted-fault snippet in the page (after boot); the snippet sees W and K."""
    return s.js("() => { const W = window.__LC__.W, K = W.SIM; %s; return true; }" % js)


# open, flat ground: nothing taller than 0.2 m within `clear` m and < 0.25 m of relief over +-6 m; searched in rings from (x0, z0)
FLAT_SPOT_JS = r"""([x0, z0, clear, maxR, avoid]) => {
  const W = window.__LC__.W, M = W.map, wy = M.waterY;
  const ok = (x, z) => {
    const h = M.heightAt(x, z);
    if (h < wy + 1) return false;
    for (const [dx, dz] of [[3, 0], [-3, 0], [0, 3], [0, -3], [2, 2], [-2, -2], [6, 0], [0, 6], [-6, 0], [0, -6]]) if (Math.abs(M.heightAt(x + dx, z + dz) - h) > 0.25) return false;
    for (const c of M.queryColliders(x, z, clear + 2, [])) { if (c.dead) continue; if (c.maxY > h + 0.2 && c.minX < x + clear && c.maxX > x - clear && c.minZ < z + clear && c.maxZ > z - clear) return false; }
    for (const a of (avoid || [])) if (Math.hypot(a[0] - x, a[1] - z) < a[2]) return false;
    return true; };
  for (let r = 0; r < maxR; r += 6) for (let k = 0; k < 24; k++) {
    const a = k / 24 * Math.PI * 2, x = x0 + Math.cos(a) * r, z = z0 + Math.sin(a) * r;
    if (Math.abs(x) < 760 && Math.abs(z) < 760 && ok(x, z)) return { x, z, h: M.heightAt(x, z) };
  }
  return null; }"""


def flat_spot(s, x0=None, z0=None, clear=4.0, max_r=700, avoid=None):
    if x0 is None:
        p = s.js("() => { const p = window.__LC__.W.player.pos; return [p.x, p.z]; }")
        x0, z0 = p
    return s.js(FLAT_SPOT_JS, [x0, z0, clear, max_r, avoid or []])


# the LC-06 GPU timer (ffg_kernel_3d.js GpuFrameTimer: one TIME_ELAPSED query around each rendered frame's draw)
def gpu_ms(s, frames=60, dt=1 / 60):
    """render `frames` stepped frames with the kernel's GPU timer on; returns the per-frame GPU ms measured (may lag by a few frames)."""
    ok = s.js("() => { const g = window.__LC__.W.kernel.gpuTimer; if (!g || !g.supported) return false; g.on = true; g.ms.length = 0; return true; }")
    if not ok:
        return None
    s.step_frames(frames, dt, render=True)
    s.step_frames(6, dt, render=True)          # drain the queries in flight
    return s.js("() => { const g = window.__LC__.W.kernel.gpuTimer; const m = g.ms.slice(); g.on = false; return m; }")


def med(xs):
    xs = sorted(x for x in (xs or []) if isinstance(x, (int, float)))
    if not xs:
        return None
    n = len(xs)
    return xs[n // 2] if n % 2 else 0.5 * (xs[n // 2 - 1] + xs[n // 2])


# ───────────────────────── C-MODE match start ─────────────────────────
def start(s, pace="standard", seed=7, map_id=None, team=None, guard=True, enter=True, timeout_s=None):
    """Session.start_match with the C-MODE team mode: __LC__.startMatch({ mode: pace, seed, mapId, teamMode }) (lane boot's opts key; the
    contract's W.match.mode / W.match.pace are read back), guard installed in the LOBBY, then a REAL Enter. team None = the menu default."""
    s.stage("load")
    timeout_s = timeout_s or getattr(s.args, "load_timeout", 1500)
    opts = {"mode": pace, "seed": seed}
    if map_id:
        opts["mapId"] = map_id
    if team:
        opts["teamMode"] = team
    t0 = time.time()
    s.js("(o) => { window.__H_SM__ = { done: false }; window.__LC__.startMatch(o).then(() => { window.__H_SM__.done = true; },"
         " (e) => { window.__H_SM__.done = true; window.__H_SM__.err = String(e && (e.stack || e)); }); return true; }", opts)
    if s.wait_js("() => window.__H_SM__ && window.__H_SM__.done", timeout_s, 0.25) is None:
        raise C.EnvFailure("startMatch still loading after %d s (box contention)" % timeout_s)
    err = s.safe_js("() => window.__H_SM__.err || null")
    if err:
        raise C.HarnessError("startMatch rejected: %s" % err[:400])
    res = {"load_s": round(time.time() - t0, 1), "opts": opts}
    if guard:
        res["guard"] = s.guard_player(True)
    if enter:
        s.stage("lobby")
        s.sleep(0.3)
        for attempt in range(3):
            s.page.keyboard.press("Enter")
            if s.wait_js("() => ['drop', 'match'].includes(window.__LC__.W.phase)", 5, 0.1) is not None:
                break
        if s.phase() not in ("drop", "match"):
            raise C.HarnessError("a real Enter did not leave the lobby (phase %s)" % s.phase())
    res["match"] = s.safe_js("() => { const m = window.__LC__.W.match || {}; return { mode: m.mode, pace: m.pace, teamSize: m.teamSize, wmode: window.__LC__.W.mode, teamMode: window.__LC__.W.teamMode }; }")
    s.stage(s.phase() or "match")
    return res


def guard_ids(s, ids):
    """SETUP ONLY: top these actors' hp / shield up every frame (the harness guard for a bot teammate under test); [] removes it.
    Never touches a DOWNED actor (the bleed pool is what a DBNO row measures)."""
    return s.js("""(ids) => { const W = window.__LC__.W, k = W.kernel; const i = window.__P23G__ ? k._updaters.indexOf(window.__P23G__) : -1;
        if (i >= 0) k._updaters.splice(i, 1); window.__P23G__ = null; if (!ids.length) return 'off';
        window.__P23G__ = () => { for (const id of ids) { const a = W.actorById.get(id); if (a && a.alive && !a.downed) { a.hp = Math.max(a.hp, 100); a.shield = Math.max(a.shield || 0, 100); } } };
        k._updaters.push(window.__P23G__); return 'on'; }""", list(ids))


def pin_actor(s, aid, xyz=None):
    """SETUP ONLY: hold an actor at a point every frame (None releases every pin)."""
    return s.js("""([id, p]) => { const W = window.__LC__.W, k = W.kernel; window.__P23PIN__ = window.__P23PIN__ || {};
        if (!window.__P23PINF__) { window.__P23PINF__ = () => { for (const [i, q] of Object.entries(window.__P23PIN__)) { const a = W.actorById.get(i); if (a && a.alive) { a.pos.set(q[0], q[1], q[2]); a.vel.set(0, 0, 0); } } }; k._updaters.push(window.__P23PINF__); }
        if (id == null) { window.__P23PIN__ = {}; return 'cleared'; } if (p == null) { delete window.__P23PIN__[id]; return 'off'; } window.__P23PIN__[id] = p; return 'on'; }""", [aid, xyz])


# ───────────────────────── two pages over the squad relay stand-in (squadguard_live's FAKE_SB) ─────────────────────────
def fake_sb_plus():
    """squadguard_live's relay stand-in + (1) every OUTGOING 'state' payload's JSON size kept in window.__SQ_STATE__ (the stand-in's own log skips
    state packets), (2) an inbound REORDER switch: while window.__SQ_REORDER__ = { every: n, holdMs: ms } every n-th inbound 'state' broadcast
    is held back holdMs and delivered late, after newer ones (LC-49: out-of-order injection on the wire)."""
    import squadguard_live as SQ
    src = SQ.FAKE_SB
    a = "send(msg) { if (closed) return Promise.resolve('error'); note('out', msg.payload);"
    assert a in src, "FAKE_SB send() anchor moved"
    src = src.replace(a, a + " try { if (msg.payload && msg.payload.t === 'state') { const S = window.__SQ_STATE__ = window.__SQ_STATE__ || []; S.push(JSON.stringify(msg.payload).length); if (S.length > 600) S.shift(); } } catch (e) {}", 1)
    b = "if (m.k === 'bc') { note('in', m.payload); L.broadcast.forEach("
    assert b in src, "FAKE_SB onmessage anchor moved"
    src = src.replace(b, "if (m.k === 'bc' && m.payload && m.payload.t === 'state' && window.__SQ_REORDER__ && !m.__late) { const R = window.__SQ_REORDER__; R.n = (R.n || 0) + 1;"
                         " if (R.n % R.every === 0) { R.held = (R.held || 0) + 1; const mm = Object.assign({}, m, { __late: true }); setTimeout(() => bc.onmessage({ data: mm }), R.holdMs); return; } }"
                         "\n        " + b, 1)
    return src


def squad_rig(args):
    """a squadguard_live Rig whose contexts serve --overlay / --inject like Session (validation runs) and answer esm.sh with fake_sb_plus()."""
    import squadguard_live as SQ
    ovl = C.overlay_specs(args) if getattr(args, "overlay", None) else []
    fsb = fake_sb_plus()

    class Rig(SQ.Rig):
        def new_ctx(self):
            ctx = super().new_ctx()
            if ovl and not self.live:
                disk = C.DiskServer([self.origin], getattr(self.args, "rev", None), self.gpath, overlays=ovl)
                ctx.route(lambda url: disk.matches(url), disk.handle)
            ctx.route(lambda url: "esm.sh/" in url, lambda r: r.fulfill(status=200, body=fsb, headers={
                "Content-Type": "text/javascript; charset=utf-8", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store"}))
            for f in (getattr(self.args, "inject", None) or []):
                with open(f, encoding="utf-8") as fh:
                    ctx.add_init_script(fh.read())
            return ctx
    args.full_now = True
    return Rig(args), SQ


def squad_pair(rig, SQ, args, name, team_mode=None):
    """host + guest pages in a fresh context, real lobby clicks (SQUAD UP, CREATE ROOM, JOIN by code, START MATCH), both REAL matches loaded and
    landed (sim only, hp topped). Returns (ctx, hpg, hrec, gpg, grec, code)."""
    ctx = rig.new_ctx()
    hpg, hrec = rig.page(ctx, name + "/host")
    gpg, grec = rig.page(ctx, name + "/guest")
    for label, pg in (("host", hpg), ("guest", gpg)):
        if SQ.boot_url(pg, args.base, args.boot_timeout) is None:
            raise C.EnvFailure("%s %s never booted" % (name, label))
    for label, pg in (("host", hpg), ("guest", gpg)):
        if not SQ.open_lobby(pg):
            raise C.EnvFailure("%s %s: the SQUAD UP lobby never opened" % (name, label))
    code = SQ.host_create(hpg)
    if not code:
        raise C.EnvFailure("%s: no room code" % name)
    SQ.guest_join(gpg, code)
    if not SQ.wait(hpg, "() => document.body.innerText.includes('2 player')", 40):
        raise C.EnvFailure("%s: the guest never showed in the host's lobby" % name)
    SQ.press_start(hpg)
    for pg in (hpg, gpg):
        if not SQ.wait(pg, "() => ['lobby','drop','match'].includes(window.__LC__.W.phase)", args.load_timeout, 1.0):
            raise C.EnvFailure("%s: a page never loaded its match" % name)
    for pg in (hpg, gpg):
        for _ in range(3):
            if pg.evaluate("() => ['drop','match'].includes(window.__LC__.W.phase)"):
                break
            pg.keyboard.press("Enter")
            pg.wait_for_timeout(1500)
    if not all(SQ.wait(pg, "() => ['drop','match'].includes(window.__LC__.W.phase)", 120, 1.0) for pg in (hpg, gpg)):
        raise C.EnvFailure("%s: a page never reached the drop" % name)
    land = ("() => { const C = window.__LC__, W = C.W, p = W.player; let n = 0; while (n < 900 && p.alive && (p.gliding || !p.onGround)) { C.fastForward(1 / 30, 1 / 30);"
            " p.hp = 100; p.shield = 100; n++; } return { n, onGround: p.onGround }; }")
    for pg in (hpg, gpg):
        pg.evaluate(land)
    return ctx, hpg, hrec, gpg, grec, code
