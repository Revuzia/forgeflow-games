"""Find HUD elements that overflow / show scrollbars, per titan (observation only)."""
import os, sys, time, json
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from common import Session, add_common_args, build_url, SHOTS  # noqa
import argparse
ap = argparse.ArgumentParser(); add_common_args(ap); args = ap.parse_args(); args.no_serve = True
S = Session(args, "hud_overflow"); S.start()
JS = r"""() => { const out = []; const card = document.querySelector('.bt-card');
  for (const e of document.querySelectorAll('.bt-hud *, .bt-hud')) {
    const cs = getComputedStyle(e); if (cs.display === 'none') continue;
    const sx = e.scrollWidth - e.clientWidth, sy = e.scrollHeight - e.clientHeight;
    if ((sx > 1 && cs.overflowX !== 'visible' && cs.overflowX !== 'hidden' && cs.overflowX !== 'clip') || (sy > 1 && cs.overflowY !== 'visible' && cs.overflowY !== 'hidden' && cs.overflowY !== 'clip'))
      out.push({ cls: e.className, sx, sy, ox: cs.overflowX, oy: cs.overflowY });
  }
  const r = card && card.getBoundingClientRect();
  const kids = card ? [...card.querySelectorAll('*')].filter(k => { const b = k.getBoundingClientRect(); return b.width && (b.right > r.right + 0.5); }).map(k => ({ cls: k.className, right: Math.round(k.getBoundingClientRect().right), text: (k.innerText || '').slice(0, 30) })) : [];
  return { scrollers: out, card: r && { w: Math.round(r.width), right: Math.round(r.right) }, cardScroll: card && [card.scrollWidth, card.clientWidth, getComputedStyle(card).overflow], spill: kids.slice(0, 8), vw: innerWidth }; }"""
try:
    for t in ("molo", "voltkite", "hearthback", "briarwick"):
        for vw in ((1280, 720), (1920, 1080)):
            S.page.set_viewport_size({"width": vw[0], "height": vw[1]})
            S.goto(build_url(args.base, autostart=1, noslate=1, seed=11, titan=t)); S.wait_bt(60); S.wait_screen("play", 60); time.sleep(1.5)
            r = S.safe_js(JS)
            print(t, vw, json.dumps(r)[:900], flush=True)
            S.screenshot(os.path.join(SHOTS, "critic", "hud_%s_%d.png" % (t, vw[0])))
finally:
    S.close()
