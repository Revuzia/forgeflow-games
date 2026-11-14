"""L8 scratch: UPROAR meter states through a REAL key press (E), the ACTIVE panel through a real SPACE,
edge-arrow markers, and a power-up burst. Shots → _shots/l8_seq_<n>_<state>.png.

    python _harness/scratch/l8/ultseq.py --base http://localhost:5258/ --no-serve --headless [--titan voltkite]
"""
import argparse, json, os, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))
from common import Session, add_common_args, build_url, ensure_play, SHOTS  # noqa: E402

ap = argparse.ArgumentParser(); add_common_args(ap)
ap.add_argument('--titan', default='voltkite'); ap.add_argument('--biome', default='lockwater')
args = ap.parse_args()
sess = Session(args, 'l8seq'); sess.start()
fails = []
def dom(): return sess.js("() => { const s = window.__BT__.state(); const w = window.__BT__.world; return { d: s.v2dom, ult: s.v2.ult, cd: w.titan.abilityCd, lockT: w.ult.lockT, label: (document.querySelector('.bt-up-lbl')||{}).textContent, cls: (document.querySelector('.bt-uproar')||{}).className, burst: (document.querySelector('.bt-up-burst')||{}).textContent } }")
def shot(n, name):
    p = os.path.join(SHOTS, 'l8_seq_%d_%s.png' % (n, name)); sess.screenshot(p); print('   shot', p)
try:
    sess.goto(build_url(args.base, autostart=1, dev=1, titan=args.titan, biome=args.biome, seed=1337))
    assert sess.wait_bt(90); sess.wait_screen(('slate', 'play'), 90)
    ok, scr = ensure_play(sess, 30); print('play:', ok, scr)
    sess.cheat('god', True)
    s0 = dom(); print('0 idle:', json.dumps(s0))
    if not s0['label'].startswith('UPROAR'): fails.append('idle label ' + str(s0['label']))
    sess.cheat('ult', 100); time.sleep(0.5)
    s1 = dom(); print('1 ready:', json.dumps(s1)); shot(1, 'ready')
    if s1['label'] != 'UPROAR READY' or 'ready' not in s1['cls']: fails.append('ready state not shown: %s / %s' % (s1['label'], s1['cls']))
    if abs(s1['d']['meterPct'] - round(s1['ult']['charge'])) > 1: fails.append('meterPct mismatch at ready')
    fired0 = s1['ult']['fired']
    sess.press('KeyE', 80); time.sleep(0.28)
    s2 = dom(); print('2 fire+0.3s:', json.dumps(s2)); shot(2, 'fire')
    if s2['ult']['fired'] != fired0 + 1: fails.append('real E did not fire (fired %s → %s)' % (fired0, s2['ult']['fired']))
    if not s2['burst']: fails.append('no burst word')
    time.sleep(2.2)
    s3 = dom(); print('3 cooling:', json.dumps(s3)); shot(3, 'cooling')
    if s3['lockT'] > 0 and s3['label'] != 'COOLING': fails.append('cooling label: %s (lockT %.2f)' % (s3['label'], s3['lockT']))
    # ACTIVE panel: real SPACE → cooldown text = ceil(cd)+'s'
    sess.press('Space', 80); time.sleep(0.35)
    s4 = dom(); print('4 hook cd:', json.dumps(s4)); shot(4, 'hookcd')
    cd = s4['cd']; want = 'READY' if cd <= 0 else '%ds' % (int(cd) + (0 if cd == int(cd) else 1))
    if s4['d']['activeCdText'] != want: fails.append('activeCdText %r vs %r' % (s4['d']['activeCdText'], want))
    # markers: an objective far ahead (off-screen) → an edge arrow; a power-up close → on-screen chip
    ok, oid = sess.cheat('objective', 'recordsAnnex'); print('annex objective:', ok, oid)
    sess.cheat('objective', 'reliefDepot', 400)
    ok, pid = sess.cheat('powerup', 'backPay'); print('powerup backPay:', ok, pid)
    time.sleep(0.6)
    mk = sess.page.evaluate("() => Array.from(document.querySelectorAll('[data-v2=marker]')).filter(n => n.getClientRects().length).map(n => ({edge: n.classList.contains('edge'), t: n.style.transform, txt: n.textContent}))")
    print('5 markers:', json.dumps(mk)); shot(5, 'markers')
    # power-up burst through a real walk-in is L4's check; here the HUD burst + tracker row via the pickup event
    s6 = dom(); print('6:', json.dumps(s6['d']))
    d = sess.diagnostics()
    print('diag:', json.dumps({k: (len(v) if isinstance(v, list) else v) for k, v in d.items()}) if isinstance(d, dict) else d)
finally:
    sess.close()
print('FAILS:', fails if fails else 'none')
sys.exit(1 if fails else 0)
