#!/usr/bin/env python
"""squadguard_live - the squad VERSION GUARD (Wave 7 lane 7C, contract C-VER) in a real browser: two pages, the REAL net.js and lobby, real clicks.

    python _harness/squadguard_live.py --disk                          # every case except the real-match one
    python _harness/squadguard_live.py --disk --cases same,older
    python _harness/squadguard_live.py --disk --cases same --full      # + both pages load the REAL match and must build the same world (minutes)
    python _harness/squadguard_live.py --disk --cases older --plant no-guard      # negative control: MUST FAIL
    python _harness/squadguard_live.py --disk --cases same  --plant bare-import   # negative control: MUST FAIL
    python _harness/squadguard_live.py --live                          # the DEPLOYED build (common.LIVE_BASE; the post-deploy check, ~2 min, read-only)
    python _harness/squadguard_live.py --base https://forgeflow-games-cdn.isimcha85.workers.dev/last-circle/index.html     # the same, spelled out

LIVE MODE (Wave-7 completion round, lane D5). Without --disk / --rev the pages load the game from the URL in --base, over the network, like a player: NO page routing
serves a game file. (The rig used to route every request of the origin to the working copy under /games/last-circle/, which 404s on the CDN's /last-circle/ path: every
page died at the index, the run read could-not-judge "same: environment", and each case then waited the full --boot-timeout.) What stays routed in every mode is the relay
stand-in below (the squad transport, esm.sh): the run never touches Supabase or any production data. The mismatch cases rewrite the SERVED maps.js / net.js in flight
(route.fetch + edit), the preguard cases serve the committed old build (--old-rev) under the CDN's path, the `same` case loads index.html with a different ?v= (a real
cold cache). N (the build's MAP_GEN_VERSION) is read from the served maps.js. Two extra rows judge the mode itself: the first document is the 200 the URL names, and
no request left the build's own origin except the stand-in (a request to supabase.co is aborted by the rig AND fails the row).

THE RELAY. Last Circle squads ride Supabase Realtime (ffg_netplay.js imports supabase-js from esm.sh); the repo has no local Last Circle relay
(DYEFIELD's online.py drives its own wrangler Worker, not this transport). So this is the cheapest honest harness: the esm.sh module is answered
by a ~60-line stand-in (FAKE_SB below) whose channels are BroadcastChannels between the two pages of ONE browser context. Everything above the
transport is the real code: ffg_netplay.js, net.js, the lobby DOM, the buttons (real mouse clicks), MAP_GEN_VERSION read from the real maps.js.
Every message either page sends or receives is logged (window.__SQ_LOG__) so the rows can assert what is on the wire.
__LC__.startMatch is replaced by a recorder (it records its argument and resolves) except in --full: a squad START is judged by what it would
start, without a 1-3 minute map load per page.

CASES (N = the working copy's MAP_GEN_VERSION, read from maps.js):
  same            both pages N, loaded with a DIFFERENT ?v= than the build's (cold cache): host CREATE ROOM, guest JOIN by code, host START ->
                  both start the same seed / map / mode, 2 humans, no refuse on the wire; maps.js is fetched once per page and only with the
                  new ?v= (net.js's dynamic import rides the boot's query: no stale second instance)
  older           guest page forced to N-1 (page route rewrites the maps.js export): the guest refuses AT ONCE, on screen: "out of date",
                  both versions, a RELOAD PAGE button; the host sees why (a lobby line naming the guest and its version); START rosters the
                  host alone; the guest never starts a match
  newer           guest forced to N+1: refused, told to ask the host to reload (no reload button)
  v1              guest's maps.js has no MAP_GEN_VERSION (value undefined) = version 1: same as older
  preguard-guest  guest = the build committed at --old-rev (60b854d0, no guard): the host (N) leaves it out; the old guest is told "room is full"
                  by its own (unchanged) code and starts no match
  preguard-host   host = the old build, guest = N: the guest refuses at the old host's START (no gv on it), says why, sends `refuse` and the `bye`
                  that frees the slot the old host gave it
  refuse-live     both N, START, then the guest sends a late `refuse` (a guest that learned its version only after START): the host's chat log
                  (W.pushChat) and W.net.refusals say who and why, and the `squadRefused` event fires
  older-full      (--full only) host + a guest forced to N-1 and a REAL host match: once the HUD is up the host's chat log says the guest is not in
                  this match and why (the pending notice shown from onMatchStart), and the match starts with the host alone
  (--full)        in case `same`: the real match on both pages: same seed, map id, genVersion and collider count

  C-FALLBACK (Wave-7 completion round, lane D1): a page whose towngen.js / citykit.js failed to import builds the Wave-6 Savanna layout while it
  advertises MAP_GEN_VERSION; net.js must make such a client leave the squad (a solo match is untouched).
  fallback        both N, START, then the guest's map "falls back" exactly as maps.js reports it (W.mapFallback = { from, to, reason } + the `mapFallback`
                  event) and the orchestrator calls onMatchStart: the guest shows the card ("Part of the map failed to load ... reload the page", RELOAD PAGE /
                  KEEP PLAYING), has left the room (W.net null), sent `mapfail` {wanted, built, slot} + the old-style `bye`; the host reads who and why (its
                  match is still loading: the line and the slot take-over are held, then done when its actors exist), and a HEALTHY host stays in the room
  fallback-host   the HOST's map falls back: it leaves (mapfail slot 0 + bye); the guest reads that the host had to leave and continues as a lost-host match
  fallback-solo   a page with NO squad session: the event and onMatchStart change nothing (no card, no leave)
  fallback-full   (--full only) host + a guest whose towngen.js / citykit.js requests are aborted, a REAL Savanna match each: the guest really falls back
                  (map.genVersion N-1), leaves, plays on solo with every body a bot; the host's copy of the guest's body becomes a bot and its chat says why

EXIT 0 pass / 1 fail / 2 could-not-judge (browser would not start, pages never booted, a lobby that never answered on a starved box).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ALL_CASES = ["same", "older", "newer", "v1", "preguard-guest", "preguard-host", "refuse-live", "fallback", "fallback-host", "fallback-solo", "older-full", "fallback-full"]
DEFAULT_CASES = [c for c in ALL_CASES if c not in ("older-full", "fallback-full")]      # older-full / fallback-full load a real match: only with --full
COLD_V = "424242"            # the ?v= both pages of `same` are loaded with (the build's own is different)

# ─────────────────────────────── the relay stand-in ───────────────────────────────
FAKE_SB = r"""
// stand-in for https://esm.sh/@supabase/supabase-js: channels = BroadcastChannels between the pages of one browser context
const LOG = () => (window.__SQ_LOG__ = window.__SQ_LOG__ || []);
const note = (dir, p) => { try { const L = LOG(); if (L.length < 600 && p && p.t !== 'state' && p.t !== 'bots') L.push({ dir, t: p.t, from: p.from, d: JSON.parse(JSON.stringify(p.d === undefined ? null : p.d)), at: Math.round(performance.now()) }); } catch (e) {} };
export function createClient() {
  return {
    channel(name, cfg) {
      const key = cfg && cfg.config && cfg.config.presence && cfg.config.presence.key;
      const bc = new BroadcastChannel('fake-sb:' + name);
      const L = { broadcast: [], presence: [] };
      const state = new Map();
      let tracked = null, closed = false;
      const fire = () => L.presence.forEach((f) => { try { f.cb(); } catch (e) { console.error(e); } });
      bc.onmessage = (ev) => {
        const m = ev.data;
        if (closed || !m) return;
        if (m.k === 'bc') { note('in', m.payload); L.broadcast.forEach((f) => { if (!f.event || f.event === m.event) f.cb({ type: 'broadcast', event: m.event, payload: m.payload }); }); }
        else if (m.k === 'pres') { state.set(m.key, m.meta); fire(); }
        else if (m.k === 'leave') { state.delete(m.key); fire(); }
        else if (m.k === 'who' && tracked) bc.postMessage({ k: 'pres', key, meta: tracked });
      };
      const ch = {
        on(type, filter, cb) { (type === 'broadcast' ? L.broadcast : L.presence).push({ event: filter && filter.event, cb }); return ch; },
        subscribe(cb) { setTimeout(() => cb && cb('SUBSCRIBED'), 5); return ch; },
        async track(meta) { tracked = meta; state.set(key, meta); bc.postMessage({ k: 'pres', key, meta }); bc.postMessage({ k: 'who' }); fire(); return 'ok'; },
        untrack() { tracked = null; state.delete(key); bc.postMessage({ k: 'leave', key }); return Promise.resolve('ok'); },
        presenceState() { const o = {}; state.forEach((v, k) => { o[k] = [v]; }); return o; },
        send(msg) { if (closed) return Promise.resolve('error'); note('out', msg.payload); bc.postMessage({ k: 'bc', event: msg.event, payload: msg.payload }); return Promise.resolve('ok'); },
        _close() { if (closed) return; closed = true; try { bc.postMessage({ k: 'leave', key }); bc.close(); } catch (e) {} note('out', { t: '_left', from: key, d: null }); },
      };
      return ch;
    },
    removeChannel(ch) { try { ch && ch._close && ch._close(); } catch (e) {} return Promise.resolve('ok'); },
  };
}
export default { createClient };
"""

# ─────────────────────────────── in-page snippets ───────────────────────────────
LOBBY_JS = r"""() => {
  const box = [...document.querySelectorAll('div')].find((d) => d.style && d.style.minWidth === '380px');
  if (!box) return { open: false };
  const kids = [...box.children];
  const st = kids[1];
  const note = box.querySelector('[data-net-notice]');
  const roster = note ? note.previousElementSibling : null;
  const vis = (b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(b).display !== 'none'; };
  return {
    open: true, text: box.innerText, status: st ? st.innerText : '',
    refused: st ? st.getAttribute('data-net-refused') : null, versions: st ? st.getAttribute('data-net-versions') : null,
    error: st ? st.getAttribute('data-net-error') : null,
    reload: !!box.querySelector('[data-net-reload]') && vis(box.querySelector('[data-net-reload]')),
    notices: note ? [...note.children].map((x) => x.textContent) : [],
    roster: roster ? [...roster.children].map((x) => x.innerText.replace(/\s+/g, ' ').trim()) : [],
    buttons: [...box.querySelectorAll('button')].map((b) => b.textContent.trim() + (b.disabled ? ':disabled' : '') + (vis(b) ? '' : ':hidden')),
  };
}"""
STUB_START_JS = r"""() => { const C = window.__LC__; window.__SQ_START__ = [];
  C.startMatch = (o) => { window.__SQ_START__.push(JSON.parse(JSON.stringify(o))); return Promise.resolve(); }; return true; }"""
# C-FALLBACK helpers. The page's own net.js module instance (same URL = same ?v= as the boot, so it IS the instance the game runs), to call what the
# orchestrator calls (onMatchStart) when no real match is loaded
NETMOD_JS = r"""async () => { if (window.__NETMOD__) return true;
  const s = [...document.scripts].find((x) => /ffg_boot3d\.js/.test(x.src)); if (!s) return false;
  window.__NETMOD__ = await import(new URL('royale/net.js' + new URL(s.src).search, s.src).href); return true; }"""
# what maps.js does when towngen.js / citykit.js fail twice (W.mapFallback + the event), then the orchestrator's "the match is live"
FALLBACK_JS = r"""async (N) => { const W = window.__LC__.W, m = window.__NETMOD__;
  window.__SQ_FB__ = window.__SQ_FB__ || [];
  if (!window.__SQ_FBL__) { window.__SQ_FBL__ = true; W.events.on('squadMapFallback', (i) => window.__SQ_FB__.push(JSON.parse(JSON.stringify(i)))); }
  const reason = 'planted: towngen.js failed to import twice';
  W.mapFallback = { from: N, to: N - 1, reason };
  W.events.emit('mapFallback', { map: 'ashgrid', genVersion: N - 1, wanted: N, reason });
  m.onMatchStart(W); return true; }"""
# the card a player sees
CARD_JS = r"""() => { const c = document.querySelector('[data-net-fallback]'); if (!c) return null;
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).display !== 'none'; };
  const rel = c.querySelector('[data-net-reload]'), dis = c.querySelector('[data-net-dismiss]'), r = c.getBoundingClientRect();
  return { text: c.innerText, attr: c.getAttribute('data-net-fallback'), visible: vis(c), reload: !!rel && vis(rel), dismiss: !!dis && vis(dis),
           left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), vw: innerWidth }; }"""
# the leaver's own state after the leave
LEFT_JS = r"""() => { const W = window.__LC__.W; return { net: W.net === null ? 'null' : typeof W.net, left: W.squadLeft || null, events: window.__SQ_FB__ || [] }; }"""
# a host/guest session's record of who left (W.net is the session)
FAILS_JS = r"""() => { const n = window.__LC__.W.net; return n ? { fails: n.mapFails || [], pendingTakeovers: [...(n.pendingTakeovers || [])], pendingNotices: n.pendingNotices || [], hostGone: !!n.hostGone } : null; }"""
LOG_JS = "() => window.__SQ_LOG__ || []"
STARTS_JS = "() => window.__SQ_START__ || []"
GOTIT_JS = r"""() => { const b = [...document.querySelectorAll('button')].find((x) => x.offsetParent && /^\s*GOT IT\s*$/i.test(x.textContent || '')); if (!b) return null; const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }"""
SQUAD_JS = r"""() => { const b = [...document.querySelectorAll('button, .lc-mode-card, div')].find((x) => x.offsetParent && /^[^A-Za-z0-9]*SQUAD UP\s*$/i.test(x.textContent || '')); if (!b) return null; const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }"""
WORLD_JS = r"""() => { const W = window.__LC__.W, M = W.map; if (!M) return null;
  let h = 2166136261 >>> 0; const cs = M.colliders || [];
  for (const c of cs) { for (const v of [c.minX, c.maxX, c.minY, c.maxY, c.minZ, c.maxZ]) { h ^= Math.round(v * 1000) | 0; h = Math.imul(h, 16777619) >>> 0; } }
  return { seed: W.seed, mapId: M.id, genVersion: M.genVersion, colliders: cs.length, hash: h.toString(16), phase: W.phase, lootPoints: M.lootPoints.length }; }"""


# ─────────────────────────────── helpers ───────────────────────────────
def src_text(rel, rev):
    """games/last-circle/<rel> from the working copy or, with rev, as committed there"""
    if rev:
        b = C.git_blobs(rev).read(rel)
        if b is None:
            raise C.HarnessError("%s is not in %s" % (rel, rev))
        return b.decode("utf-8")
    with open(os.path.join(C.ROOT, rel.replace("/", os.sep)), "rb") as f:
        return f.read().decode("utf-8")


def http_text(url, timeout=60):
    """a plain GET (browser-like UA: Cloudflare answers python-urllib with 1010) - live mode reads the SERVED build's own files this way"""
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130 Safari/537.36", "Cache-Control": "no-cache"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8")


def game_dir_url(base):
    """https://host/last-circle/index.html -> (https://host/last-circle/, /last-circle/): the URL path the game is served under (the CDN: /last-circle/, the scoped server: /games/last-circle/)"""
    u = urllib.parse.urlparse(base)
    path = u.path[: u.path.rfind("/") + 1] or "/"
    return "%s://%s%s" % (u.scheme, u.netloc, path), path


def is_live(args):
    """live mode = the pages load the game from --base over the network (no --disk, no --rev)"""
    return not (getattr(args, "disk", False) or getattr(args, "rev", None))


def current_gv(args=None):
    """the build under test's MAP_GEN_VERSION: the working copy's maps.js, or - in live mode - the one the CDN serves"""
    if args is not None and is_live(args):
        try:
            txt = http_text(game_dir_url(args.base)[0] + "runtime/3d/royale/maps.js")
        except Exception as e:
            raise C.EnvFailure("could not read the served maps.js from %s: %s" % (args.base, str(e)[:160]))
    else:
        txt = src_text("runtime/3d/royale/maps.js", getattr(args, "rev", None))      # (--rev: the frozen revision's own version, not the working copy's)
    m = re.search(r"export const MAP_GEN_VERSION = (\d+);", txt)
    if not m:
        raise C.HarnessError("maps.js has no 'export const MAP_GEN_VERSION = <n>;' (lane 7A's contract C-VER)")
    return int(m.group(1))


class Rec:
    """one page's collectors (errors are per page here: two pages share one browser)"""

    def __init__(self, page, name):
        self.name = name
        self.page = page
        self.console_err, self.page_err, self.failed, self.reqs = [], [], [], []
        self.first_doc = None          # (status, url) of the first main-frame document response (live mode: the 200 the URL names)
        page.on("console", lambda m: self.console_err.append(m.text[:300]) if m.type == "error" and "favicon" not in m.text else None)
        page.on("pageerror", lambda e: self.page_err.append(str(e)[:400]))
        page.on("request", lambda r: self.reqs.append(r.url))
        page.on("requestfailed", lambda r: self.failed.append("FAILED %s" % r.url) if "ERR_ABORTED" not in str(r.failure) and "favicon" not in r.url else None)
        page.on("response", lambda r: self.failed.append("HTTP %d %s" % (r.status, r.url)) if r.status >= 400 and "favicon" not in r.url else None)
        page.on("response", self._doc)

    def _doc(self, r):
        try:
            if self.first_doc is None and r.request.resource_type == "document" and r.frame == self.page.main_frame:
                self.first_doc = (r.status, r.url)
        except Exception:
            pass

    def problems(self):
        return {"consoleErrors": self.console_err[:6], "pageErrors": self.page_err[:6], "failedRequests": self.failed[:6]}

    def clean(self):
        return not (self.console_err or self.page_err or self.failed)


class Rig:
    """one Chrome for the whole run; one context + two pages per case"""

    def __init__(self, args):
        self.args = args
        self.sess = C.Session(args, name="squadguard")
        self.sess.start()
        # Session.start() opened a context + page we do not use: every case gets its own context (own storage, own BroadcastChannels)
        try:
            self.sess.context.close()
        except Exception:
            pass
        self.browser = self.sess.browser
        self.origin = self.sess.origin()
        self.live = is_live(args)
        self.gdir, self.gpath = game_dir_url(args.base)       # e.g. https://host/last-circle/ and /last-circle/
        self.ctxs = []
        self.external = []              # [(page name, url)] every request that left the build's own origin (live mode judges it)
        self.recs = []                  # (Rec, served from the network?) of every page opened
        self.blocked = []               # production requests the rig aborted

    def close(self):
        for c in self.ctxs:
            try:
                c.close()
            except Exception:
                pass
        self.sess.close()

    def new_ctx(self):
        kw = dict(viewport=self.sess.viewport, device_scale_factor=1)
        ctx = self.browser.new_context(**kw)
        ctx.add_init_script(C.INIT_JS)
        if not self.live:
            disk = C.DiskServer([self.origin], getattr(self.args, "rev", None), self.gpath)
            ctx.route(lambda url: disk.matches(url), disk.handle)
        # supabase-js from esm.sh -> the stand-in (CORS: the page origin is http://127.0.0.1)
        ctx.route(lambda url: "esm.sh/" in url, lambda r: r.fulfill(status=200, body=FAKE_SB, headers={
            "Content-Type": "text/javascript; charset=utf-8", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store"}))
        if self.live:
            # the run must not touch production: the relay is the stand-in above; if anything still reached for Supabase it is aborted (and the `no external` row fails)
            def hit_prod(route):
                self.blocked.append(route.request.url)
                route.abort()
            ctx.route(lambda url: ".supabase.co" in url, hit_prod)
        self.ctxs.append(ctx)
        return ctx

    def page(self, ctx, name, rev=None, gv=None, plant=None, vq=None):
        """a page whose game files come from the working copy, or from git `rev` (an older build);
        gv: None = as is, int = maps.js exports that MAP_GEN_VERSION, 'undef' = the export's value is undefined (version 1 by absence);
        plant: None | 'no-guard' | 'bare-import' | 'no-fallback' (a planted fault in the served net.js); vq: replace the ?v= of index.html"""
        pg = ctx.new_page()
        pg.set_default_timeout(60_000)
        rec = Rec(pg, name)
        me = urllib.parse.urlparse(self.origin).netloc
        pg.on("request", lambda r: self.external.append((name, r.url)) if urllib.parse.urlparse(r.url).netloc != me and not r.url.startswith(("data:", "blob:")) else None)
        if rev:
            old = C.DiskServer([self.origin], rev, self.gpath)
            pg.route(lambda url: old.matches(url), old.handle)
        served_live = self.live and not rev          # this page's game files come from the network: edits are applied to the response in flight

        def served_text(route, rel):
            """the text of the file this page is served: the committed build (rev), the working copy, or - live mode - the network response itself"""
            if served_live:
                return route.fetch().text()
            return src_text(rel, rev)

        def js_route(suffix, edit):
            def pred(url):
                u = urllib.parse.urlparse(url)
                return u.netloc == urllib.parse.urlparse(self.origin).netloc and u.path.endswith(suffix)

            def handler(route):
                u = urllib.parse.urlparse(route.request.url)
                rel = urllib.parse.unquote(u.path[len(self.gpath):])
                body = edit(served_text(route, rel))
                route.fulfill(status=200, body=body.encode("utf-8"), headers={"Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store",
                                                                              "Access-Control-Allow-Origin": "*"})
            pg.route(pred, handler)

        if gv is not None:
            val = "undefined" if gv == "undef" else str(int(gv))
            js_route("/royale/maps.js", lambda t: re.sub(r"export const MAP_GEN_VERSION = \d+;", "export const MAP_GEN_VERSION = %s;" % val, t, count=1))
        if plant == "no-guard":
            js_route("/royale/net.js", lambda t: t.replace("if (l === r) return null;", "return null;", 1))
        elif plant == "bare-import":
            js_route("/royale/net.js", lambda t: t.replace('import("./maps.js" + V)', 'import("./maps.js")', 1))
        elif plant == "no-fallback":
            # C-FALLBACK control: the client NOTICES its map fell back and stays in the squad anyway (the Wave-7 defect: it advertises version N and holds another world)
            anchor = "function leaveForFallback(W, fb) {"
            if not served_live and anchor not in src_text("runtime/3d/royale/net.js", rev):
                raise C.HarnessError("plant no-fallback: net.js has no %r (the planted-fault anchor moved)" % anchor)
            js_route("/royale/net.js", lambda t: t.replace(anchor, anchor + "\n  return;   // PLANTED: the fallback is noticed and ignored", 1))
        if vq:
            def idx_pred(url):
                u = urllib.parse.urlparse(url)
                return u.netloc == urllib.parse.urlparse(self.origin).netloc and (u.path.endswith("/index.html") or u.path.endswith(self.gpath))

            def idx_handler(route):
                body = re.sub(r"\?v=\d+", "?v=" + vq, served_text(route, "index.html"))
                route.fulfill(status=200, body=body.encode("utf-8"), headers={"Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store"})
            pg.route(idx_pred, idx_handler)
        self.recs.append((rec, served_live))
        return pg, rec


def boot_url(pg, url, timeout_s):
    resp = pg.goto(url, wait_until="commit", timeout=120_000)
    # fail fast: a page whose index answered 4xx/5xx can never boot (this is what made the first live run wait out the full --boot-timeout in every case)
    if resp is not None and resp.status >= 400:
        raise C.EnvFailure("the index answered HTTP %d at %s (no boot is possible; not waiting %d s)" % (resp.status, url, int(timeout_s)))
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        try:
            if pg.evaluate("() => !!(window.__LC__ && window.__LC__.W && window.__LC__.W.kernel && window.__LC__.W.events)"):
                return round(time.time() - t0, 1)
        except Exception:
            pass
        pg.wait_for_timeout(300)
    return None


def wait(pg, js, timeout_s, poll=0.25, arg=None):
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        try:
            r = pg.evaluate(js, arg) if arg is not None else pg.evaluate(js)
            if r:
                return r
        except Exception:
            pass
        pg.wait_for_timeout(int(poll * 1000))
    return None


def open_lobby(pg):
    for _ in range(3):                       # first visit: HOW TO PLAY covers the menu - close it like a player
        g = pg.evaluate(GOTIT_JS)
        if not g:
            break
        pg.mouse.click(g[0], g[1])
        pg.wait_for_timeout(500)
    s = pg.evaluate(SQUAD_JS)
    if s:
        pg.mouse.click(s[0], s[1])
    else:
        pg.evaluate("() => window.__LC__.W.events.emit('openOnline', { mode: 'standard' })")
    return wait(pg, "() => !![...document.querySelectorAll('div')].find((d) => d.style && d.style.minWidth === '380px')", 20)


def lobby(pg):
    return pg.evaluate(LOBBY_JS)


def host_create(pg):
    pg.locator('button:text-is("CREATE ROOM")').first.click(timeout=20_000)
    # the status line reads "Room ABCD - share this code." (or "... N player(s) connected" for an instant: either carries the code)
    ok = wait(pg, r"() => /Room\s+[A-Z0-9]{4}\s+[-\u2014]/.test(document.body.innerText)", 30)
    if not ok:
        return None
    m = re.search(r"Room\s+([A-Z0-9]{4})", lobby(pg)["status"])
    return m.group(1) if m else None


def guest_join(pg, code):
    pg.fill('input[placeholder="CODE"]', code)
    pg.locator('button:text-is("JOIN")').first.click(timeout=20_000)


def msgs(pg, t=None, dir=None):
    return [m for m in pg.evaluate(LOG_JS) if (t is None or m["t"] == t) and (dir is None or m["dir"] == dir)]


def shot(args, pg, name):
    """--shots: a PNG of the page into _harness/_shots/squadguard/ (what a player sees)"""
    if not getattr(args, "shots", False):
        return
    d = os.path.join(C.SHOTS, "squadguard")
    os.makedirs(d, exist_ok=True)
    try:
        pg.screenshot(path=os.path.join(d, name + ".png"))
    except Exception as e:
        print("  (screenshot %s failed: %s)" % (name, str(e).splitlines()[0][:100]))


def press_start(pg):
    pg.locator('button:text-is("START MATCH")').first.click(timeout=20_000)


# ─────────────────────────────── the cases ───────────────────────────────
def case_pair(rig, v, args, name, host_kw, guest_kw, N):
    """boots a host page and a guest page in a fresh context, stubs startMatch (unless --full), returns (ctx, host, hrec, guest, grec, code)"""
    ctx = rig.new_ctx()
    hpg, hrec = rig.page(ctx, name + "/host", **host_kw)
    gpg, grec = rig.page(ctx, name + "/guest", **guest_kw)
    # one page boots at a time: the box is shared and a menu boot is the heavy part
    for label, pg in (("host", hpg), ("guest", gpg)):
        t = boot_url(pg, args.base, args.boot_timeout)
        if t is None:
            raise C.EnvFailure("%s %s: __LC__ never appeared within %s s" % (name, label, args.boot_timeout))
    if not getattr(args, "full_now", False):
        hpg.evaluate(STUB_START_JS)
        gpg.evaluate(STUB_START_JS)
    for label, pg in (("host", hpg), ("guest", gpg)):
        if not open_lobby(pg):
            raise C.EnvFailure("%s %s: the SQUAD UP lobby never opened" % (name, label))
    code = host_create(hpg)
    if not code:
        raise C.EnvFailure("%s: the host's room code never appeared (lobby %r)" % (name, (lobby(hpg).get("status") or "")[:120]))
    guest_join(gpg, code)
    return ctx, hpg, hrec, gpg, grec, code


def case_same(rig, v, args, N):
    name = "same"
    ctx, hpg, hrec, gpg, grec, code = case_pair(rig, v, args, name, dict(vq=COLD_V, plant=args.plant), dict(vq=COLD_V, plant=args.plant), N)
    # both lobbies list both players
    both = wait(hpg, "() => document.body.innerText.includes('2 player')", 30) and wait(gpg, "() => document.body.innerText.includes('2 player')", 30)
    hl, gl = lobby(hpg), lobby(gpg)
    v.check("same: host and guest lobbies list 2 players (join works as before)", bool(both) and len(hl["roster"]) == 2 and len(gl["roster"]) == 2,
            {"hostRoster": hl["roster"], "guestRoster": gl["roster"]})
    v.check("same: no refusal on screen, no notice, no version badge", not hl["refused"] and not gl["refused"] and not hl["notices"] and not gl["notices"]
            and not any("VERSION" in r for r in hl["roster"] + gl["roster"]), {"host": hl["notices"], "guest": gl["notices"]})
    hh, gh = msgs(hpg, "hello", "out"), msgs(gpg, "hello", "out")
    hello_ok = bool(hh) and bool(gh) and hh[0]["d"].get("gv") == N and hh[0]["d"].get("host") == 1 and gh[0]["d"].get("gv") == N and gh[0]["d"].get("host") == 0
    v.check("same: hello carries gv=%d and the host flag on the wire" % N, hello_ok, {"hostHello": hh[:1] and hh[0]["d"], "guestHello": gh[:1] and gh[0]["d"]})
    press_start(hpg)
    if args.full:
        return finish_full(rig, v, args, hpg, gpg, hrec, grec, N)
    hs = wait(hpg, "() => (window.__SQ_START__ || []).length > 0", 20)
    gs = wait(gpg, "() => (window.__SQ_START__ || []).length > 0", 30)
    hst, gst = hpg.evaluate(STARTS_JS), gpg.evaluate(STARTS_JS)
    same_world = bool(hst) and bool(gst) and hst[0]["seed"] == gst[0]["seed"] and hst[0]["mapId"] == gst[0]["mapId"] and hst[0]["mode"] == gst[0]["mode"]
    v.check("same: START starts the SAME seed / map / mode on both pages", bool(hs) and bool(gs) and same_world,
            {"host": hst[:1] and {k: hst[0][k] for k in ("seed", "mapId", "mode")}, "guest": gst[:1] and {k: gst[0][k] for k in ("seed", "mapId", "mode")}})
    v.check("same: 2 humans, the guest is 'self' in slot 1 and guestOf=host; the host is slot 0 and guestOf=null",
            bool(hst) and bool(gst) and len(hst[0]["humans"]) == 2 and len(gst[0]["humans"]) == 2 and gst[0]["humans"][1].get("self") is True
            and gst[0]["humans"][1]["slot"] == 1 and gst[0].get("guestOf") == "host" and hst[0]["humans"][0].get("self") is True and hst[0].get("guestOf") is None,
            {"host": hst[:1] and (hst[0]["humans"], hst[0].get("guestOf")), "guest": gst[:1] and (gst[0]["humans"], gst[0].get("guestOf"))})
    start_gv = [m for m in msgs(hpg, "start", "out")]
    v.check("same: the start message on the wire carries the host's gv next to the seed and keeps every old field",
            bool(start_gv) and start_gv[0]["d"].get("gv") == N and all(k in start_gv[0]["d"] for k in ("seed", "mapId", "mode", "roster")), start_gv[:1] and start_gv[0]["d"])
    v.check("same: no refuse / bye on the wire", not msgs(hpg, "refuse") and not msgs(gpg, "refuse") and not msgs(gpg, "bye"), {})
    # the cold-cache ?v= proof: maps.js is fetched ONCE per page, with the new query, and never without it
    for rec in (hrec, grec):
        maps = [u for u in rec.reqs if "/royale/maps.js" in u]
        royale = [u for u in rec.reqs if "/runtime/3d/royale/" in u and u.split("?")[0].endswith(".js")]
        bad = [u for u in royale if "v=" + COLD_V not in u]
        v.check("same: %s fetches maps.js once, with ?v=%s (net.js's import rides the boot's query), and every royale module carries it" % (rec.name.split("/")[1], COLD_V),
                len(maps) == 1 and "v=" + COLD_V in maps[0] and not bad, {"mapsRequests": maps, "royaleModulesWithoutQuery": bad[:4], "royaleModules": len(royale)})
    diag(v, "same", hrec, grec)
    return ctx


def case_mismatch(rig, v, args, N, name, guest_kw, gv_label, newer=False):
    ctx, hpg, hrec, gpg, grec, code = case_pair(rig, v, args, name, dict(plant=None), dict(plant=args.plant, **guest_kw), N)
    refused = wait(gpg, "() => { const b = [...document.querySelectorAll('div')].find((d) => d.style && d.style.minWidth === '380px'); const s = b && b.children[1]; return !!(s && s.getAttribute('data-net-refused')); }", 30)
    gl = lobby(gpg)
    shot(args, gpg, name + "_guest")
    v.check("%s: the guest REFUSES the room on screen (data-net-refused set)" % name, bool(refused) and bool(gl.get("refused")),
            {"refused": gl.get("refused"), "status": (gl.get("status") or "")[:200], "roster": gl.get("roster")})
    st = gl.get("status") or ""
    if newer:
        v.check("%s: the message names both versions and tells the guest to ask the host to reload (no reload button)" % name,
                "ask the host to reload" in st.lower() and ("version %d" % N) in st and ("version %d" % (N + 1)) in st and not gl.get("reload"), {"status": st, "reload": gl.get("reload")})
    else:
        gv_txt = ("version %d" % (N - 1)) if gv_label != 1 else "version 1"
        v.check("%s: the message says this page is out of date, names both versions and says to reload; a RELOAD PAGE button is on screen" % name,
                "out of date" in st.lower() and "reload the page" in st.lower() and ("version %d" % N) in st and gv_txt in st and bool(gl.get("reload")),
                {"status": st, "reload": gl.get("reload")})
    v.check("%s: the guest's create/join buttons are usable again, no START button" % name,
            any(b.startswith("CREATE ROOM") and ":disabled" not in b for b in gl.get("buttons", [])) and not any(b.startswith("START") and ":hidden" not in b for b in gl.get("buttons", [])), gl.get("buttons"))
    # the host reads why
    sawn = wait(hpg, "() => { const n = document.querySelector('[data-net-notice]'); return !!(n && n.children.length); }", 20)
    hl = lobby(hpg)
    shot(args, hpg, name + "_host")
    ref_msgs = msgs(hpg, "refuse", "in")
    v.check("%s: the HOST sees why (a lobby line naming the guest and both versions)" % name,
            bool(sawn) and any(("version %d" % (N - 1 if not newer else N + 1)) in n or ("version 1" in n and gv_label == 1) for n in hl["notices"]) and any("Player-" in n or "not in this match" in n for n in hl["notices"]),
            {"notices": hl["notices"], "roster": hl["roster"]})
    v.check("%s: the host's roster row for the guest is badged with its version" % name, any("VERSION" in r for r in hl["roster"]), hl["roster"])
    v.check("%s: a refuse message reached the host with the guest's gv / the room's gv" % name,
            bool(ref_msgs) and ref_msgs[0]["d"].get("hostGv") == N and ref_msgs[0]["d"].get("gv") == (N + 1 if newer else (1 if gv_label == 1 else N - 1)), ref_msgs[:1])
    press_start(hpg)
    hs = wait(hpg, "() => (window.__SQ_START__ || []).length > 0", 20)
    hst = hpg.evaluate(STARTS_JS)
    start_msg = msgs(hpg, "start", "out")
    v.check("%s: START rosters the host ALONE (the mismatched guest gets no slot)" % name,
            bool(hs) and len(hst[0]["humans"]) == 1 and len(start_msg[0]["d"]["roster"]) == 1, {"humans": hst[:1] and hst[0]["humans"], "roster": start_msg[:1] and start_msg[0]["d"]["roster"]})
    gpg.wait_for_timeout(1500)
    v.check("%s: the guest never starts a match" % name, not gpg.evaluate(STARTS_JS), gpg.evaluate(STARTS_JS))
    diag(v, name, hrec, grec)
    return ctx


def case_preguard_guest(rig, v, args, N):
    name = "preguard-guest"
    ctx, hpg, hrec, gpg, grec, code = case_pair(rig, v, args, name, dict(), dict(rev=args.old_rev), N)
    hh = wait(hpg, "() => { const n = document.querySelector('[data-net-notice]'); return !!(n && n.children.length); }", 30)
    hl = lobby(hpg)
    gh = msgs(gpg, "hello", "out")
    v.check("%s: the old guest's hello has no gv (it is the live %s build)" % (name, args.old_rev), bool(gh) and "gv" not in gh[0]["d"], gh[:1])
    v.check("%s: the host's lobby says the old guest cannot join (version 1) and badges its roster row" % name,
            bool(hh) and any("version 1" in n for n in hl["notices"]) and any("VERSION 1" in r for r in hl["roster"]), {"notices": hl["notices"], "roster": hl["roster"]})
    press_start(hpg)
    wait(hpg, "() => (window.__SQ_START__ || []).length > 0", 20)
    hst = hpg.evaluate(STARTS_JS)
    gl = None
    for _ in range(40):
        gl = lobby(gpg)
        if gl.get("open") and "Room is full" in (gl.get("text") or ""):
            break
        gpg.wait_for_timeout(250)
    v.check("%s: START rosters the host alone" % name, bool(hst) and len(hst[0]["humans"]) == 1, hst[:1] and hst[0]["humans"])
    v.check("%s: the old guest gets its own (unchanged) 'Room is full ... started without you' and starts no match" % name,
            bool(gl) and "Room is full" in (gl.get("text") or "") and not gpg.evaluate(STARTS_JS), {"text": (gl or {}).get("text", "")[:240]})
    diag(v, name, hrec, grec)
    return ctx


def case_preguard_host(rig, v, args, N):
    name = "preguard-host"
    ctx = rig.new_ctx()
    hpg, hrec = rig.page(ctx, name + "/host", rev=args.old_rev)
    gpg, grec = rig.page(ctx, name + "/guest", plant=args.plant)
    for label, pg in (("host", hpg), ("guest", gpg)):
        if boot_url(pg, args.base, args.boot_timeout) is None:
            raise C.EnvFailure("%s %s: __LC__ never appeared" % (name, label))
    hpg.evaluate(STUB_START_JS)
    gpg.evaluate(STUB_START_JS)
    for label, pg in (("host", hpg), ("guest", gpg)):
        if not open_lobby(pg):
            raise C.EnvFailure("%s %s: lobby never opened" % (name, label))
    code = host_create(hpg)
    if not code:
        raise C.EnvFailure("%s: the old host's room code never appeared" % name)
    guest_join(gpg, code)
    wait(hpg, "() => document.body.innerText.includes('2 player')", 30)
    gl = lobby(gpg)
    hh = msgs(hpg, "hello", "out")
    v.check("%s: the old host's hello has no gv / host flag" % name, bool(hh) and "gv" not in hh[0]["d"] and "host" not in hh[0]["d"], hh[:1])
    v.check("%s: before START the new guest has no reason to refuse (the old host does not say it is the host)" % name, not gl.get("refused"), gl.get("status"))
    press_start(hpg)
    wait(hpg, "() => (window.__SQ_START__ || []).length > 0", 20)
    hst = hpg.evaluate(STARTS_JS)
    refused = wait(gpg, "() => { const b = [...document.querySelectorAll('div')].find((d) => d.style && d.style.minWidth === '380px'); const s = b && b.children[1]; return !!(s && s.getAttribute('data-net-refused')); }", 30)
    gl = lobby(gpg)
    st = gl.get("status") or ""
    v.check("%s: the old host rostered the guest (2 humans) - the case being protected" % name, bool(hst) and len(hst[0]["humans"]) == 2, hst[:1] and hst[0]["humans"])
    v.check("%s: the guest refuses at the old host's START and says the HOST is out of date (ask them to reload)" % name,
            bool(refused) and "host's game is out of date" in st.lower() and "ask the host to reload" in st.lower() and "version 1" in st and not gl.get("reload"), {"status": st, "reload": gl.get("reload")})
    gout = msgs(gpg, "refuse", "out")
    bye = msgs(gpg, "bye", "out")
    v.check("%s: the guest sent refuse{gv=%d, hostGv=1} and a bye for the slot the old host gave it (s1)" % (name, N),
            bool(gout) and gout[0]["d"].get("gv") == N and gout[0]["d"].get("hostGv") == 1 and bool(bye) and bye[0]["d"].get("slot") == "s1", {"refuse": gout[:1], "bye": bye[:1]})
    hbye = msgs(hpg, "bye", "in")
    v.check("%s: the old host received the bye (it hands the body to a bot brain)" % name, bool(hbye) and hbye[0]["d"].get("slot") == "s1", hbye[:1])
    v.check("%s: the guest never starts a match" % name, not gpg.evaluate(STARTS_JS), gpg.evaluate(STARTS_JS))
    diag(v, name, hrec, grec)
    return ctx


def case_refuse_live(rig, v, args, N):
    name = "refuse-live"
    ctx, hpg, hrec, gpg, grec, code = case_pair(rig, v, args, name, dict(), dict(), N)
    wait(hpg, "() => document.body.innerText.includes('2 player')", 30)
    wait(gpg, "() => document.body.innerText.includes('2 player')", 30)
    # no match is loaded here (startMatch is a recorder), so the HUD - and its chat log - does not exist: W.pushChat is recorded instead; the real
    # HUD path (the line really on screen) is case older-full
    hpg.evaluate("() => { const W = window.__LC__.W; window.__SQ_REF__ = []; window.__SQ_CHAT__ = []; W.events.on('squadRefused', (i) => window.__SQ_REF__.push(i)); W.pushChat = (name, text, own) => window.__SQ_CHAT__.push({ name, text, own }); return true; }")
    press_start(hpg)
    wait(hpg, "() => (window.__SQ_START__ || []).length > 0", 20)
    wait(gpg, "() => (window.__SQ_START__ || []).length > 0", 30)
    # the guest says it will not build this world (a late refusal)
    gpg.evaluate("(n) => window.__LC__.W.net.net.send('refuse', { gv: n - 1, hostGv: n, name: 'LateJoiner' })", N)
    got = wait(hpg, "() => (window.__LC__.W.net.refusals || []).length > 0", 20)
    chat_rows = hpg.evaluate("() => window.__SQ_CHAT__")
    chat = " | ".join("%s: %s" % (r["name"], r["text"]) for r in chat_rows) if chat_rows else None
    ref = hpg.evaluate("() => window.__LC__.W.net.refusals")
    ev = hpg.evaluate("() => window.__SQ_REF__")
    v.check("%s: the host recorded the refusal (W.net.refusals) with the guest's and the room's version" % name,
            bool(got) and len(ref) == 1 and ref[0]["name"] == "LateJoiner" and ref[0]["gv"] == N - 1 and ref[0]["hostGv"] == N, ref)
    v.check("%s: the host is told, through the HUD chat line (W.pushChat 'SQUAD'), who could not join and why, in plain words" % name,
            bool(chat) and "LateJoiner" in chat and "could not join" in chat and ("version %d" % (N - 1)) in chat and ("version %d" % N) in chat and "reload" in chat.lower(),
            {"chat": chat})
    v.check("%s: the squadRefused event fired once on the host" % name, len(ev) == 1 and ev[0].get("by") == "guest" and ev[0].get("name") == "LateJoiner", ev)
    shot(args, hpg, name + "_host")
    diag(v, name, hrec, grec)
    return ctx


def case_older_full(rig, v, args, N):
    name = "older-full"
    if not args.full:
        v.note("older-full needs --full (a real host match): skipped")
        return None
    args.full_now = True            # no startMatch stub on either page
    ctx, hpg, hrec, gpg, grec, code = case_pair(rig, v, args, name, dict(), dict(gv=N - 1), N)
    wait(hpg, "() => { const n = document.querySelector('[data-net-notice]'); return !!(n && n.children.length); }", 30)
    press_start(hpg)
    t0 = time.time()
    # the HUD's chat log shows a line for 9 s: poll fast from the moment the match goes live
    chat = None
    deadline = time.time() + args.load_timeout
    while time.time() < deadline:
        try:
            ph = hpg.evaluate("() => window.__LC__.W.phase")
            c = hpg.evaluate("() => { const c = document.querySelector('[data-lc=chat]'); return c ? c.innerText : ''; }")
        except Exception:
            ph, c = None, ""
        if "not in this match" in (c or ""):
            chat = c
            break
        hpg.wait_for_timeout(250)
    if chat is None:
        raise C.EnvFailure("older-full: no 'not in this match' chat line within %d s (phase %s)" % (args.load_timeout, hpg.evaluate("() => window.__LC__.W.phase")))
    humans = hpg.evaluate("() => window.__LC__.W.actors.filter((a) => a.netRemote && !a.isBot).length")
    v.check("%s: once the HUD is up the host's chat log says the guest is not in this match, with both versions" % name,
            "not in this match" in chat and ("version %d" % (N - 1)) in chat and ("version %d" % N) in chat, {"chat": chat, "afterS": round(time.time() - t0)})
    v.check("%s: the real match started with the host alone (no remote human actor)" % name, humans == 0, {"remoteHumans": humans})
    shot(args, hpg, name + "_host")
    diag(v, name, hrec, grec)
    return ctx


# ─────────────────────────────── C-FALLBACK cases (lane D1) ───────────────────────────────
CHAT_JS = "() => { const c = document.querySelector('[data-lc=chat]'); return c ? c.innerText : ''; }"
REC_JS = r"""() => { const W = window.__LC__.W; window.__SQ_FB__ = []; window.__SQ_CHAT__ = []; window.__SQ_HL__ = [];
  if (!window.__SQ_FBL__) { window.__SQ_FBL__ = true; W.events.on('squadMapFallback', (i) => window.__SQ_FB__.push(JSON.parse(JSON.stringify(i)))); }
  W.events.on('hostLost', (n) => window.__SQ_HL__.push(n));
  W.pushChat = (name, text, own) => window.__SQ_CHAT__.push({ name, text, own }); return true; }"""
# "this client's match is live" with an actor for slot 1 that exists but is not alive (so a take-over has nothing to attach a brain to in a stubbed run)
LIVE_HOST_JS = r"""() => { const W = window.__LC__.W, m = window.__NETMOD__;
  W.lootSyncState = () => ({ taken: [], opened: [] });
  W.actorById = W.actorById || new Map(); W.actorById.set('s1', { id: 's1', alive: false, netRemote: true, isBot: false });
  m.onMatchStart(W); return true; }"""
LIVE_GUEST_JS = r"""() => { const W = window.__LC__.W, m = window.__NETMOD__, real = W.player;
  W.player = { id: 's1', alive: true };       // the guest's own body exists once the match is live (drainPending waits for it)
  try { m.onMatchStart(W); } finally { W.player = real; }
  return true; }"""


def _both_in_room(hpg, gpg):
    wait(hpg, "() => document.body.innerText.includes('2 player')", 30)
    wait(gpg, "() => document.body.innerText.includes('2 player')", 30)


def _start_both(name, hpg, gpg):
    press_start(hpg)
    hs = wait(hpg, "() => (window.__SQ_START__ || []).length > 0", 20)
    gs = wait(gpg, "() => (window.__SQ_START__ || []).length > 0", 30)
    if not hs or not gs:
        raise C.EnvFailure("%s: START did not reach both pages (host %s, guest %s)" % (name, bool(hs), bool(gs)))
    for pg in (hpg, gpg):
        if not pg.evaluate(NETMOD_JS):
            raise C.EnvFailure("%s: could not load the page's net.js module (no ffg_boot3d.js script tag?)" % name)


def _card_rows(v, name, card, who, N, B=None):
    """the card a leaver sees: title, plain words, RELOAD PAGE + KEEP PLAYING, inside the viewport"""
    txt = (card or {}).get("text", "")
    v.check("%s: %s shows the card on screen: 'Part of the map failed to load', that it left the room, and to reload the page" % (name, who),
            bool(card) and card.get("visible") and "part of the map failed to load" in txt.lower() and "reload the page" in txt.lower() and "left the room" in txt.lower(),
            {"text": txt[:300]})
    v.check("%s: %s's card has a visible RELOAD PAGE and KEEP PLAYING button and sits inside the viewport" % (name, who),
            bool(card) and card.get("reload") and card.get("dismiss") and card["left"] >= 0 and card["right"] <= card["vw"], {k: card.get(k) for k in ("reload", "dismiss", "left", "right", "vw")} if card else None)
    B = N - 1 if B is None else B      # (the stub cases report to = N - 1; the real-path case passes the version the page's map really says)
    v.check("%s: %s's card names the versions (data-net-fallback = '%d/%s')" % (name, who, N, B), bool(card) and card.get("attr") == "%d/%s" % (N, B), card and card.get("attr"))


def case_fallback(rig, v, args, N):
    name = "fallback"
    ctx, hpg, hrec, gpg, grec, code = case_pair(rig, v, args, name, dict(), dict(plant=args.plant), N)
    _both_in_room(hpg, gpg)
    hpg.evaluate(REC_JS)
    gpg.evaluate(REC_JS)
    gname = gpg.evaluate("() => window.__LC__.W.net.myName")
    _start_both(name, hpg, gpg)
    # the guest's map "falls back" exactly as maps.js reports it, and the orchestrator says the match is live
    gpg.evaluate(FALLBACK_JS, N)
    card = wait(gpg, CARD_JS, 8)
    shot(args, gpg, name + "_guest")
    _card_rows(v, name, card, "the guest", N)
    st = gpg.evaluate(LEFT_JS)
    left = st.get("left") or {}
    v.check("%s: the guest has LEFT the squad: W.net is null, W.squadLeft = map-fallback with both versions, one squadMapFallback event (by self)" % name,
            st["net"] == "null" and left.get("reason") == "map-fallback" and left.get("wanted") == N and left.get("built") == N - 1 and left.get("host") is False
            and len(st["events"]) == 1 and st["events"][0].get("by") == "self", st)
    mf, bye = msgs(gpg, "mapfail", "out"), msgs(gpg, "bye", "out")
    v.check("%s: on the wire the guest sent ONE mapfail {gv %d, wanted %d, built %d, slot 1, host 0, its name} and the old-style bye for s1, in that order" % (name, N, N, N - 1),
            len(mf) == 1 and mf[0]["d"].get("gv") == N and mf[0]["d"].get("wanted") == N and mf[0]["d"].get("built") == N - 1 and mf[0]["d"].get("slot") == 1
            and mf[0]["d"].get("host") == 0 and mf[0]["d"].get("name") == gname and len(bye) == 1 and bye[0]["d"].get("slot") == "s1" and mf[0]["at"] <= bye[0]["at"],
            {"mapfail": mf[:2], "bye": bye[:2]})
    # the host reads it
    got = wait(hpg, "() => { const n = window.__LC__.W.net; return !!(n && n.mapFails && n.mapFails.length); }", 20)
    hs = hpg.evaluate(FAILS_JS) or {}
    f0 = (hs.get("fails") or [{}])[0]
    v.check("%s: the host recorded who left and why (slot s1, the guest's name, not the host, both versions)" % name,
            bool(got) and len(hs["fails"]) == 1 and f0.get("id") == "s1" and f0.get("name") == gname and f0.get("host") is False and f0.get("wanted") == N and f0.get("built") == N - 1, hs)
    v.check("%s: the host is still loading its match (no HUD): the line and the slot take-over are HELD, not lost (pendingNotices has the line, pendingTakeovers = s1), nothing shown yet" % name,
            len(hs.get("pendingNotices") or []) == 1 and gname in hs["pendingNotices"][0] and "map failed to load" in hs["pendingNotices"][0].lower()
            and hs.get("pendingTakeovers") == ["s1"] and not hpg.evaluate("() => window.__SQ_CHAT__"), hs)
    v.check("%s: the host STAYS in the room and shows no card (only the client with the broken map leaves)" % name,
            hpg.evaluate(LEFT_JS)["net"] == "object" and hpg.evaluate(CARD_JS) is None, hpg.evaluate(LEFT_JS))
    hev = hpg.evaluate("() => window.__SQ_FB__")
    v.check("%s: the host's squadMapFallback event fired once (by peer) with the guest's name and versions" % name,
            len(hev) == 1 and hev[0].get("by") == "peer" and hev[0].get("name") == gname and hev[0].get("wanted") == N and hev[0].get("built") == N - 1 and hev[0].get("host") is False, hev)
    # the host's match goes live: the held line is shown in the HUD chat log and the slot is dealt with
    hpg.evaluate(LIVE_HOST_JS)
    chat = hpg.evaluate("() => window.__SQ_CHAT__")
    hs2 = hpg.evaluate(FAILS_JS) or {}
    ctext = " | ".join("%s: %s" % (r["name"], r["text"]) for r in chat)
    v.check("%s: once the host's match is live the HUD chat log (W.pushChat 'SQUAD') says who left and why, in plain words" % name,
            len(chat) == 1 and chat[0]["name"] == "SQUAD" and gname in ctext and "left the squad" in ctext and "map failed to load" in ctext and "reload the page" in ctext, {"chat": ctext})
    v.check("%s: ...and the held slot is worked off (pendingTakeovers empty, pendingNotices empty); a healthy host did not leave (W.net still set, no card)" % name,
            not hs2.get("pendingTakeovers") and not hs2.get("pendingNotices") and hpg.evaluate(LEFT_JS)["net"] == "object" and hpg.evaluate(CARD_JS) is None, hs2)
    v.check("%s: the healthy host's own match start still sends its world sync (nothing about the host's normal start changed)" % name, len(msgs(hpg, "sync", "out")) == 1, msgs(hpg, "sync", "out")[:1])
    shot(args, hpg, name + "_host")
    diag(v, name, hrec, grec)
    return ctx


def case_fallback_host(rig, v, args, N):
    name = "fallback-host"
    ctx, hpg, hrec, gpg, grec, code = case_pair(rig, v, args, name, dict(plant=args.plant), dict(), N)
    _both_in_room(hpg, gpg)
    hpg.evaluate(REC_JS)
    gpg.evaluate(REC_JS)
    hname = hpg.evaluate("() => window.__LC__.W.net.myName")
    _start_both(name, hpg, gpg)
    hpg.evaluate(FALLBACK_JS, N)
    card = wait(hpg, CARD_JS, 8)
    shot(args, hpg, name + "_host")
    _card_rows(v, name, card, "the host", N)
    st = hpg.evaluate(LEFT_JS)
    left = st.get("left") or {}
    v.check("%s: the host has LEFT the squad (W.net null, W.squadLeft map-fallback, host true)" % name,
            st["net"] == "null" and left.get("reason") == "map-fallback" and left.get("host") is True and left.get("wanted") == N and left.get("built") == N - 1, st)
    mf, bye = msgs(hpg, "mapfail", "out"), msgs(hpg, "bye", "out")
    v.check("%s: on the wire the host sent ONE mapfail {host 1, slot 0} and the old-style bye for s0 (builds from before the contract still see the host go)" % name,
            len(mf) == 1 and mf[0]["d"].get("host") == 1 and mf[0]["d"].get("slot") == 0 and mf[0]["d"].get("name") == hname and len(bye) == 1 and bye[0]["d"].get("slot") == "s0", {"mapfail": mf[:2], "bye": bye[:2]})
    got = wait(gpg, "() => { const n = window.__LC__.W.net; return !!(n && n.mapFails && n.mapFails.length); }", 20)
    gs = gpg.evaluate(FAILS_JS) or {}
    f0 = (gs.get("fails") or [{}])[0]
    v.check("%s: the guest recorded that the HOST left (slot s0, host true) and holds the line until its match is live (no actors yet: hostGone is pending)" % name,
            bool(got) and len(gs["fails"]) == 1 and f0.get("id") == "s0" and f0.get("host") is True and f0.get("name") == hname and gs.get("hostGone") is True
            and len(gs.get("pendingNotices") or []) == 1 and "the host" in gs["pendingNotices"][0] and "map failed to load" in gs["pendingNotices"][0].lower(), gs)
    v.check("%s: the guest has not left the room and shows no card (it is the host that is wrong)" % name, gpg.evaluate(LEFT_JS)["net"] == "object" and gpg.evaluate(CARD_JS) is None, gpg.evaluate(LEFT_JS))
    gpg.evaluate(LIVE_GUEST_JS)
    chat = gpg.evaluate("() => window.__SQ_CHAT__")
    ctext = " | ".join("%s: %s" % (r["name"], r["text"]) for r in chat)
    hl = gpg.evaluate("() => window.__SQ_HL__")
    v.check("%s: once the guest's match is live it continues offline like a lost host (hostLost fired once, W.net null) and the chat log says the host had to leave and why" % name,
            len(hl) == 1 and gpg.evaluate(LEFT_JS)["net"] == "null" and len(chat) == 1 and hname in ctext and "the host" in ctext and "map failed to load" in ctext and "offline" in ctext,
            {"hostLost": hl, "chat": ctext, "net": gpg.evaluate(LEFT_JS)["net"]})
    diag(v, name, hrec, grec)
    return ctx


def case_fallback_solo(rig, v, args, N):
    name = "fallback-solo"
    ctx = rig.new_ctx()
    pg, rec = rig.page(ctx, name + "/solo", plant=args.plant)
    if boot_url(pg, args.base, args.boot_timeout) is None:
        raise C.EnvFailure("%s: __LC__ never appeared within %s s" % (name, args.boot_timeout))
    if not pg.evaluate(NETMOD_JS):
        raise C.EnvFailure("%s: could not load the page's net.js module" % name)
    pg.evaluate(FALLBACK_JS, N)       # a solo page: there is no squad session (W.net null) - the event, W.mapFallback and onMatchStart must change nothing
    pg.wait_for_timeout(800)
    st = pg.evaluate(LEFT_JS)
    v.check("%s: a SOLO page (no squad session) shows no card, leaves nothing, sends nothing, fires no squadMapFallback event" % name,
            pg.evaluate(CARD_JS) is None and st["net"] == "null" and st["left"] is None and st["events"] == [] and not pg.evaluate(LOG_JS), {"state": st, "log": pg.evaluate(LOG_JS)[:3]})
    v.check("%s: %s - 0 console errors, 0 page errors, 0 failed requests" % (name, "solo"), rec.clean(), rec.problems())
    return ctx


def case_fallback_full(rig, v, args, N):
    """--full: the REAL path. The guest's towngen.js / citykit.js requests are aborted, so maps.js retries once and builds the Wave-6 Savanna; net.js must
    take that guest out of the squad. Both pages play a real match."""
    name = "fallback-full"
    if not args.full:
        v.note("fallback-full needs --full (two real Savanna matches): skipped")
        return None
    args.full_now = True            # no startMatch stub on either page
    ctx = rig.new_ctx()
    hpg, hrec = rig.page(ctx, name + "/host")
    gpg, grec = rig.page(ctx, name + "/guest", plant=args.plant)
    gpg.route(lambda url: re.search(r"/royale/(towngen|citykit)\.js", url) is not None, lambda r: r.abort())
    for label, pg in (("host", hpg), ("guest", gpg)):
        if boot_url(pg, args.base, args.boot_timeout) is None:
            raise C.EnvFailure("%s %s: __LC__ never appeared within %s s" % (name, label, args.boot_timeout))
    for label, pg in (("host", hpg), ("guest", gpg)):
        if not open_lobby(pg):
            raise C.EnvFailure("%s %s: the SQUAD UP lobby never opened" % (name, label))
    code = host_create(hpg)
    if not code:
        raise C.EnvFailure("%s: the host's room code never appeared" % name)
    guest_join(gpg, code)
    _both_in_room(hpg, gpg)
    for pg in (hpg, gpg):
        pg.evaluate(REC_JS)
        if not pg.evaluate(NETMOD_JS):
            raise C.EnvFailure("%s: could not load the page's net.js module" % name)
    gname = gpg.evaluate("() => window.__LC__.W.net.myName")
    hpg.evaluate("(m) => { window.__LC__.W.randomMap = () => m; return true; }", args.fallback_map)       # the map whose towns the guest loses (Savanna by default; Wave 7b: isla_viva / deepwood too)
    press_start(hpg)
    t0 = time.time()
    card, chat, live_since = None, None, None
    deadline = t0 + args.load_timeout
    while time.time() < deadline:
        if card is None:
            try:
                card = gpg.evaluate(CARD_JS)
            except Exception:
                card = None
        try:
            c = hpg.evaluate(CHAT_JS)
        except Exception:
            c = ""
        if chat is None and c and "map failed to load" in c:
            chat = c
        if card:
            break           # (the guest's own state is read NOW: the host's HUD may take a minute on a busy box, and an idle player in a live fight ages meanwhile)
        try:
            gph = gpg.evaluate("() => window.__LC__.W.phase")
        except Exception:
            gph = None
        if gph in ("drop", "match"):
            live_since = live_since or time.time()
            if time.time() - live_since > 12:
                break       # the guest's match has been live for 12 s with no card: it did NOT leave (the rows below fail it - a planted fault must not read could-not-judge)
        hpg.wait_for_timeout(250)
    if not card and not live_since:
        raise C.EnvFailure("%s: the guest never reached its match within %d s (guest phase %s, host phase %s)" % (
            name, args.load_timeout, gpg.evaluate("() => window.__LC__.W.phase"), hpg.evaluate("() => window.__LC__.W.phase")))
    shot(args, gpg, name + "_guest")
    a0 = gpg.evaluate("() => { const W = window.__LC__.W, P = W.player; return { alive: !!(P && P.alive), hp: P && P.hp, phase: W.phase }; }")
    gw = gpg.evaluate("() => { const W = window.__LC__.W, M = W.map; return { mapId: M && M.id, genVersion: M && M.genVersion, fallback: !!(M && M.fallback), mapFallback: W.mapFallback || null, phase: W.phase }; }")
    # the version a fallen-back page really built is whatever its map says (maps.js: the Wave-6 layout is generator version 2, however far N has moved on);
    # what is judged is that it is OLDER than N, that map.fallback and W.mapFallback { from N, to <that> } agree with it, and that everything net.js says matches it
    B = gw.get("genVersion")
    mf0 = gw.get("mapFallback") or {}
    v.check("%s: the guest REALLY fell back (its %s was built as version %s < %d, map.fallback set, W.mapFallback = { from %d, to %s }) while it advertised %d" % (name, args.fallback_map, B, N, N, B, N),
            gw["mapId"] == args.fallback_map and isinstance(B, int) and B < N and gw["fallback"] and mf0.get("from") == N and mf0.get("to") == B, gw)
    _card_rows(v, name, card, "the guest", N, B)
    st = gpg.evaluate(LEFT_JS)
    left = st.get("left") or {}
    v.check("%s: the guest left the squad (W.net null, W.squadLeft map-fallback %d -> %s)" % (name, N, B),
            st["net"] == "null" and left.get("reason") == "map-fallback" and left.get("wanted") == N and left.get("built") == B and left.get("host") is False and len(st["events"]) == 1, st)
    # the guest plays on as a SOLO match: every other body is a bot with a brain, time moves, it is alive
    gpg.wait_for_timeout(2500)
    BOTS = ("const u = (n) => { const s = [...document.scripts].find((x) => /ffg_boot3d\\.js/.test(x.src)); return new URL('royale/' + n + '.js' + new URL(s.src).search, s.src).href; };")
    solo = gpg.evaluate("async () => { " + BOTS + " const W = window.__LC__.W, B = await import(u('bots')); const t0 = W.t; await new Promise((r) => setTimeout(r, 2500));"
                        " const P = W.player; const fd = (W.match && W.match.feed || []).find((f) => P && f.victim === P.id); return { pid: P && P.id, pDeath: fd ? { killer: fd.killer || null, weapon: fd.weapon || fd.cause || null, t: fd.t } : null, phase: W.phase, tAdvanced: W.t > t0, alive: !!(W.player && W.player.alive), hp: P && P.hp, y: P && P.pos && Math.round(P.pos.y), fb: !!W.squadLeft, aliveCount: W.match && W.match.aliveCount && W.match.aliveCount(), feed: (W.match && W.match.feed || []).slice(-3).map((f) => [f.killer, f.victim, f.weapon || f.cause || null]), actors: W.actors.length, remote: W.actors.filter((a) => a.netRemote).length,"
                        " bots: W.actors.filter((a) => a.isBot && a !== W.player).length, brains: B.debugBrains().length, net: W.net === null }; }")
    # the player was alive the instant the card appeared (leaving must not hurt it); a minute into a live 50-body fight an idle player may legitimately have been
    # shot by a bot, so later on "alive" is judged as: alive, or eliminated by ANOTHER body in the match feed (never "dead with no record")
    v.check("%s: the guest's player was alive (full hp) the instant the card appeared" % name, bool(a0.get("alive")) and (a0.get("hp") or 0) > 0, a0)
    died = solo.get("pDeath")
    v.check("%s: the guest's match carries on solo: phase %s, time advancing, player alive (or its elimination is on the match feed), 0 remote bodies, %d bots and %d brains (every body but its own)" % (name, solo.get("phase"), solo.get("actors", 1) - 1, solo.get("actors", 1) - 1),
            solo["phase"] in ("drop", "match") and solo["tAdvanced"] and (solo["alive"] or bool(died)) and solo["remote"] == 0 and solo["bots"] == solo["actors"] - 1 and solo["brains"] == solo["actors"] - 1 and solo["net"], solo)
    # the host: the guest's body is a bot now, and the host was told why (its HUD may still be loading: wait for the chat line AFTER the guest rows above)
    chat_deadline = min(deadline, time.time() + (90 if card else 5))      # bounded: a guest that did not leave never produces the line, and that must read as a FAIL, soon
    while chat is None and time.time() < chat_deadline:
        try:
            c = hpg.evaluate(CHAT_JS)
        except Exception:
            c = ""
        if c and "map failed to load" in c:
            chat = c
            break
        hpg.wait_for_timeout(250)
    after = round(time.time() - t0)
    hs = hpg.evaluate(FAILS_JS) or {}
    f0 = (hs.get("fails") or [{}])[0]
    v.check("%s: the host recorded who left and why (s1, the guest's name, both versions)" % name,
            len(hs.get("fails") or []) == 1 and f0.get("id") == "s1" and f0.get("name") == gname and f0.get("wanted") == N and f0.get("built") == B and f0.get("host") is False, hs)
    v.check("%s: the host's HUD chat log said, in plain words, who left and why (captured %d s after START)" % (name, after),
            bool(chat) and gname in chat and "left the squad" in chat and "map failed to load" in chat, {"chat": chat})
    hb = None
    for _ in range(40):
        hb = hpg.evaluate("async () => { " + BOTS + " const W = window.__LC__.W, B = await import(u('bots')); const a = W.actorById.get('s1');"
                          " return { isBot: !!(a && a.isBot), netRemote: !!(a && a.netRemote), brain: B.debugBrains().some((b) => b.actor && b.actor.id === 's1'), phase: W.phase, net: W.net ? 'object' : 'null' }; }")
        if hb["isBot"] and not hb["netRemote"] and hb["brain"]:
            break
        hpg.wait_for_timeout(250)
    v.check("%s: the host's copy of the guest's body (s1) is a bot with a brain now (not a frozen remote), and the host stays in the room" % name,
            hb["isBot"] and not hb["netRemote"] and hb["brain"] and hb["net"] == "object", hb)
    v.check("%s: the host shows no card" % name, hpg.evaluate(CARD_JS) is None, None)
    tk = msgs(hpg, "takeover", "out")
    v.check("%s: the host sent takeover for s1 so the other clients follow the bot" % name, len(tk) >= 1 and tk[0]["d"].get("slot") == "s1", tk[:1])
    mf, bye = msgs(gpg, "mapfail", "out"), msgs(gpg, "bye", "out")
    v.check("%s: on the wire the guest sent mapfail {wanted %d, built %s, slot 1} then the old-style bye s1" % (name, N, B),
            len(mf) == 1 and mf[0]["d"].get("wanted") == N and mf[0]["d"].get("built") == B and mf[0]["d"].get("slot") == 1 and len(bye) == 1 and bye[0]["d"].get("slot") == "s1", {"mapfail": mf[:1], "bye": bye[:1]})
    shot(args, hpg, name + "_host")
    # errors: the aborted town modules are the PLANTED condition on the guest, everything else must be clean
    expected = re.compile(r"towngen|citykit|Failed to load resource|\[maps\]|ERR_FAILED", re.I)
    gcons = [e for e in grec.console_err if not expected.search(e)]
    gfail = [f for f in grec.failed if not re.search(r"/royale/(towngen|citykit)\.js", f)]
    v.check("%s: guest - only the planted town-module failures: 0 other console errors, 0 page errors, 0 other failed requests" % name,
            not gcons and not grec.page_err and not gfail, {"consoleErrors": gcons[:6], "pageErrors": grec.page_err[:6], "failedRequests": gfail[:6], "expected": len(grec.console_err) - len(gcons)})
    v.check("%s: host - 0 console errors, 0 page errors, 0 failed requests" % name, hrec.clean(), hrec.problems())
    return ctx


def finish_full(rig, v, args, hpg, gpg, hrec, grec, N):
    """--full: no startMatch stub; both pages load the real match and must build the same world"""
    t0 = time.time()
    ph = wait(hpg, "() => ['drop','match'].includes(window.__LC__.W.phase)", args.load_timeout, 1.0)
    pg_ = wait(gpg, "() => ['drop','match'].includes(window.__LC__.W.phase)", args.load_timeout, 1.0)
    if not ph or not pg_:
        raise C.EnvFailure("--full: a page never reached the drop within %d s (host %s, guest %s) - box contention?" % (
            args.load_timeout, hpg.evaluate("() => window.__LC__.W.phase"), gpg.evaluate("() => window.__LC__.W.phase")))
    hw, gw = hpg.evaluate(WORLD_JS), gpg.evaluate(WORLD_JS)
    v.check("full: both pages built the SAME world (seed, map, genVersion, collider count and hash)",
            hw and gw and all(hw[k] == gw[k] for k in ("seed", "mapId", "genVersion", "colliders", "hash", "lootPoints")), {"host": hw, "guest": gw, "loadS": round(time.time() - t0)})
    v.check("full: genVersion on the built map equals the maps.js export (%d)" % N, hw and hw["genVersion"] == N, hw)
    diag(v, "full", hrec, grec)


def diag(v, case, hrec, grec):
    for rec in (hrec, grec):
        v.check("%s: %s - 0 console errors, 0 page errors, 0 failed requests" % (case, rec.name.split("/")[1]), rec.clean(), rec.problems())


def live_rows(v, rig, args):
    """live mode only: judge the mode itself. (1) every page that was served by the network got a 200 for its index from the URL it was given (a rig that
    served something else would make the whole run mean nothing); (2) the run touched no production data: nothing reached supabase.co, and the hosts other than the
    build's own origin are listed (the relay stand-in answers esm.sh; anything else is named)"""
    pages = [(r, l) for r, l in rig.recs if l]
    if not pages:
        v.note("live rows: no page was served by the network in the cases that ran (preguard pages are the committed old build): skipped")
        return
    bad = [(r.name, r.first_doc) for r, _ in pages if not r.first_doc or r.first_doc[0] != 200]
    v.check("live: every page's first document was HTTP 200 from the --base URL (%d pages)" % len(pages), not bad,
            {"badDocs": bad[:4], "docs": [(r.name, r.first_doc and r.first_doc[0]) for r, _ in pages][:8]})
    ext = sorted(set((urllib.parse.urlparse(u).netloc) for _, u in rig.external))
    prod = [u for _, u in rig.external if ".supabase.co" in u] + list(rig.blocked)
    v.check("live: nothing reached Supabase / production (the relay is the stand-in: esm.sh is answered by the rig)", not prod,
            {"supabaseRequests": prod[:4], "otherHosts": ext})
    v.info("live: hosts other than the build's own origin that any page requested", ext)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--live", action="store_true", help="shortcut for --base %s : judge the DEPLOYED build (read-only; the post-deploy check)" % C.LIVE_BASE)
    ap.add_argument("--cases", default=",".join(DEFAULT_CASES), help="comma list of %s (older-full only runs with --full)" % ",".join(ALL_CASES))
    ap.add_argument("--old-rev", default="60b854d0", help="a build WITHOUT the guard (the Wave-6 release) for the preguard cases")
    ap.add_argument("--plant", default=None, choices=["no-guard", "bare-import", "no-fallback"],
                    help="planted fault in the served net.js (negative controls, each MUST FAIL): no-guard (judgeGv never reports a mismatch), bare-import (net.js's maps.js import loses the ?v=), no-fallback (a client that notices its map fell back stays in the squad: use with --cases fallback / fallback-host / fallback-solo)")
    ap.add_argument("--shots", action="store_true", help="save a screenshot of each refusal / host lobby into _harness/_shots/squadguard/")
    ap.add_argument("--fallback-map", default="ashgrid", choices=sorted(C.MAPS), help="case fallback-full: the map the host starts (default ashgrid = Savanna; Wave 7b: isla_viva, deepwood - the guest must fall back on their towns too)")
    ap.add_argument("--full", action="store_true", help="in case `same`: no startMatch stub - both pages load the real match (minutes)")
    args = ap.parse_args()
    if args.live:
        args.base = C.LIVE_BASE
        args.disk, args.rev = False, None
    args.full_now = False

    def body(v):
        live = is_live(args)
        N = current_gv(args)
        v.data["mapGenVersion"] = N
        v.data["mode"] = "live" if live else ("rev " + args.rev if getattr(args, "rev", None) else "working copy")
        v.note("%s MAP_GEN_VERSION = %d; old build for the preguard cases = %s; plant = %s" % (
            ("LIVE build at %s" % args.base) if live else "working copy", N, args.old_rev, args.plant))
        cases = [c.strip() for c in args.cases.split(",") if c.strip()]
        for c in cases:
            if c not in ALL_CASES:
                raise C.HarnessError("unknown case %r (valid: %s)" % (c, ",".join(ALL_CASES)))
        rig = Rig(args)
        try:
            for c in cases:
                print("-- case %s" % c, flush=True)
                args.full_now = bool(args.full and c in ("same", "older-full", "fallback-full"))
                ctx = None
                try:
                    if c == "same":
                        ctx = case_same(rig, v, args, N)
                    elif c == "older":
                        ctx = case_mismatch(rig, v, args, N, "older", dict(gv=N - 1), N - 1)
                    elif c == "newer":
                        ctx = case_mismatch(rig, v, args, N, "newer", dict(gv=N + 1), N + 1, newer=True)
                    elif c == "v1":
                        ctx = case_mismatch(rig, v, args, N, "v1", dict(gv="undef"), 1)
                    elif c == "preguard-guest":
                        ctx = case_preguard_guest(rig, v, args, N)
                    elif c == "preguard-host":
                        ctx = case_preguard_host(rig, v, args, N)
                    elif c == "refuse-live":
                        ctx = case_refuse_live(rig, v, args, N)
                    elif c == "fallback":
                        ctx = case_fallback(rig, v, args, N)
                    elif c == "fallback-host":
                        ctx = case_fallback_host(rig, v, args, N)
                    elif c == "fallback-solo":
                        ctx = case_fallback_solo(rig, v, args, N)
                    elif c == "older-full":
                        ctx = case_older_full(rig, v, args, N)
                    elif c == "fallback-full":
                        ctx = case_fallback_full(rig, v, args, N)
                except C.EnvFailure as e:
                    v.cnj("%s: environment" % c, str(e))
                finally:
                    # one browser, one case at a time: close the case's pages before the next opens
                    if ctx is not None:
                        try:
                            ctx.close()
                        except Exception:
                            pass
            if live:
                live_rows(v, rig, args)
        finally:
            rig.close()

    return C.run_gate("squadguard_live", body, args)


if __name__ == "__main__":
    sys.exit(main())
