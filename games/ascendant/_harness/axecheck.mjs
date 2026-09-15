/* Can a player actually cross under each swinging axe?
 *
 * Models the blade kill capsule exactly as pendulum.js builds it
 *   radius   = max(blade.d * 1.15, blade.h * 0.30)      (line 534)
 *   half-span= blade.w * 0.34 along arm-local Z         (line 539)
 *   theta(t) = amp * sin(TAU*t/period + phase)          (the update)
 * then does a 1-D reachability sweep along the deck: starting anywhere safe at
 * t=0, can the player reach the far end moving at most `vmax`, never occupying
 * a lethal cell? If no start survives, the passage is impossible, not hard.
 */
import fs from 'fs';
const TAU = Math.PI * 2, PR = 0.35, EYEUP = 0.9, VMAX = 12.2;  // sprint
const dir = 'runtime/data/stages';
const files = process.argv[2] ? [process.argv[2]] : fs.readdirSync(dir).filter(f => f.endsWith('.js'));

function segPointDist2(ax, ay, az, bx, by, bz, px, py, pz) {
  const dx = bx-ax, dy = by-ay, dz = bz-az;
  const l2 = dx*dx+dy*dy+dz*dz;
  let t = l2 ? ((px-ax)*dx + (py-ay)*dy + (pz-az)*dz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax+dx*t, cy = ay+dy*t, cz = az+dz*t;
  return (px-cx)**2 + (py-cy)**2 + (pz-cz)**2;
}

for (const f of files) {
  const mod = await import('../' + dir + '/' + f);
  const def = mod.default || Object.values(mod)[0];
  if (!def || !def.objects) continue;
  const objs = def.objects;
  for (const [pi, p] of objs.entries()) {
    if (p.kind !== 'pendulum') continue;
    const bl = p.blade || {}; const w = Math.abs(bl.w ?? 2.6), h = Math.abs(bl.h ?? 1.9);
    const th = Math.max(0.06, Math.abs(bl.d ?? 0.26));
    const R = Math.max(th*1.15, h*0.30), span = w*0.34;
    const armR = Math.max(0.8, p.len ?? 6) + h*0.52;
    const amp = p.amp ?? (p.ampDeg ? p.ampDeg*Math.PI/180 : 0.5);
    const per = p.period ?? 3, ph = p.phase ?? 0;
    const ax = p.axis || [0,0,1];
    const alongX = Math.abs(ax[2]) > Math.abs(ax[0]);   // z-axis => swings in XY (along x)
    // the deck directly under it
    const deck = objs.filter(o => ['beam','platform','ice','vanish'].includes(o.kind) && o.p && o.s)
      .filter(o => Math.abs(o.p[0]-p.p[0]) < (o.s[0]/2 + 1) && Math.abs(o.p[2]-p.p[2]) < (o.s[2]/2 + 1))
      .sort((a,b)=>Math.abs(a.p[1]-p.p[1])-Math.abs(b.p[1]-p.p[1]))[0];
    if (!deck) continue;
    const x0 = deck.p[0]-deck.s[0]/2, x1 = deck.p[0]+deck.s[0]/2, top = deck.p[1]+deck.s[1]/2;
    const py = top + EYEUP, pz = deck.p[2];
    const NX = 140, NT = 160, dx = (x1-x0)/(NX-1), dt = per/NT;
    const lethal = [];
    for (let ti=0; ti<NT; ti++) {
      const th_ = amp*Math.sin(TAU*(ti*dt)/per + ph);
      const bx = p.p[0] + armR*Math.sin(th_)*(alongX?1:0);
      const bz = p.p[2] + armR*Math.sin(th_)*(alongX?0:1);
      const by = p.p[1] - armR*Math.cos(th_);
      const row = new Uint8Array(NX);
      for (let xi=0; xi<NX; xi++) {
        const X = x0 + xi*dx;
        // capsule endpoints run along local Z (world Z if swinging in XY)
        const e = alongX ? [[bx,by,bz-span],[bx,by,bz+span]] : [[bx-span,by,bz],[bx+span,by,bz]];
        const d2 = segPointDist2(e[0][0],e[0][1],e[0][2], e[1][0],e[1][1],e[1][2], X, py, pz);
        row[xi] = d2 < (R+PR)*(R+PR) ? 1 : 0;
      }
      lethal.push(row);
    }
    // reachability: set of x reachable and safe at each t
    let reach = new Uint8Array(NX);
    for (let xi=0; xi<NX; xi++) reach[xi] = lethal[0][xi] ? 0 : 1;
    const stepCells = Math.max(1, Math.round((VMAX*dt)/dx));
    let crossed = false;
    for (let ti=1; ti<NT*3 && !crossed; ti++) {
      const L = lethal[ti % NT];
      const nxt = new Uint8Array(NX);
      for (let xi=0; xi<NX; xi++) {
        if (!reach[xi]) continue;
        for (let k=-stepCells; k<=stepCells; k++) {
          const j = xi+k; if (j<0||j>=NX) continue;
          if (!L[j]) nxt[j] = 1;
        }
      }
      reach = nxt;
      if (reach[NX-1]) crossed = true;
      if (!reach.some(v=>v)) break;
    }
    const alwaysLethalCells = (()=>{let n=0; for(let xi=0;xi<NX;xi++){let all=true; for(let ti=0;ti<NT;ti++) if(!lethal[ti][xi]){all=false;break;} if(all)n++;} return n;})();
    const tag = crossed ? 'PASSABLE' : '*** IMPOSSIBLE ***';
    console.log(`${f.padEnd(13)} axe obj${String(pi).padStart(3)}  killR ${R.toFixed(2)}m span ${span.toFixed(2)}m  deck ${deck.kind} x[${x0.toFixed(1)},${x1.toFixed(1)}] (${(x1-x0).toFixed(1)}m)  alwaysLethal ${alwaysLethalCells}/${NX}  ${tag}`);
  }
}
