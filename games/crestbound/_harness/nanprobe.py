"""NaN / black-splat probe (image lane, critic r1).

Freezes the engine at a station, renders ONE composed frame per toggle state
and counts PURE-BLACK (0,0,0) pixels on a 2x2 sub-sample of the canvas.  The
toggles isolate where a black pixel is born: bloom, the hue hold, the roll-off
knee, the RCAS sharpen, the plain present.  Pass criterion (critic): 0 pure-
black pixels at ember-1 spawn, ember-4 crest-wing, keep spawn, azure-3
crest-boss with everything ON.

Also samples a small box (default the frame centre) and, with --column X,
prints a vertical luminance column so a horizon band can be attributed with
the fog / bloom toggles.

  python _harness/nanprobe.py ember-1 spawn
  python _harness/nanprobe.py ember-4 crest-wing --box 0.45,0.55,0.62,0.72
  python _harness/nanprobe.py verdant-1 vista-ne --column 0.5

Always runs the AUTO tier (quality=low, autoscale=0) like shots.py --quality low.
"""
import argparse, importlib.util, json, sys, time
from playwright.sync_api import sync_playwright

spec = importlib.util.spec_from_file_location('lv', '_harness/_lodvisible.py')
lv = importlib.util.module_from_spec(spec); spec.loader.exec_module(lv)
spec2 = importlib.util.spec_from_file_location('lc', '_harness/loopcheck.py')
lc = importlib.util.module_from_spec(spec2); spec2.loader.exec_module(lc)

VISTA_JS = r"""(name)=>{const A=CRESTBOUND,G=A.game,C=G.course,THREE=A.THREE;
  const v=(C.vistas||C.def&&C.def.vistas||[]);
  let st=null; if(Array.isArray(v)) st=v.find(x=>x&&(x.id===name||x.name===name));
  if(!st&&C.def&&C.def.stations) st=(C.def.stations||[]).find(x=>x&&(x.id===name||x.name===name));
  if(!st) return null;
  const p=st.pos||st.p||st.position; const px=Array.isArray(p)?{x:p[0],y:p[1],z:p[2]}:p;
  const P=G.player; if(P&&P.__test){P.__test.teleport(new THREE.Vector3(px.x,px.y+0.6,px.z));P.__test.setVel(new THREE.Vector3(0,0,0));}
  if(st.yaw!==undefined&&G.cam){ if(G.cam.setYaw) G.cam.setYaw(st.yaw); else if('yaw' in G.cam) G.cam.yaw=st.yaw; }
  if (G.cam && G.cam.snapToPlayer) G.cam.snapToPlayer();
  return [px.x,px.y,px.z];}"""

JS = r"""
async (opts) => {
  const A = globalThis.CRESTBOUND, E = A.engine, R = E.renderer, S = E.scene, THREE = A.THREE;
  const frame = () => new Promise(r => requestAnimationFrame(r));
  E.stop(); for (let k = 0; k < 4; k++) await frame();
  const gl = R.getContext(); const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const buf = new Uint8Array(w * h * 4);
  const bx = opts.box;   // [x0,y0,x1,y1] fractions, y from the top
  const measure = () => {
    E.render(0); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let black = 0, n = 0;
    for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 4; n++;
      if (buf[i] === 0 && buf[i + 1] === 0 && buf[i + 2] === 0) black++;
    }
    // box sample (readPixels rows are bottom-up)
    let br = 0, bg = 0, bb = 0, bn = 0, bblack = 0;
    const x0 = Math.floor(bx[0] * w), x1 = Math.ceil(bx[2] * w), y0 = Math.floor((1 - bx[3]) * h), y1 = Math.ceil((1 - bx[1]) * h);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4; br += buf[i]; bg += buf[i + 1]; bb += buf[i + 2]; bn++;
      if (buf[i] === 0 && buf[i + 1] === 0 && buf[i + 2] === 0) bblack++;
    }
    const out = { black, sampled: n, pct: +(100 * black / n).toFixed(3),
      box: bn ? [Math.round(br / bn), Math.round(bg / bn), Math.round(bb / bn)] : null, boxBlackPct: bn ? +(100 * bblack / bn).toFixed(2) : null };
    if (opts.column !== null) {
      const cx = Math.min(w - 1, Math.floor(opts.column * w)); const col = [];
      for (let yy = 0; yy < h; yy += 4) { const i = ((h - 1 - yy) * w + cx) * 4; col.push([yy, Math.round(0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]), buf[i], buf[i + 1], buf[i + 2]]); }
      out.column = col;
    }
    return out;
  };
  const res = { w, h, base: measure(), toggles: {} };
  const passes = (E.composer && E.composer.passes) || [];
  res.passes = passes.map(p => p.constructor.name + (p.enabled === false ? '(off)' : ''));
  const fin = passes.find(p => /finish/i.test(p.constructor.name));
  const pres = passes.find(p => /present/i.test(p.constructor.name));
  const bl = passes.find(p => ('strength' in p));
  if (bl) { const s = bl.strength; bl.strength = 0; res.toggles.bloomOff = measure(); bl.strength = s; }
  if (fin && fin.uniforms) {
    const u = fin.uniforms;
    if (u.uHueHold) { const s = u.uHueHold.value; u.uHueHold.value = 0; res.toggles.hueHold0 = measure(); u.uHueHold.value = s; }
    if (u.uHiKnee) { const s = u.uHiKnee.value; u.uHiKnee.value = 1e6; res.toggles.rolloffOff = measure(); u.uHiKnee.value = s; }
    res.finish = {}; for (const k of Object.keys(u)) { const v = u[k].value; if (typeof v === 'number') res.finish[k] = +v.toFixed(3); }
  }
  if (pres && pres.uniforms && pres.uniforms.uSharp) { const s = pres.uniforms.uSharp.value; pres.uniforms.uSharp.value = 0; res.toggles.sharpen0 = measure(); pres.uniforms.uSharp.value = s; }
  const fog = S.fog; if (fog) { S.fog = null; res.toggles.fogOff = measure(); S.fog = fog; }
  res.renderScale = E.renderScale !== undefined ? E.renderScale : null;
  res.pos = A.game && A.game.player && A.game.player.pos ? [A.game.player.pos.x, A.game.player.pos.y, A.game.player.pos.z] : null;
  E.start(E._loopFn || null);
  return res;
}"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('course'); ap.add_argument('station', nargs='?', default='spawn')
    ap.add_argument('--box', default='0.45,0.45,0.55,0.55', help='x0,y0,x1,y1 fractions (y from top)')
    ap.add_argument('--column', type=float, default=None, help='x fraction of a vertical luminance column to print')
    ap.add_argument('--quality', default='low')
    ap.add_argument('--out', default=None)
    ap.add_argument('--settle', type=float, default=2.0, help='seconds to settle on the station before the reads')
    ap.add_argument('--width', type=int, default=1920); ap.add_argument('--height', type=int, default=1080)
    a = ap.parse_args()
    box = [float(v) for v in a.box.split(',')]
    with sync_playwright() as p:
        br = lc.launch_headless(p)
        pg = br.new_page(viewport={'width': a.width, 'height': a.height})
        pg.goto(lc.BASE + '?dev=1&quality=%s&autoscale=0' % a.quality, wait_until='load', timeout=60000)
        assert lc.wait_ready(pg); assert lc.leave_title(pg)
        if a.course != 'keep':
            ok, why = lc.goto_course(pg, a.course); assert ok, why
        time.sleep(3.0)
        st = a.station
        if st.startswith('vista'):
            # the same establishing-shot pose shots.py uses (course-bounds corner, camera frozen)
            spec3 = importlib.util.spec_from_file_location('sh', '_harness/shots.py')
            sh = importlib.util.module_from_spec(spec3); spec3.loader.exec_module(sh)
            stations = pg.evaluate(sh.STATIONS_JS)['stations']
            vs = [s for s in stations if s.get('name') == st]
            assert vs, 'no station %s in %s' % (st, [s.get('name') for s in stations])
            pos = pg.evaluate(sh.VISTA_JS, {'st': vs[0]})
        else:
            pos = pg.evaluate(lv.STATION_JS, st)
        print('station', st, pos)
        time.sleep(a.settle)
        r = pg.evaluate(JS, {'box': box, 'column': a.column})
        out = a.out or ('_shots/%s/nanprobe_%s.png' % (a.course, st))
        pg.screenshot(path=out)
        br.close()
    col = r['base'].pop('column', None)
    for k in list(r['toggles'].keys()):
        r['toggles'][k].pop('column', None)
    print(json.dumps({k: v for k, v in r.items()}))
    if col:
        print('column (y, luma, r, g, b) every 4 px, base frame:')
        prev = None
        for y, l, rr, gg, bb in col:
            flag = ''
            if prev is not None and abs(l - prev) > 20: flag = '  STEP %+d' % (l - prev)
            print('  %4d %3d  (%3d,%3d,%3d)%s' % (y, l, rr, gg, bb, flag)); prev = l
    print('shot', out)
    return 0 if r['base']['black'] == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
