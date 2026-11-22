"""Owner bug 2026-11-22: menu music keeps playing once the match has started.
Cold load with the browser's REAL autoplay policy (a gesture is required), real
clicks into a match, then report which music elements are playing.
PASS = in the drop / match only music_match (or endgame) plays, menu paused.
Run from the game's _harness dir:  python <this> --disk [--rev <sha>]"""
import os, sys, time
sys.path.insert(0, os.getcwd())
import common as C
C.FLAGS[:] = [f for f in C.FLAGS if not f.startswith("--autoplay-policy")] + ["--autoplay-policy=document-user-activation-required"]
import argparse
import bootcheck as B

# __GAME_AUDIO__ holds one element per music track in creation order:
# [0] = music_menu (created on the first gesture / idle), [1] = music_match, [2] = endgame
AUD_JS = r"""() => (window.__GAME_AUDIO__ || []).map((el, i) => ({ i, src: String(el.currentSrc || el.src || '').slice(0, 40),
  paused: el.paused, t: Math.round(el.currentTime * 10) / 10 }))"""
# map elements to track names via the audio state readout
NAMES_JS = r"""() => { try { const s = window.__LC__.audioState && window.__LC__.audioState(); return s && s.music; } catch (e) { return null; } }"""


def main():
    ap = argparse.ArgumentParser()
    C.add_common_args(ap)
    args = ap.parse_args()
    res = {}

    def body(v):
        with C.Session(args, "menu_music_probe") as s:
            s.boot()
            s.sleep(1.0)
            # no gesture yet: what does the menu do?
            res["menu_before_gesture"] = s.js(AUD_JS)
            if os.environ.get("FIRST_GESTURE_IS_CARD"):
                # returning-player path: close the help card WITHOUT a user gesture,
                # so the first real gesture is the click on the mode card
                s.js("() => { for (const b of [...document.querySelectorAll('button')]) if (b.offsetParent && /GOT IT/i.test(b.textContent || '')) b.click(); }")
            else:
                for _ in range(3):
                    b = s.js(B.BTN_JS, "^\s*GOT IT\s*$")
                    if not b:
                        break
                    s.page.mouse.click(b["x"], b["y"])   # first gesture = closing the help card
                    s.sleep(0.6)
            s.sleep(2.5)
            res["menu_after_gesture"] = s.js(AUD_JS)
            card = s.js(B.CARD_JS, B.MODE_RE["standard"])
            s.page.mouse.click(card["x"], card["y"])
            s.wait_js("() => window.__LC__.W.phase === 'lobby' && !window.__LC__.W._starting", args.load_timeout, 0.25)
            s.sleep(3.0)
            res["lobby"] = s.js(AUD_JS)
            lob = [a for a in res["lobby"] if not a["paused"] and a["i"] == 0]
            v.check("in the lobby (player in the world) the title music is NOT playing", not lob, {"lobby": res["lobby"]})
            s.page.keyboard.press("Enter")
            s.wait_js("() => ['drop', 'match'].includes(window.__LC__.W.phase)", 20, 0.1)
            s.sleep(3.0)
            cv = s.js("() => { const c = window.__LC__.W.kernel.renderer.domElement; const r = c.getBoundingClientRect(); return { x: r.left + r.width * 0.5, y: r.top + r.height * 0.6 }; }")
            for _ in range(3):                         # more gestures during the match
                s.page.mouse.click(cv["x"], cv["y"])
                s.sleep(0.5)
            s.sleep(3.0)
            res["phase"] = s.phase()
            res["in_match"] = s.js(AUD_JS)
            playing = [a for a in res["in_match"] if not a["paused"]]
            menu_playing = [a for a in playing if a["i"] == 0]
            v.info("audio elements", res)
            v.check("in the match the menu music is NOT playing", not menu_playing, {"playing": playing})
            v.check("in the match exactly one music track plays", len(playing) == 1, {"playing": playing})
    return C.run_gate("menu_music_probe", body, args)


if __name__ == "__main__":
    sys.exit(main())
