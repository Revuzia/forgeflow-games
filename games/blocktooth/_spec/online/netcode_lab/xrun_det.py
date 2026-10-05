import json, sys, pathlib
from playwright.sync_api import sync_playwright
here = pathlib.Path(__file__).parent.resolve()
url = (here / 'xpage_det.html').as_uri()
cfgs = [('molo','grideast',1337,18000), ('voltkite','whitestacks',1337,18000), ('hearthback','lockwater',99,18000)]
res = {}
with sync_playwright() as p:
    for name, bt in (('chromium', p.chromium), ('firefox', p.firefox), ('webkit', p.webkit)):
        try:
            b = bt.launch()
            pg = b.new_page(); pg.set_default_timeout(600000)
            pg.goto(url)
            ver = b.version
            out = []
            for t, bi, s, n in cfgs:
                out.append(pg.evaluate(f"() => runProbe('{t}','{bi}',{s},{n})"))
            res[name] = {'version': ver, 'runs': out}
            b.close()
        except Exception as e:
            res[name] = {'error': str(e)[:400]}
json.dump(res, open(here / 'xres_det.json', 'w'))
print('ok')
