#!/usr/bin/env python
"""perfcheck unchanged + saves the raw rAF frame-time list (and, with PROF=1, the ?prof=1 dump) to
_harness/_reports/ftdump[-TAG].json.   python _harness/scratch/ftdump.py [--tag x] [perfcheck args...]"""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import common  # noqa
import perfcheck  # noqa
tag = ""
if "--tag" in sys.argv:
    i = sys.argv.index("--tag"); tag = "-" + sys.argv[i + 1]; del sys.argv[i:i + 2]
PROF = os.environ.get("PROF") == "1"
if PROF:
    common.FLAGS.append("--enable-precise-memory-info")
    _bu = perfcheck.build_url
    def build_url(base, **kw):
        kw["prof"] = 1
        return _bu(base, **kw)
    perfcheck.build_url = build_url
_fs, _fe = common.Session.ft_start, common.Session.ft_stop
T0 = [0.0]
def ft_start(self):
    T0[0] = __import__('time').time()
    if PROF: self.safe_js("() => window.__BTPROF__ && window.__BTPROF__.reset()")
    return _fs(self)
def ft_stop(self):
    r = _fe(self)
    d = None
    if PROF:
        try:
            d = self.js("() => window.__BTPROF__ ? JSON.stringify(window.__BTPROF__.dump()) : 'no prof'")
            d = json.loads(d) if d and d[0] == "{" else d
        except Exception as e:
            d = {"err": str(e)[:500]}
    out = os.path.join(common.REPORTS, "ftdump%s.json" % tag)
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"ft": r, "prof": d, "scale": SC, "t0": T0[0]}, f)
    print("ftdump    : %s" % out)
    return r
common.Session.ft_start, common.Session.ft_stop = ft_start, ft_stop
import time as _t
SC = []
_st = common.Session.state
def state(self):
    r = _st(self)
    if isinstance(r, dict): SC.append((round(_t.time(), 2), r.get("renderScale"), r.get("screen"), r.get("dynres")))
    return r
common.Session.state = state
sys.exit(perfcheck.main())
