import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play

with Play("azboot2") as P:
    print("typeof:", P.js("() => typeof globalThis.CRESTBOUND"))
    print("url:", P.pg.url)
    print("title:", P.pg.title())
    print("console:", json.dumps(P.console[:40], indent=1))
    body = P.js("() => document.body ? document.body.innerText.slice(0,600) : null")
    print("body:", body)
    print("scripts:", P.js("() => [...document.querySelectorAll('script')].map(s=>s.src||('inline:'+s.type))"))
    P.shot("boot")
