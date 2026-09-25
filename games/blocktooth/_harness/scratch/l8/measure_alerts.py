"""L8 scratch: measure every broadcast .bt-alert (toast + urgent variants) in u at the current viewport:
clone the live alert box, fill each ALERTS entry, read its box. Output feeds the v2 toast-stack offset."""
import argparse, json, os, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))
from common import Session, add_common_args, build_url, ensure_play  # noqa: E402
ap = argparse.ArgumentParser(); add_common_args(ap); args = ap.parse_args()
s = Session(args, 'l8measure'); s.start()
try:
    s.goto(build_url(args.base, autostart=1, dev=1, titan='molo', biome='grideast', seed=1337)); s.wait_bt(90); s.wait_screen(('slate', 'play'), 90); ensure_play(s, 30)
    r = s.page.evaluate("""async () => {
      const S = await import('/src/data/strings.ts');
      const box = document.querySelector('.bt-alert');
      const u = Math.max(8, Math.min(innerWidth / 100, innerHeight * 1.7778 / 100));
      const out = {};
      for (const [k, v] of Object.entries(S.ALERTS)) for (const kind of ['toast', 'urgent']) {
        const c = box.cloneNode(true); c.getAnimations && c.getAnimations().forEach(a => a.cancel());
        c.className = 'bt-alert on ' + kind; c.style.cssText = 'visibility:visible;opacity:1;transform:none;animation:none';
        const t = c.querySelector('.bt-alert-title'), sb = c.querySelector('.bt-alert-sub');
        if (t) t.textContent = v.title; if (sb) sb.textContent = v.sub;
        box.parentElement.appendChild(c);
        const b = c.getBoundingClientRect(); c.remove();
        out[k + ':' + kind] = [+(b.top / u).toFixed(2), +(b.bottom / u).toFixed(2), +(b.right / u).toFixed(2)];
      }
      return { u, out };
    }""")
    u = r['u']; out = r['out']
    toasts = {k: v for k, v in out.items() if k.endswith(':toast')}
    urg = {k: v for k, v in out.items() if k.endswith(':urgent')}
    tmax = max(toasts.items(), key=lambda kv: kv[1][1]); umax = max(urg.items(), key=lambda kv: kv[1][1])
    print('%dx%d  u=%.2f px' % (args.width, args.height, u))
    print('  tallest broadcast TOAST : %-28s top %.2fu bottom %.2fu right %.2fu' % (tmax[0], *tmax[1]))
    print('  urgent strap (tallest)  : %-28s top %.2fu bottom %.2fu' % (umax[0], umax[1][0], umax[1][1]))
    print('  all toast bottoms (u):', ' '.join('%s %.2f' % (k.split(':')[0], v[1]) for k, v in sorted(toasts.items(), key=lambda kv: -kv[1][1])))
finally:
    s.close()
