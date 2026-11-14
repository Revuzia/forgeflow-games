#!/usr/bin/env python
"""perfcheck + the ?prof=1 frame profiler: runs _harness/perfcheck.py unchanged, but opens the page
with prof=1, adds --enable-precise-memory-info, resets the profiler at the start of the sampling
window, and dumps window.__BTPROF__.dump() to _harness/_reports/perfprof[-TAG].json.
    python _harness/scratch/perfprof.py [--tag x] [perfcheck args...]
"""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import common  # noqa
import perfcheck  # noqa

tag = ""
if "--tag" in sys.argv:
    i = sys.argv.index("--tag"); tag = "-" + sys.argv[i + 1]; del sys.argv[i:i + 2]
extra = os.environ.get("PROF_URL", "")
common.FLAGS.append("--enable-precise-memory-info")
_bu = perfcheck.build_url
def build_url(base, **kw):
    kw["prof"] = 1
    for kv in filter(None, extra.split("&")):
        k, v = kv.split("="); kw[k] = v
    return _bu(base, **kw)
perfcheck.build_url = build_url
_fs, _fe = common.Session.ft_start, common.Session.ft_stop
def ft_start(self):
    self.safe_js("() => window.__BTPROF__ && window.__BTPROF__.reset()")
    return _fs(self)
def ft_stop(self):
    r = _fe(self)
    try:
        d = self.js("() => window.__BTPROF__ ? JSON.stringify(window.__BTPROF__.dump()) : 'no prof'")
        d = json.loads(d) if d and d[0] == "{" else d
    except Exception as e:
        d = {"err": str(e)[:500]}
        print("PROF DUMP ERR", e)
    out = os.path.join(common.REPORTS, "perfprof%s.json" % tag)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(d, f)
    print("profile   : %s" % out)
    return r
common.Session.ft_start, common.Session.ft_stop = ft_start, ft_stop
css = os.environ.get("INJECT_CSS")
if css:
    _st = common.Session.start
    def start(self):
        _st(self)
        self.page.add_init_script("document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = %s; document.head.appendChild(s); });" % json.dumps(css))
    common.Session.start = start
sys.exit(perfcheck.main())
