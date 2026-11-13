"""Minimal boot probe for the rime-3 playtest lane."""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _play_rime3 import P

with P("boot") as g:
    g.say("state:", g.js("() => CRESTBOUND.game.state"))
    g.shot("title")
    btns = g.js("""() => [...document.querySelectorAll('button')].map(b=>({
        t:(b.textContent||'').trim().slice(0,40), vis:b.offsetParent!==null, cls:b.className}))""")
    for b in btns:
        g.say("  btn", b)
    r = g.js("""() => { const b=[...document.querySelectorAll('button')].filter(x=>x.offsetParent!==null)
        .find(x=>(x.textContent||'').toUpperCase().includes('NEW'));
        if(!b) return null; if(b.__activate) b.__activate(); else b.click();
        return (b.textContent||'').trim(); }""")
    g.say("clicked:", r)
    for i in range(30):
        g.wait(1000)
        try:
            st = g.js("() => CRESTBOUND.game.state")
        except Exception as e:
            g.say("  eval died at t=%ds: %s" % (i, str(e)[:120]))
            break
        g.say("  t=%ds state=%s dev=%s" % (i, st, g.js("() => !!CRESTBOUND.game.__dev")))
        if st not in ("title", "loading"):
            break
    g.shot("after_click")
    for c in g.console[:40]:
        g.say("  console:", c)
    g.dump()
