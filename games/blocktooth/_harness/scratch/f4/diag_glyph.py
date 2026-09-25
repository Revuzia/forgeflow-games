import sys, os, json, time, argparse
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, '..', '..')))
from common import Session, add_common_args, build_url
ap = add_common_args(argparse.ArgumentParser()); args = ap.parse_args()
s = Session(args, 'diag'); s.start()
try:
    url = build_url(args.base, dev=1, seed=1337)
    s.goto(url); s.wait_bt(60); s.wait_screen(('title',), 30); time.sleep(1); s.press('KeyG'); time.sleep(3.0)
    print(json.dumps(s.page.evaluate("""() => [...document.querySelectorAll('.bt2-glyph')].filter((e) => { const p = e.querySelector('path'); return p && !['#ffd166','#f4ecd8'].includes(p.getAttribute('fill')); }).slice(0, 5).map((e) => {
      const chain = []; let p = e; while (p && p !== document.body) { const cs = getComputedStyle(p); if (cs.filter !== 'none' || cs.opacity !== '1' || cs.mixBlendMode !== 'normal') chain.push([p.className, cs.filter, cs.opacity, cs.mixBlendMode]); p = p.parentElement; }
      const path = e.querySelector('path'); return { cls: e.className, bg: getComputedStyle(e).backgroundColor, fill: path && path.getAttribute('fill'), cfill: path && getComputedStyle(path).fill, chain };
    })"""), indent=0))
finally:
    s.close()
