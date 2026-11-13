"""ui fix group: HUD status card overflow + size check, 4 titans x 2 viewports (observation only)."""
import os, sys, time, json
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from common import Session, add_common_args, build_url, SHOTS  # noqa
import argparse
ap = argparse.ArgumentParser(); add_common_args(ap); ap.add_argument("--titans", default="molo,voltkite,hearthback,briarwick")
ap.add_argument("--rank", type=int, default=-1)
args = ap.parse_args(); args.no_serve = True
OUT = os.path.join(SHOTS, "uifix"); os.makedirs(OUT, exist_ok=True)
S = Session(args, "uifix_hud"); S.start()
JS = r"""() => { const out = []; const card = document.querySelector('.bt-hud .bt-status');
  for (const e of document.querySelectorAll('.bt-hud *, .bt-hud')) {
    const cs = getComputedStyle(e); if (cs.display === 'none') continue;
    const sx = e.scrollWidth - e.clientWidth, sy = e.scrollHeight - e.clientHeight;
    if ((sx > 1 && cs.overflowX !== 'visible' && cs.overflowX !== 'hidden' && cs.overflowX !== 'clip') || (sy > 1 && cs.overflowY !== 'visible' && cs.overflowY !== 'hidden' && cs.overflowY !== 'clip'))
      out.push({ cls: e.className, sx, sy, ox: cs.overflowX, oy: cs.overflowY });
  }
  const r = card.getBoundingClientRect(); const cs = getComputedStyle(card);
  const spill = [...card.querySelectorAll('*')].filter(k => { const b = k.getBoundingClientRect(); return b.width && !k.classList.contains('bt-lvflash') && (b.right > r.right - 0.5 || b.left < r.left - 0.5); }).map(k => ({ cls: k.className, right: Math.round(k.getBoundingClientRect().right), text: (k.innerText || '').slice(0, 30) }));
  const hn = card.querySelector('.bt-hook-name'); const rl = card.querySelector('.bt-status-role');
  const keys = [...card.querySelectorAll('.bt-key')].map(k => { const b = k.getBoundingClientRect(); return [k.textContent, Math.round(b.left), Math.round(b.right)]; });
  return { card: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], cardArea: +(r.width * r.height / (innerWidth * innerHeight) * 100).toFixed(1),
    padding: cs.padding, overflow: cs.overflow, scrollers: out, spill, keys,
    hookClipped: hn ? hn.scrollWidth > hn.clientWidth : null, hookText: hn && hn.textContent, roleClipped: rl ? rl.scrollWidth > rl.clientWidth : null, vw: [innerWidth, innerHeight] }; }"""
try:
    for t in args.titans.split(","):
        for vw in ((1280, 720), (1920, 1080)):
            S.page.set_viewport_size({"width": vw[0], "height": vw[1]})
            S.goto(build_url(args.base, autostart=1, noslate=1, seed=11, titan=t, dev=1)); S.wait_bt(60); S.wait_screen("play", 60); time.sleep(1.0)
            if args.rank >= 0:
                S.cheat("rank", args.rank); time.sleep(2.5)
            r = S.safe_js(JS)
            print(t, vw, json.dumps(r), flush=True)
            S.screenshot(os.path.join(OUT, "hud_%s_%d%s.png" % (t, vw[0], "" if args.rank < 0 else "_r%d" % args.rank)))
finally:
    S.close()
