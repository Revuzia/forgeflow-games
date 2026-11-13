"""PLAYTEST — THE KEEP, run 8: is the interact prompt REALLY on screen when it
should not be, does INTERACT fire at all, and is Old Fen authored twice?"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play

PROMPT = """() => { const e = document.querySelector('.cb-prompt') ||
      (document.querySelector('.cb-prompt-text')||{}).parentElement;
    if (!e) return null; const cs = getComputedStyle(e); const r = e.getBoundingClientRect();
    return { cls: e.className, text: (e.innerText||'').replace(/\\n/g,' | ').trim(),
      opacity: cs.opacity, display: cs.display, visibility: cs.visibility,
      rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] }; }"""

with Play("keep") as P:
    P.n = 160
    P.click_title(); P.wait(3000)

    P.say("=== 1. THE PROMPT AT THE SPAWN — is it really painted? ===")
    P.say("   ", P.js(PROMPT))
    P.shot("prompt_at_spawn")

    P.say("=== 2. DOES `interact` EVEN FIRE? (watch input.interactPressed over 2 s of E) ===")
    P.js("""() => { const I = CRESTBOUND.game.input; window.__ip = 0; window.__or = 0;
        if (!window.__hooked) { window.__hooked = true;
          const eng = CRESTBOUND.engine;
          eng.onFrame(() => { if (I.interactPressed) window.__ip++; if (I.orbitRight) window.__or++; }); }
        return true; }""")
    P.tp(15.5, 6.40, -21.0); P.wait(700)
    P.face(17, -21)
    P.js("() => { window.__ip = 0; window.__or = 0; }")
    for _ in range(4):
        P.tap("E", 130); P.wait(500)
    P.say("   interactPressed frames:", P.js("() => window.__ip"),
          " orbitRight frames:", P.js("() => window.__or"))
    P.say("   prompt here:", P.js(PROMPT))
    P.say("   fenLine flag:", P.js("() => CRESTBOUND.game.save.flags.get('fenLine')"))
    P.shot("fen_E_pressed")

    P.say("   -- what does game.js do on interact? which handler owns the NPC? --")
    P.say("   nearest interactable the game thinks we are at:",
          P.js("""() => { const g = CRESTBOUND.game;
            return { npc: g._nearNpc ? (g._nearNpc.name||g._nearNpc.kind) : null,
                     prompt: g._promptKind || null, gate: g._nearGate ? g._nearGate.course : null,
                     keys: Object.keys(g).filter(k=>/npc|prompt|near|fen/i.test(k)) }; }"""))

    P.say("=== 3. IS OLD FEN AUTHORED TWICE? ===")
    P.say("   def.npcs:", P.js("() => (CRESTBOUND.game.course.def.npcs||[]).length"))
    P.say("   def.critters:", P.js("() => (CRESTBOUND.game.course.def.critters||[]).map(c=>({kind:c.kind,p:c.p}))"))
    P.say("   meshes named/positioned at the nook:",
          P.js("""() => { const out=[]; CRESTBOUND.game.course.group.traverse(o => {
              const w = new CRESTBOUND.THREE.Vector3(); o.getWorldPosition(w);
              if (Math.abs(w.x-17)<1.6 && Math.abs(w.z+21)<1.6 && Math.abs(w.y-6.3)<2.2 && o.type!=='Object3D')
                out.push({name:o.name||o.type, y:+w.y.toFixed(2), x:+w.x.toFixed(2), z:+w.z.toFixed(2)}); });
            return out.slice(0,25); }"""))

    P.say("=== 4. DOES THE PROMPT CLEAR? walk from Fen to the far south gallery ===")
    P.walk_to(14.0, -14.0, tol=1.6, max_ms=9000, tag="out of the nook")
    P.say("   at the gallery north deck:", P.js(PROMPT))
    P.walk_to(18.0, 8.0, tol=1.8, max_ms=12000, tag="south down the east leg")
    P.wait(1200)
    P.say("   20+ m away, prompt:", P.js(PROMPT))
    P.shot("prompt_20m_away")

    P.say("=== 5. THE BALCONY LONG JUMP (the Keep's one authored jump) ===")
    b = P.js("""() => { const objs = CRESTBOUND.game.course.def.objects||[];
        return objs.filter(o => o.p && o.p[1] > 5.5 && o.p[2] > 10 && o.kind === 'platform')
          .map(o => ({p:o.p, s:o.s, mat:o.mat, stripe:!!o.stripe})).slice(0,14); }""")
    for x in b:
        P.say("   ", x)

    P.dump("keep8")
