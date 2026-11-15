#!/usr/bin/env python
"""HIT PARADE - menus gate (G7, lane UI). Pattern: dyefield/_harness/menus.py (real keys, a synthetic gamepad, shots).

Walks EVERY non-bout screen with REAL key presses (Playwright keyboard -> trusted KeyboardEvents) and asserts the screen
flow from the menus' read-back after each step, then repeats the entry of the menus with a synthetic Standard-mapping
gamepad (navigator.getGamepads replaced in the page) to prove A / B / d-pad navigation. Screenshots of every screen at
1600x900 and at 844x390 (the phone pass runs with ?touch=1: the touch variants) go to _shots/ui_<step>_<size>.png.
Report: _harness/_reports/menus.json. Exit 0 = every step PASS, 1 = a step failed, 2 = harness error.

Targets
  --lab (default)  runtime/lab/ui.html on the UI lane's dev server (port 5324, started here with HP_FROZEN=1 when it is
                   not already running, stopped at the end). The lab mounts the real Hud / Menus / TouchControls and
                   emulates game.ts's flow (ladder, cards, VS, a scripted bout, results, pause, ending).
  --game           CHANGED(UI) P2: the integrated game (runtime/index.html on the same :5324 server, ?dev=1). Read-back from
                   window.__HP__ (menus()/hud()/state()); real keys through title -> main -> SEASON / VERSUS setup rows
                   (D14) -> character select -> stage -> a REAL bout vs CPU -> pause -> MOVE LIST (unique card, both
                   notations) -> FORFEIT -> results -> TRAINING bout -> TRAINING OPTIONS -> EXIT -> ONLINE -> CREDITS,
                   zero flow violations; then the synthetic-pad pass. Report: _reports/menus_game.json.

CHANGED(UI3D) (CONTRACT §35.2, the 3D ring): SETTINGS shows STEP IN / STEP OUT (Q / E, pad RS-UP / RS-DOWN) and remaps them
by real keys; the pad pass captures RIGHT-STICK directions into pad slots (TAUNT <- RS-LEFT, STEP IN <- RS-DOWN = a SWAP
with STEP OUT); HOW TO PLAY (main menu guide card) opens by keys and lists the ring rows with the player's keys; --game also
holds Q in a real bout (P1 circle-walks) and finds the SIDESTEPS / CIRCLES dummy options.

CHANGED(ui) (CONTRACT §36.2 / §36.3, the EASY controls): --port N (the dev server, default 5324). Lab + game walks check the
CONTROLS BAR in a bout (__HP__.hud().controls: shown, the fighter's own special names on SPECIAL 1-4, its top edge inside the
bottom 7 % feet band), F1 and the "?" chip toggle it (settings.controlsBar), the pause card's CONTROLS keyboard map (lit keys,
the fighter's special names), SETTINGS > CONTROLS (scheme picker EASY / SIMPLE / CLASSIC, the drawn keyboard follows a remap,
--game: the bar follows a remap of SPECIAL 1 after RESUME), CHARACTER SELECT's MOVES panel + three schemes, the move list's
EASY / SIMPLE / CLASSIC tabs with key caps, the new one-page HOW TO PLAY (keyboard map + tips; touch: the PAD cheat sheet),
TRAINING keeping the bar on with the setting off.
Run:  python _harness/menus.py [--sizes 1600x900,844x390] [--no-pad] [--headed] [--base URL] [--port 5351]
Also: python _harness/menus.py --sync-strings   mirror data/fighters/*.json move `name`s into data/strings.json as
      move.<fighter>.<moveId> (CONTRACT 20.1) and the unique `trait` as trait.<fighter>; prints what changed.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SHOTS = os.path.join(ROOT, "_shots")
REPORTS = os.path.join(HERE, "_reports")
LAB_PORT = 5324
LAB_PATH = "lab/ui.html"

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
    except Exception:
        pass


class HarnessError(RuntimeError):
    pass


# ─────────────────────────── server + browser helpers (shared by layoutcheck.py / mobile.py) ───────────────────────────
def port_up(port: int) -> bool:
    try:
        with urllib.request.urlopen(f"http://localhost:{port}/{LAB_PATH}", timeout=2) as r:
            return r.status == 200
    except Exception:
        return False


class LabServer:
    """start `HP_FROZEN=1 npx vite --port 5324 --strictPort` from the game root unless it already answers"""

    def __init__(self, port: int = LAB_PORT):
        self.port = port
        self.proc: subprocess.Popen | None = None

    def __enter__(self) -> "LabServer":
        if port_up(self.port):
            print(f"[server] reusing http://localhost:{self.port}/")
            return self
        env = dict(os.environ, HP_FROZEN="1", PYTHONIOENCODING="utf-8", FORCE_COLOR="0")
        log = open(os.path.join(REPORTS, f"vite_{self.port}.log"), "w", encoding="utf-8")
        cmd = f"npx vite --port {self.port} --strictPort"
        self.proc = subprocess.Popen(cmd, cwd=ROOT, env=env, shell=True, stdout=log, stderr=subprocess.STDOUT)
        t0 = time.time()
        while time.time() - t0 < 60:
            if port_up(self.port):
                print(f"[server] vite up on :{self.port} ({time.time() - t0:.1f}s)")
                return self
            if self.proc.poll() is not None:
                raise HarnessError(f"vite exited early (rc={self.proc.returncode}); see _harness/_reports/vite_{self.port}.log")
            time.sleep(0.5)
        raise HarnessError("vite did not come up in 60 s")

    def __exit__(self, *exc) -> None:
        if not self.proc:
            return
        # npx spawns node as a child: kill the whole tree (Windows) or the group
        try:
            if os.name == "nt":
                subprocess.run(["taskkill", "/PID", str(self.proc.pid), "/T", "/F"], capture_output=True)
            else:
                self.proc.terminate()
        except Exception:
            pass
        # a node child can outlive the shell on Windows: free the port by owner pid
        if os.name == "nt":
            try:
                out = subprocess.run(["netstat", "-ano"], capture_output=True, text=True).stdout
                for line in out.splitlines():
                    if f":{self.port} " in line and "LISTENING" in line:
                        subprocess.run(["taskkill", "/PID", line.split()[-1], "/T", "/F"], capture_output=True)
            except Exception:
                pass
        print(f"[server] stopped :{self.port}")


def lab_url(base: str | None, query: str = "") -> str:
    b = base or f"http://localhost:{LAB_PORT}/{LAB_PATH}"
    if not query:
        return b
    return b + ("&" if "?" in b else "?") + query.lstrip("?")


READ_MENUS = "(() => { const L = window.__UILAB__; if (L) return L.menus(); const H = window.__HP__; if (H && typeof H.menus === 'function') return H.menus(); if (H && H.state) { const s = H.state(); return s.menus || null; } return null; })()"
READ_HUD = "(() => { const L = window.__UILAB__; if (L) return L.hud(); const H = window.__HP__; return H && typeof H.hud === 'function' ? H.hud() : null; })()"
READ_TOUCH = "(() => { const L = window.__UILAB__; if (L) return L.touch(); const H = window.__HP__; return H && typeof H.touch === 'function' ? H.touch() : null; })()"

INIT_JS = r"""
(() => {
  window.__hpErrors = [];
  addEventListener('error', (e) => window.__hpErrors.push('error: ' + (e.message || e.type)));
  addEventListener('unhandledrejection', (e) => window.__hpErrors.push('rejection: ' + (e.reason && e.reason.message || e.reason)));
  // the synthetic gamepad: harness code sets window.__pad.buttons[i] / axes, the page reads navigator.getGamepads()
  window.__pad = { connected: false, buttons: new Array(17).fill(0), axes: [0, 0, 0, 0] };
  const real = navigator.getGamepads ? navigator.getGamepads.bind(navigator) : () => [];
  navigator.getGamepads = () => {
    const p = window.__pad;
    if (!p.connected) return real();
    return [{ id: 'HP harness pad (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', timestamp: performance.now(),
      axes: p.axes.slice(), buttons: p.buttons.map((v) => ({ pressed: v > 0.5, touched: v > 0, value: v })) }];
  };
})();
"""


def wait_ready(page, timeout: float = 25.0) -> None:
    page.wait_for_function("(window.__UILAB__ && window.__UILAB__.ready) || (window.__HP__ && window.__HP__.version)", timeout=int(timeout * 1000))


def shot(page, name: str) -> str:
    os.makedirs(SHOTS, exist_ok=True)
    path = os.path.join(SHOTS, f"{name}.png")
    page.screenshot(path=path)
    return path


def save_report(name: str, data: dict) -> str:
    os.makedirs(REPORTS, exist_ok=True)
    path = os.path.join(REPORTS, f"{name}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    return path


# ─────────────────────────── the walk ───────────────────────────
class Walk:
    def __init__(self, page, size: str, results: list):
        self.page = page
        self.size = size
        self.results = results
        self.shots: list[str] = []

    def m(self) -> dict:
        return self.page.evaluate(READ_MENUS) or {}

    def key(self, k: str, times: int = 1, gap: float = 0.09) -> None:
        for _ in range(times):
            self.page.keyboard.press(k)
            time.sleep(gap)

    def wait_screen(self, want: str, timeout: float = 6.0) -> bool:
        t0 = time.time()
        while time.time() - t0 < timeout:
            s = self.m()
            if s.get("screen") == want and s.get("visible"):
                return True
            time.sleep(0.08)
        return False

    def focus_to(self, target_id: str, key: str = "ArrowDown", limit: int = 12) -> bool:
        """spatial keys first (what a player does); Tab cycling (the menus keep Tab inside the screen) as the fallback"""
        for _ in range(limit):
            if self.m().get("focus") == target_id:
                return True
            self.key(key)
        # CHANGED(ui): SETTINGS holds ~100 controls now (24 actions x 3 slots): the Tab ring needs more than 90 presses
        for _ in range(160):
            if self.m().get("focus") == target_id:
                return True
            self.key("Tab", gap=0.04)
        return self.m().get("focus") == target_id

    def check(self, step: str, ok: bool, detail: str = "", snap: bool = True) -> bool:
        path = ""
        if snap:
            time.sleep(0.35)
            path = shot(self.page, f"ui_{step}_{self.size}")
            self.shots.append(path)
        st = self.m()
        self.results.append({"size": self.size, "step": step, "ok": bool(ok), "screen": st.get("screen"), "focus": st.get("focus"), "detail": detail, "shot": os.path.relpath(path, ROOT).replace("\\", "/") if path else ""})
        print(f"  [{'PASS' if ok else 'FAIL'}] {self.size} {step:<22} screen={st.get('screen')} focus={st.get('focus')} {detail}")
        return ok


def walk_lab(page, size: str, results: list) -> None:
    w = Walk(page, size, results)
    # title -> main
    w.check("title", w.wait_screen("title"))
    w.key("Enter")
    w.check("main", w.wait_screen("main") and w.m().get("focus") == "hpm-main-season")
    # SEASON: setup -> select (P1: fighter, colour, controls) -> ladder -> VS -> bout -> results -> ... -> ending -> name
    w.key("Enter")
    w.check("season", w.wait_screen("season"))
    w.check("season_go", w.focus_to("hpm-season-go"), snap=False)
    w.key("Enter")
    w.check("charselect_season", w.wait_screen("charselect"))
    w.key("ArrowRight")
    w.check("charselect_move", w.m().get("cs", {}).get("p", [{}])[0].get("cursor") not in (None, "random"), f"cursor={w.m().get('cs', {}).get('p', [{}])[0].get('cursor')}")
    w.key("Enter")
    w.check("charselect_color", w.m().get("cs", {}).get("p", [{}])[0].get("step") == "color")
    w.key("ArrowRight")
    w.key("Enter")
    w.check("charselect_scheme", w.m().get("cs", {}).get("p", [{}])[0].get("step") == "scheme")
    # CHANGED(ui): three schemes (EASY first) + the MOVES panel (keys or rows) for the picked fighter
    cs = page.evaluate("""(() => { const b = [...document.querySelectorAll('#hp-menus .hpm-cs-side.p1 .hpm-cs-scheme .hpm-segbtn')].map((e) => e.id);
      const mv = document.getElementById('hpm-cs-moves-p1');
      return { schemes: b, moves: !!mv && !mv.hidden, keys: mv ? mv.querySelectorAll('.hpk-key.on, .hpk-row').length : 0, plan: mv && mv.querySelector('.plan') ? mv.querySelector('.plan').textContent : '' }; })()""")
    w.check("charselect_moves_panel", cs.get("schemes") == ["hpm-cs-scheme-p1-2", "hpm-cs-scheme-p1-0", "hpm-cs-scheme-p1-1"] and cs.get("moves") and cs.get("keys", 0) >= 6 and len(cs.get("plan") or "") >= 30,
            f"schemes={cs.get('schemes')} keys/rows={cs.get('keys')} plan={(cs.get('plan') or '')[:40]!r}", snap=False)
    w.key("Enter")
    w.check("ladder", w.wait_screen("ladder", 8))
    w.key("Enter")
    w.check("vs", w.wait_screen("vs", 6))
    time.sleep(2.9)                                           # VS auto-advances; the scripted bout runs 45 frames
    w.check("results_arcade", w.wait_screen("results", 8))
    w.key("Enter")                                            # NEXT EPISODE
    w.check("ladder_2", w.wait_screen("ladder", 8), snap=False)
    w.key("Enter")
    w.check("card_rival", w.wait_screen("card", 6))
    time.sleep(0.3)
    w.key("Enter")
    w.check("vs_rival", w.wait_screen("vs", 6), snap=False)
    time.sleep(2.9)
    w.check("results_2", w.wait_screen("results", 8), snap=False)
    w.key("Enter")
    w.check("ladder_3", w.wait_screen("ladder", 8), snap=False)
    w.key("Enter")
    w.check("card_boss", w.wait_screen("card", 6))
    time.sleep(0.3)
    w.key("Enter")
    time.sleep(0.6)
    w.check("vs_boss", w.wait_screen("vs", 6))
    time.sleep(2.5)
    w.check("results_boss", w.wait_screen("results", 8), snap=False)
    w.key("Enter")
    # CHANGED(UI) P2: game.ts order - name entry (the board rank), then the ending SEQUENCE (one card per press)
    w.check("nameentry", w.wait_screen("nameentry", 6))
    for k in ("KeyA", "KeyC", "KeyE"):
        w.key(k)
    w.key("Enter")
    w.check("ending", w.wait_screen("ending", 6))
    cards = []
    for _ in range(9):
        time.sleep(0.55)
        st = w.m()
        if st.get("screen") != "ending":
            break
        cards.append(st.get("ending"))
        w.key("Enter")
    w.check("ending_sequence", len(cards) >= 4 and cards[0] == "finale" and "ratings" in cards and "board" in cards, f"cards={cards}", snap=False)
    w.check("title_after_season", w.wait_screen("title", 6), snap=False)

    # VERSUS vs CPU: setup -> select P1 + CPU -> stage -> VS -> bout -> results
    w.key("Enter")
    w.wait_screen("main")
    w.focus_to("hpm-main-versus")
    w.key("Enter")
    w.check("versus", w.wait_screen("versus"))
    # CHANGED(UI) P2 (verifier D14): one row per setting - DOWN from OPPONENT lands on CPU LEVEL, then ROUNDS, TIMER, GO
    seq = []
    for _ in range(4):
        w.key("ArrowDown")
        seq.append(w.m().get("focus"))
    w.check("versus_rows_d14", seq == ["hpm-versus-cpuLevel-3", "hpm-versus-rounds-2", "hpm-versus-timer-99", "hpm-versus-go"], f"down x4 -> {seq}", snap=False)
    w.check("versus_go", w.focus_to("hpm-versus-go"), snap=False)
    w.key("Enter")
    w.check("charselect_versus", w.wait_screen("charselect"), snap=False)
    w.key("Enter", 3)                                         # P1: fighter, colour, controls
    w.check("charselect_cpu", w.m().get("cs", {}).get("active") == 1, f"active={w.m().get('cs', {}).get('active')}")
    w.key("ArrowRight", 2)
    w.key("Enter")
    w.key("Enter")                                            # CPU colour -> both ready
    w.check("stage", w.wait_screen("stage", 6))
    w.key("Enter")
    w.check("vs_versus", w.wait_screen("vs", 6), snap=False)
    time.sleep(3.0)
    w.check("hud_versus", w.page.evaluate(READ_HUD).get("mounted") is True, "scripted bout HUD")
    cb = (w.page.evaluate(READ_HUD) or {}).get("controls") or {}
    touch_mode = page.evaluate("document.documentElement.classList.contains('hp-touch')")
    w.check("hud_controls_bar", (cb.get("shown") is (not touch_mode)) and (touch_mode or len(((cb.get("sides") or [{}])[0]).get("cells") or []) >= 12),
            f"shown={cb.get('shown')} level={cb.get('level')} fits={cb.get('fits')} rect={cb.get('rect')}", snap=False)
    w.check("results_versus", w.wait_screen("results", 8))
    w.key("Enter")                                            # REMATCH (the lab returns to the main menu)
    w.wait_screen("main")

    # TRAINING: select P1 + dummy -> bout -> ESC pause -> TRAINING OPTIONS / MOVE LIST / SETTINGS -> EXIT
    w.focus_to("hpm-main-training")
    w.key("Enter")
    w.check("charselect_training", w.wait_screen("charselect"), snap=False)
    w.key("Enter", 3)
    w.key("Enter", 2)
    time.sleep(1.0)
    hud = w.page.evaluate(READ_HUD)
    w.check("hud_training", bool(hud and hud.get("mounted")), f"timer={hud.get('timer') if hud else None}")
    w.key("Escape")
    w.check("pause_training", w.wait_screen("pause"))
    pk = page.evaluate("(() => { const b = document.querySelector('#hp-menus .hpm-s-pause .hpm-legend'); return b ? [b.querySelectorAll('.hpk-key.on').length, b.querySelectorAll('.hpk-trow').length] : null; })()")
    touch_mode = page.evaluate("document.documentElement.classList.contains('hp-touch')")
    w.check("pause_controls_map", bool(pk) and (pk[1] >= 9 if touch_mode else pk[0] >= 18), f"lit keys / touch rows = {pk}", snap=False)
    w.check("pause_to_training", w.focus_to("hpm-p-training"), snap=False)
    w.key("Enter")
    w.check("training", w.wait_screen("training"))
    w.key("Escape")
    w.check("pause_back", w.wait_screen("pause") and w.m().get("focus") == "hpm-p-training", snap=False)
    w.focus_to("hpm-p-movelist", "ArrowUp")
    w.key("Enter")
    w.check("movelist", w.wait_screen("movelist"))
    # CHANGED(ui): tabs EASY / SIMPLE / CLASSIC - the focused first tab (EASY), then right twice -> CLASSIC
    w.key("Enter")
    easy = page.evaluate("(() => { const r = document.querySelector('#hp-menus .hpm-movelist'); return r ? [r.dataset.scheme, r.querySelectorAll('.hpm-ml-row .in .hpk-cap, .hpm-ml-row .in .hp-chip').length] : null; })()")
    w.check("movelist_easy", bool(easy) and easy[0] == "2" and easy[1] >= 6, f"scheme/key caps={easy}")
    w.key("ArrowRight", 2)
    w.key("Enter")
    w.check("movelist_classic", w.m().get("focus") == "hpm-ml-classic")
    w.key("Escape")
    w.check("pause_from_movelist", w.wait_screen("pause"), snap=False)
    w.focus_to("hpm-p-settings")
    w.key("Enter")
    w.check("settings", w.wait_screen("settings"))
    # CHANGED(UI3D): the STEP rows (keys Q / E, pad RS-UP / RS-DOWN) before any remap
    lbl = page.evaluate("['hpm-key-stepIn-0','hpm-key-stepOut-0','hpm-key-stepIn-pad','hpm-key-stepOut-pad'].map((id) => { const e = document.getElementById(id); return e ? e.textContent.trim() : null; })")
    w.check("settings_step_rows", lbl == ["Q", "E", "RS-UP", "RS-DOWN"], f"STEP IN / OUT key, pad = {lbl}", snap=False)
    # CHANGED(ui): the scheme picker (EASY on), the EASY rows (BLOCK, SPECIAL 1-4, SUPER, PRIME TIME, CONTROLS BAR) and the map
    st = page.evaluate("""(() => { const on = [...document.querySelectorAll('#hp-menus .hpm-keys .hpm-schemes .hpm-segbtn.on')].map((e) => e.id);
      const rows = ['blockHold', 'sp1', 'sp2', 'sp3', 'sp4', 'super1', 'super3', 'controls'].map((a) => (document.getElementById('hpm-key-' + a + '-0') || {}).textContent || null);
      const map = document.querySelectorAll('#hpm-set-keymap .hpk-key.on').length; return { on, rows, map }; })()""")
    touch_mode = page.evaluate("document.documentElement.classList.contains('hp-touch')")
    w.check("settings_easy_rows", st.get("on") == ["hpm-set-scheme-2"] and st.get("rows") == ["SHIFT", "U", "I", "O", "P", "H", "Y", "F1"] and (touch_mode or st.get("map", 0) >= 18),
            f"scheme={st.get('on')} rows={st.get('rows')} lit map keys={st.get('map')}", snap=False)
    # key remap: P1 LIGHT key slot -> capture -> Z (CHANGED(UI3D): Q is STEP IN now); then a conflict (W onto MEDIUM) -> SWAP
    # prompt -> cancel
    w.check("remap_focus", w.focus_to("hpm-key-l-0"), snap=False)
    w.key("Enter")
    w.check("remap_capture", (w.m().get("capture") or "").startswith("0:l:"), f"capture={w.m().get('capture')}")
    w.key("KeyZ")
    time.sleep(0.2)
    w.check("remap_assigned", "Z" in (w.m().get("note") or ""), f"note={w.m().get('note')}")
    # CHANGED(ui): the drawn keyboard follows the remap - Z is lit as PUNCH, J is dark
    if not page.evaluate("document.documentElement.classList.contains('hp-touch')"):
        mz = page.evaluate("""(() => { const k = (c) => document.querySelector('#hpm-set-keymap .hpk-key[data-code="' + c + '"]');
          const z = k('KeyZ'), j = k('KeyJ'); return [z ? z.className + '|' + z.textContent : null, j ? j.className : null]; })()""")
        w.check("remap_map_follows", bool(mz[0]) and "on" in mz[0] and "PUNCH" in mz[0] and (mz[1] is None or " on" not in mz[1]), f"Z={mz[0]} J={mz[1]}", snap=True)
    # CHANGED(UI3D): remap STEP IN's key: X
    w.check("remap_step_focus", w.focus_to("hpm-key-stepIn-0", "ArrowUp"), snap=False)
    w.key("Enter")
    w.key("KeyX")
    time.sleep(0.2)
    got = page.evaluate("(document.getElementById('hpm-key-stepIn-0') || {}).textContent")
    w.check("remap_step_in", "X" in (w.m().get("note") or "") and (got or "").strip() == "X", f"note={w.m().get('note')} slot={got!r}")
    w.focus_to("hpm-key-m-0")
    w.key("Enter")
    w.key("KeyW")                                             # W is P1's UP -> conflict
    time.sleep(0.2)
    w.check("remap_conflict", bool(w.m().get("conflict")), f"note={w.m().get('note')}")
    w.key("Escape")
    w.check("remap_cancel", not w.m().get("conflict"), snap=False)
    w.key("Escape")
    w.check("pause_from_settings", w.wait_screen("pause"), snap=False)
    w.focus_to("hpm-p-forfeit")
    w.key("Enter")                                            # training: EXIT TRAINING (no confirm)
    w.check("main_after_training", w.wait_screen("main"), snap=False)

    # VERSUS bout -> pause -> FORFEIT confirm (non-training) -> yes
    w.focus_to("hpm-main-versus")
    w.key("Enter")
    w.wait_screen("versus")
    w.focus_to("hpm-versus-go")
    w.key("Enter")
    w.wait_screen("charselect")
    w.key("Enter", 3)
    w.key("Enter", 2)
    w.wait_screen("stage")
    w.key("Enter")
    time.sleep(3.0)
    w.key("Escape")
    w.check("pause", w.wait_screen("pause"))
    w.focus_to("hpm-p-forfeit")
    w.key("Enter")
    w.check("confirm_forfeit", bool(w.m().get("confirm")))
    w.key("ArrowRight")
    w.key("Enter")
    w.check("main_after_forfeit", w.wait_screen("main", 4), snap=False)

    # ONLINE: lobby -> QUICK MATCH -> the status line follows the (emulated) net codes
    w.focus_to("hpm-main-online")
    w.key("Enter")
    w.check("online", w.wait_screen("online"))
    w.key("Enter")                                            # QUICK MATCH (default focus)
    time.sleep(2.2)
    txt = w.page.evaluate("document.getElementById('hpm-on-status') ? document.getElementById('hpm-on-status').textContent : ''")
    w.check("online_status", "PING" in (txt or "").upper(), f"status={txt!r}")
    w.key("Escape")
    w.wait_screen("main")
    # CREDITS + back to title
    w.focus_to("hpm-main-credits")
    w.key("Enter")
    w.check("credits", w.wait_screen("credits"))
    w.key("Escape")
    w.check("main_back", w.wait_screen("main"), snap=False)
    # CHANGED(UI3D): HOW TO PLAY from the main menu's guide card (right of the stack)
    walk_howto(w, "")
    w.key("Escape")
    w.check("title_back", w.wait_screen("title"), snap=False)


def walk_howto(w: "Walk", prefix: str) -> None:
    """CHANGED(UI3D): main -> HOW TO PLAY by keys (the guide card's button) -> the 4 blocks, THE RING rows with the player's
    STEP keys -> Esc back to main with the focus on the button"""
    page = w.page
    w.check(f"{prefix}howto_focus", w.focus_to("hpm-main-howto", "ArrowRight", 3), snap=False)
    w.key("Enter")
    # CHANGED(ui) (CONTRACT §36.3): one page around EASY - the drawn keyboard (P1's keys, plain words) + tips with key caps
    # (the ring in two lines); touch: the PAD cheat sheet + the ring line
    time.sleep(0.3)
    info = page.evaluate("""(() => { const b = document.querySelector('#hp-menus .hpm-s-howto .hpm-how2'); if (!b) return null;
      const secs = [...b.querySelectorAll('[data-sec]')].map((e) => e.dataset.sec);
      const ring = b.querySelector('.tip.ring');
      const lit = [...b.querySelectorAll('.hpk-key.on')].map((k) => k.dataset.code + '=' + (k.querySelector('.w') || {}).textContent);
      return { secs, lit, touchRows: b.querySelectorAll('.hpk-trow').length, ringText: ring ? ring.textContent : '',
        ringKeys: ring ? [...ring.querySelectorAll('kbd')].map((k) => k.textContent.trim()) : [] }; })()""") or {}
    touch = page.evaluate("document.documentElement.classList.contains('hp-touch')")
    lit = info.get("lit") or []
    if touch:
        ok = w.wait_screen("howto") and info.get("secs") == ["map", "ring"] and info.get("touchRows", 0) >= 9 and "sidestep" in info.get("ringText", "")
    else:
        ok = (w.wait_screen("howto") and info.get("secs") == ["map", "move", "ring", "attack", "special", "super", "defend", "fight"] + (["pad"] if "pad" in (info.get("secs") or []) else [])
              and len(lit) >= 20 and all(any(x.endswith("=" + wd) for x in lit) for wd in ("BLOCK", "PUNCH", "KICK", "HEAVY", "SPECIAL 1", "SPECIAL 4", "SUPER", "STEP IN", "STEP OUT"))
              and "sidestep" in info.get("ringText", "") and "circle" in info.get("ringText", "") and len(info.get("ringKeys") or []) == 2)
    w.check(f"{prefix}howto", ok, f"secs={info.get('secs')} lit={len(lit)} {lit[:6]} touch rows={info.get('touchRows')} ring keys={info.get('ringKeys')}")
    w.key("Escape")
    w.check(f"{prefix}howto_back", w.wait_screen("main") and w.m().get("focus") == "hpm-main-howto", snap=False)


def walk_game(page, size: str, results: list) -> None:
    """CHANGED(UI) P2: the INTEGRATED game (index.html, real menus + real bouts) walked by real keys."""
    w = Walk(page, size, results)
    step = lambda n: f"game_{n}"  # noqa: E731
    w.check(step("title"), w.wait_screen("title", 30))
    w.key("Enter")
    w.check(step("main"), w.wait_screen("main") and w.m().get("focus") == "hpm-main-season")
    # SEASON setup: rows (D14)
    w.key("Enter")
    w.check(step("season"), w.wait_screen("season"))
    seq = []
    for _ in range(2):
        w.key("ArrowDown")
        seq.append(w.m().get("focus"))
    w.check(step("season_rows"), seq == ["hpm-season-diff-1", "hpm-season-go"], f"down x2 -> {seq}", snap=False)
    w.key("Escape")
    w.wait_screen("main")
    # VERSUS setup rows (D14), CPU level 1, then a REAL bout
    w.focus_to("hpm-main-versus")
    w.key("Enter")
    w.check(step("versus"), w.wait_screen("versus"))
    seq = []
    for _ in range(4):
        w.key("ArrowDown")
        seq.append(w.m().get("focus"))
    w.check(step("versus_rows_d14"), seq == ["hpm-versus-cpuLevel-3", "hpm-versus-rounds-2", "hpm-versus-timer-99", "hpm-versus-go"], f"down x4 -> {seq}", snap=False)
    w.key("ArrowUp", 3)
    w.key("ArrowLeft", 2)
    w.key("Enter")
    lvl = w.m().get("flow", {}).get("cpuLevel")
    w.focus_to("hpm-versus-go")
    w.key("Enter")
    w.check(step("charselect_versus"), w.wait_screen("charselect"), f"cpu level {lvl}")
    # CHANGED(ui): the MOVES panel of the highlighted fighter (johnny, the first slot): plan + his special names on the keys
    mv = page.evaluate("""(() => { const m = document.getElementById('hpm-cs-moves-p1'); if (!m) return null;
      return { fighter: m.dataset.fighter, text: m.textContent, keys: [...m.querySelectorAll('.hpk-key.on')].map((k) => k.dataset.code), rows: m.querySelectorAll('.hpk-row').length }; })()""") or {}
    touch_mode = page.evaluate("document.documentElement.classList.contains('hp-touch')")
    want_names = ["BRICKBAT", "HOOK", "ENCORE", "WEAVE"]
    w.check(step("charselect_moves"), mv.get("fighter") == "johnny" and all(n in (mv.get("text") or "").upper() for n in want_names)
            and (mv.get("rows", 0) >= 6 if touch_mode else all(c in (mv.get("keys") or []) for c in ["KeyU", "KeyI", "KeyO", "KeyP", "KeyH", "KeyY", "KeyJ"])),
            f"fighter={mv.get('fighter')} keys={mv.get('keys')} rows={mv.get('rows')}")
    w.key("Enter", 3, 0.25)
    w.key("ArrowRight", 2)
    w.key("Enter", 2, 0.25)
    w.check(step("stage"), w.wait_screen("stage", 8))
    time.sleep(0.6)
    w.key("Enter")
    t0 = time.time()
    while time.time() - t0 < 60 and (page.evaluate("window.__HP__.state().phase") != "bout"):
        time.sleep(0.2)
    time.sleep(2.5)
    hud = page.evaluate(READ_HUD) or {}
    w.check(step("bout_hud"), bool(hud.get("mounted")), f"timer={hud.get('timer')}")
    walk_game_bar(page, w, step)
    # CHANGED(UI3D): a real Q hold in the bout = STEP IN: P1 circle-walks (the sim's sidewalk state, z leaves the line)
    if not page.evaluate("document.documentElement.classList.contains('hp-touch')"):
        rd = "(() => { const f = __HP__.fighters()[0]; return [f.stateName, f.z]; })()"
        z0 = page.evaluate(rd)[1]
        page.keyboard.down("KeyQ")
        seen = set()
        for _ in range(10):
            time.sleep(0.1)
            seen.add(page.evaluate(rd)[0])
        z1 = page.evaluate(rd)[1]
        page.keyboard.up("KeyQ")
        w.check(step("bout_step_q"), "sidewalk" in seen and abs(z1 - z0) > 0.3, f"states={sorted(seen)} P1 z {z0:.2f} -> {z1:.2f}")
        time.sleep(0.4)
    w.key("Escape")
    w.check(step("pause"), w.wait_screen("pause"))
    pm = page.evaluate("""(() => { const b = document.querySelector('#hp-menus .hpm-s-pause .hpm-legend'); if (!b) return null;
      const k = (c) => { const e = b.querySelector('.hpk-key[data-code="' + c + '"] .w'); return e ? e.textContent : null; };
      return { lit: b.querySelectorAll('.hpk-key.on').length, U: k('KeyU'), H: k('KeyH'), SHIFT: k('ShiftLeft'), rows: b.querySelectorAll('.hpk-trow').length }; })()""") or {}
    if page.evaluate("document.documentElement.classList.contains('hp-touch')"):
        w.check(step("pause_controls"), pm.get("rows", 0) >= 9, f"touch cheat sheet rows={pm.get('rows')}", snap=False)
    else:
        w.check(step("pause_controls"), pm.get("lit", 0) >= 18 and pm.get("U") == "BRICKBAT" and pm.get("H") == "SUPER" and pm.get("SHIFT") == "BLOCK",
                f"lit={pm.get('lit')} U={pm.get('U')} H={pm.get('H')} SHIFT={pm.get('SHIFT')}", snap=False)
        walk_game_remap(page, w, step)
    w.focus_to("hpm-p-movelist", "ArrowDown")
    w.key("Enter")
    ok = w.wait_screen("movelist") and page.evaluate("!!document.querySelector('#hp-menus .hpm-ml-unique') && !!document.querySelector('#hp-menus .hpm-ml-row .alt')")
    w.check(step("movelist"), ok, "unique card + both notations")
    w.key("Escape")
    w.check(step("pause_back"), w.wait_screen("pause"), snap=False)
    w.focus_to("hpm-p-forfeit")
    w.key("Enter")
    w.check(step("confirm_forfeit"), bool(w.m().get("confirm")), snap=False)
    w.key("ArrowRight")
    w.key("Enter")
    w.check(step("results_forfeit"), w.wait_screen("results", 12))
    w.focus_to("hpm-res-menu", "ArrowRight")
    w.key("Enter")
    w.check(step("main_after_results"), w.wait_screen("main", 12), snap=False)
    # TRAINING: select P1 + the dummy -> a real training bout -> TRAINING OPTIONS (P2 rows) -> EXIT
    w.focus_to("hpm-main-training")
    w.key("Enter")
    w.check(step("charselect_training"), w.wait_screen("charselect"), snap=False)
    w.key("Enter", 3, 0.25)
    w.key("Enter", 2, 0.25)
    t0 = time.time()
    while time.time() - t0 < 60 and (page.evaluate("window.__HP__.state().phase") != "bout"):
        time.sleep(0.2)
    time.sleep(1.5)
    has = page.evaluate("!!document.querySelector('#hp-hud .hp-inputs') && !!document.querySelector('#hp-hud .hp-frames')")
    w.check(step("training_hud"), has, "input display + frame data")
    # CHANGED(ui) (CONTRACT §36.2): TRAINING always shows the bar - even with settings.controlsBar off (set by the bar walk)
    if not page.evaluate("document.documentElement.classList.contains('hp-touch')"):
        cb = (page.evaluate(READ_HUD) or {}).get("controls") or {}
        sb = page.evaluate("(() => { try { return __HP__.input().controlsBar; } catch (e) { return null; } })()")
        w.check(step("training_bar_always"), cb.get("on") is True and cb.get("training") is True, f"bar on={cb.get('on')} training={cb.get('training')} setting={sb}")
        # CHANGED(wf8 fix) FT-10: F1 hides / shows the bar in TRAINING too (session only - the saved setting stays as it was)
        w.key("F1")
        time.sleep(0.3)
        off = (page.evaluate(READ_HUD) or {}).get("controls") or {}
        w.key("F1")
        time.sleep(0.3)
        on = (page.evaluate(READ_HUD) or {}).get("controls") or {}
        sb2 = page.evaluate("(() => { try { return __HP__.input().controlsBar; } catch (e) { return null; } })()")
        w.check(step("training_bar_f1"), off.get("on") is False and on.get("on") is True and sb2 == sb, f"F1 -> on={off.get('on')}, F1 -> on={on.get('on')}, setting {sb} -> {sb2}")
        page.evaluate("(() => { try { __HP__.input(); } catch (e) {} })()")
    w.key("Escape")
    w.wait_screen("pause")
    w.focus_to("hpm-p-training")
    w.key("Enter")
    rows = page.evaluate("['hpm-tr-guard-random','hpm-tr-reset-mid','hpm-tr-reset-corner','hpm-tr-reset-cornered','hpm-tr-record-record','hpm-tr-hitboxes','hpm-tr-dummy-sidesteps','hpm-tr-dummy-circles'].every((id) => !!document.getElementById(id))")
    w.check(step("training_options"), w.wait_screen("training") and rows, "guard RANDOM, RESET x3, RECORD, HITBOXES, DUMMY SIDESTEPS / CIRCLES")
    w.key("Escape")
    w.wait_screen("pause")
    w.focus_to("hpm-p-forfeit")
    w.key("Enter")
    w.check(step("main_after_training"), w.wait_screen("main", 12), snap=False)
    # ONLINE lobby (no network action) + CREDITS
    w.focus_to("hpm-main-online")
    w.key("Enter")
    w.check(step("online"), w.wait_screen("online"))
    w.key("Escape")
    w.wait_screen("main")
    w.focus_to("hpm-main-credits")
    w.key("Enter")
    w.check(step("credits"), w.wait_screen("credits"), snap=False)
    w.key("Escape")
    w.wait_screen("main")
    walk_howto(w, "game_")
    w.key("Escape")
    w.check(step("title_back"), w.wait_screen("title"), snap=False)
    viol = page.evaluate("window.__HP__.state().flowViolations")
    w.check(step("flow_violations"), viol == 0, f"violations={viol}", snap=False)


def bar_state(page) -> dict:
    return (page.evaluate(READ_HUD) or {}).get("controls") or {}


def walk_game_bar(page, w: "Walk", step) -> None:
    """CHANGED(ui) (CONTRACT §36.2): the CONTROLS BAR in a real bout - shown, P1's EASY keys with johnny's special names,
    HUD-safe (its top edge inside the bottom 7 % feet band, between the RATINGS blocks), F1 toggles it (and the setting), the
    "?" chip toggles it back (a real mouse click)."""
    if page.evaluate("document.documentElement.classList.contains('hp-touch')"):
        cb = bar_state(page)
        disc = page.evaluate("(() => { try { return __HP__.touch().buttons.some((b) => b.id === 'help'); } catch (e) { return null; } })()")
        w.check(step("bar_touch"), cb.get("shown") is False and disc is True, f"bar shown={cb.get('shown')} help disc={disc}")
        return
    time.sleep(0.6)
    cb = bar_state(page)
    cells = {c["id"]: c for c in ((cb.get("sides") or [{}])[0].get("cells") or [])}
    vh = page.evaluate("innerHeight")
    rect = cb.get("rect") or {}
    shows = page.evaluate("[...document.querySelectorAll('#hp-hud .hp-show')].map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), Math.round(r.top)]; })")
    words = [cells.get(k, {}).get("word") for k in ("sp1", "sp2", "sp3", "sp4")]
    caps = [((cells.get(k) or {}).get("caps") or [None])[0] for k in ("l", "m", "h", "sp1", "sp2", "sp3", "sp4", "super1", "super3", "block")]
    inside = bool(rect) and rect["y"] >= vh * 0.93 - 1 and (not shows or (rect["x"] >= shows[0][1] - 1 and rect["x"] + rect["w"] <= shows[1][0] + 1))
    w.check(step("bar_shown"), cb.get("shown") is True and cb.get("on") is True and words == ["BRICKBAT", "HOOK", "ENCORE", "WEAVE"]
            and caps == ["J", "K", "L", "U", "I", "O", "P", "H", "Y", "SHIFT"] and inside and cb.get("fits") is True,
            f"words={words} caps={caps} rect={rect} band top={vh * 0.93:.0f} ratings={shows} level={cb.get('level')} fits={cb.get('fits')}")
    w.key("F1")
    time.sleep(0.3)
    off = bar_state(page)
    setting = page.evaluate("(() => { try { return __HP__.input().controlsBar; } catch (e) { return null; } })()")
    w.check(step("bar_f1_off"), off.get("on") is False and setting is False, f"on={off.get('on')} settings.controlsBar={setting}")
    chip = page.evaluate("(() => { const b = document.getElementById('hp-cbar-toggle'); if (!b) return null; const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()")
    if chip:
        page.mouse.click(chip[0], chip[1])
        time.sleep(0.3)
    on = bar_state(page)
    setting = page.evaluate("(() => { try { return __HP__.input().controlsBar; } catch (e) { return null; } })()")
    w.check(step("bar_chip_on"), on.get("on") is True and setting is True, f"chip={chip} on={on.get('on')} settings.controlsBar={setting}")
    # leave it OFF for the training check (TRAINING shows it anyway)
    w.key("F1")
    time.sleep(0.25)
    w.check(step("bar_f1_off_again"), bar_state(page).get("on") is False, snap=False)


def walk_game_remap(page, w: "Walk", step) -> None:
    """CHANGED(ui): pause -> SETTINGS -> SPECIAL 1's key slot <- KeyZ by real keys -> back -> RESUME: the bar's SPECIAL 1 cell
    reads Z (the bar follows a remap); then RESET CONTROLS puts U back."""
    w.focus_to("hpm-p-settings", "ArrowDown")
    w.key("Enter")
    if not w.wait_screen("settings"):
        w.check(step("remap_sp1"), False, "settings did not open")
        return
    w.focus_to("hpm-key-sp1-0", "ArrowDown", 40)
    w.key("Enter")
    w.key("KeyZ")
    time.sleep(0.25)
    note = w.m().get("note")
    w.key("Escape")
    w.wait_screen("pause")
    w.focus_to("hpm-p-resume", "ArrowUp")
    w.key("Enter")
    time.sleep(0.5)
    page.keyboard.press("F1")                                # the bar was left OFF by the bar walk: show it
    time.sleep(0.4)
    cb = bar_state(page)
    cells = {c["id"]: c for c in ((cb.get("sides") or [{}])[0].get("cells") or [])}
    sp1 = cells.get("sp1", {})
    w.check(step("remap_bar_follows"), (sp1.get("caps") or [None])[0] == "Z" and sp1.get("word") == "BRICKBAT", f"note={note!r} SPECIAL 1 cell={sp1}")
    # back to the defaults (pause -> SETTINGS -> RESET CONTROLS), then F1 off again for the training check
    w.key("Escape")
    w.wait_screen("pause")
    w.focus_to("hpm-p-settings", "ArrowDown")
    w.key("Enter")
    w.wait_screen("settings")
    w.focus_to("hpm-reset-keys", "ArrowDown", 60)
    w.key("Enter")
    time.sleep(0.2)
    back = page.evaluate("(document.getElementById('hpm-key-sp1-0') || {}).textContent")
    w.check(step("remap_reset"), (back or "").strip() == "U", f"SPECIAL 1 after RESET = {back!r}", snap=False)
    w.key("Escape")
    w.wait_screen("pause")
    w.focus_to("hpm-p-resume", "ArrowUp")
    w.key("Enter")
    time.sleep(0.4)
    w.key("F1")
    time.sleep(0.3)
    w.key("Escape")
    w.wait_screen("pause")


def walk_pad(page, results: list, size: str) -> None:
    """A / B / d-pad through the synthetic Standard gamepad (the menus poll navigator.getGamepads())."""
    w = Walk(page, size, results)

    def tap(i: int) -> None:
        page.evaluate(f"window.__pad.buttons[{i}] = 1")
        time.sleep(0.12)
        page.evaluate(f"window.__pad.buttons[{i}] = 0")
        time.sleep(0.12)

    page.evaluate("window.__pad.connected = true")
    time.sleep(0.3)
    w.check("pad_title", w.wait_screen("title"), snap=False)
    tap(0)
    w.check("pad_A_main", w.wait_screen("main"), snap=False)
    tap(13)
    w.check("pad_dpad_down", w.m().get("focus") == "hpm-main-versus", f"focus={w.m().get('focus')}", snap=False)
    tap(0)
    w.check("pad_A_versus", w.wait_screen("versus"), snap=False)
    tap(1)
    w.check("pad_B_back", w.wait_screen("main"), snap=False)
    w.check("pad_hint", bool(w.m().get("gamepad")), "gamepad seen -> A / B pill", snap=True)
    # CHANGED(UI3D): the pad capture takes RIGHT-STICK directions (virtual pad slots 17..20): SETTINGS by d-pad + A, then
    # TAUNT's pad slot <- RS-LEFT (free) and STEP IN's pad slot <- RS-DOWN (= STEP OUT's: the SWAP prompt, A = SWAP)
    w.check("pad_to_settings", w.focus_to("hpm-main-settings"), snap=False)
    tap(0)
    w.check("pad_settings", w.wait_screen("settings"), snap=False)

    def stick_capture(slot_id: str, ax: int, val: float) -> None:
        w.focus_to(slot_id, "ArrowDown", 20)
        tap(0)                                                        # A on the pad slot = capture
        time.sleep(0.15)
        page.evaluate(f"window.__pad.axes[{ax}] = {val}")
        time.sleep(0.2)
        page.evaluate(f"window.__pad.axes[{ax}] = 0")
        time.sleep(0.2)

    stick_capture("hpm-key-taunt-pad", 2, -1.0)
    got = page.evaluate("(document.getElementById('hpm-key-taunt-pad') || {}).textContent")
    w.check("pad_capture_rs_left", (got or "").strip() == "RS-LEFT", f"TAUNT pad slot = {got!r} note={w.m().get('note')}", snap=False)
    stick_capture("hpm-key-stepIn-pad", 3, 1.0)
    conflict = w.m().get("conflict") or {}
    w.check("pad_capture_rs_down_conflict", conflict.get("value") == 18 and (conflict.get("other") or {}).get("action") == "stepOut", f"conflict={conflict}", snap=True)
    tap(0)                                                            # A on SWAP (focused)
    time.sleep(0.2)
    lab = page.evaluate("['hpm-key-stepIn-pad','hpm-key-stepOut-pad'].map((id) => (document.getElementById(id) || {}).textContent)")
    w.check("pad_capture_swap", [x.strip() if x else x for x in lab] == ["RS-DOWN", "RS-UP"], f"STEP IN / OUT pad = {lab}", snap=False)
    w.check("pad_reset_focus", w.focus_to("hpm-reset-keys", "ArrowDown", 30), snap=False)
    tap(0)
    time.sleep(0.2)
    lab = page.evaluate("['hpm-key-stepIn-pad','hpm-key-stepOut-pad','hpm-key-taunt-pad'].map((id) => (document.getElementById(id) || {}).textContent)")
    w.check("pad_reset_defaults", [x.strip() if x else x for x in lab] == ["RS-UP", "RS-DOWN", "SELECT"], f"after RESET = {lab}", snap=False)
    tap(1)
    w.check("pad_B_back_settings", w.wait_screen("main"), snap=False)
    page.evaluate("window.__pad.connected = false")


def run(args) -> int:
    from playwright.sync_api import sync_playwright
    results: list = []
    errors: list = []
    sizes = [s.strip() for s in args.sizes.split(",") if s.strip()]
    global LAB_PORT
    LAB_PORT = args.port                                          # CHANGED(ui): --port
    ctx_srv = LabServer(args.port) if not args.base else None
    started = time.time()
    try:
        if ctx_srv:
            ctx_srv.__enter__()
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=not args.headed, args=["--use-angle=d3d11", "--disable-renderer-backgrounding", "--disable-background-timer-throttling"])
            for size in sizes:
                wdt, hgt = (int(x) for x in size.split("x"))
                phone = hgt <= 500
                ctx = browser.new_context(viewport={"width": wdt, "height": hgt}, device_scale_factor=1)
                ctx.add_init_script(INIT_JS)
                page = ctx.new_page()
                page.on("console", lambda m, s=size: errors.append(f"{s} console.{m.type}: {m.text}") if m.type == "error" else None)
                page.on("pageerror", lambda e, s=size: errors.append(f"{s} pageerror: {e}"))
                game_url = f"http://localhost:{LAB_PORT}/?dev=1" + ("&touch=1" if phone else "")
                url = args.base if args.base else (game_url if args.game else lab_url(None, "touch=1" if phone else ""))
                print(f"[menus] {size} -> {url}")
                page.goto(url, wait_until="load")
                wait_ready(page)
                time.sleep(0.6)
                if args.game:
                    walk_game(page, size, results)
                else:
                    walk_lab(page, size, results)
                if not args.no_pad and not phone:
                    walk_pad(page, results, size)
                errors.extend(f"{size} {e}" for e in (page.evaluate("window.__hpErrors || []") or []))
                ctx.close()
            browser.close()
    except HarnessError as e:
        print(f"[menus] HARNESS ERROR: {e}")
        save_report("menus_game" if args.game else "menus", {"verdict": "ERROR", "error": str(e), "results": results})
        return 2
    finally:
        if ctx_srv:
            ctx_srv.__exit__(None, None, None)
    failed = [r for r in results if not r["ok"]]
    verdict = "PASS" if not failed and not errors else "FAIL"
    rep = {
        "verdict": verdict, "seconds": round(time.time() - started, 1), "steps": len(results), "failed": failed,
        "errors": errors[:50], "results": results,
    }
    path = save_report("menus_game" if args.game else "menus", rep)
    print(f"[menus] {verdict}: {len(results) - len(failed)}/{len(results)} steps, {len(errors)} page errors -> {os.path.relpath(path, ROOT)}")
    for e in errors[:10]:
        print("   ", e)
    return 0 if verdict == "PASS" else 1


# ─────────────────────────── strings sync (CONTRACT 20.1) ───────────────────────────
def sync_strings() -> int:
    sp = os.path.join(ROOT, "data", "strings.json")
    with open(sp, encoding="utf-8") as f:
        strings = json.load(f)
    fdir = os.path.join(ROOT, "data", "fighters")
    added = changed = 0
    for fn in sorted(os.listdir(fdir)):
        if not fn.endswith(".json"):
            continue
        with open(os.path.join(fdir, fn), encoding="utf-8") as f:
            d = json.load(f)
        fid = d.get("id") or fn[:-5]
        pairs = [(f"move.{fid}.{mid}", mv.get("name")) for mid, mv in (d.get("moves") or {}).items() if isinstance(mv, dict)]
        trait = (d.get("unique") or {}).get("trait")
        if isinstance(trait, str) and trait:
            pairs.append((f"trait.{fid}", trait))
        for k, v in pairs:
            if not isinstance(v, str) or not v:
                continue
            if k not in strings:
                added += 1
            elif strings[k] != v:
                changed += 1
            strings[k] = v
    with open(sp, "w", encoding="utf-8", newline="\n") as f:
        json.dump(strings, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"[sync-strings] {added} added, {changed} changed -> data/strings.json ({len(strings)} keys)")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--lab", action="store_true", help="the UI lab page (default)")
    ap.add_argument("--game", action="store_true", help="the integrated game (SHELL server)")
    ap.add_argument("--base", default=None, help="explicit URL")
    ap.add_argument("--sizes", default="1600x900,844x390")
    ap.add_argument("--no-pad", action="store_true")
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--headless", action="store_true", help="(default; accepted for the gate table)")
    ap.add_argument("--sync-strings", action="store_true")
    ap.add_argument("--port", type=int, default=LAB_PORT, help="CHANGED(ui): the dev server port (default 5324)")
    args = ap.parse_args()
    if args.sync_strings:
        return sync_strings()
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
