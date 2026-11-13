// DATA LANE probe: every checkpoint vs every gnasher's aggro / bite envelope.
import { ALL_COURSE_IDS, getCourse } from '../runtime/data/index.js';
const GN_R = 0.55, PLAYER_R = 0.42;
let bad = 0;
for (const id of ALL_COURSE_IDS) {
  const C = await getCourse(id);
  const gn = (C.critters || []).filter(c => c.kind === 'gnasher');
  if (!gn.length) continue;
  (C.checkpoints || []).forEach((cp, i) => {
    for (const g of gn) {
      const post = g.post || g.p, body = g.p, chain = g.chain ?? 6;
      const dPost = Math.hypot(cp.p[0] - post[0], cp.p[2] - post[2]);
      const dBody = Math.hypot(cp.p[0] - body[0], cp.p[2] - body[2]);
      const bite = chain + GN_R * 1.05 + PLAYER_R;      // reach from the anchor
      const aggro = chain + 1.6;                          // from the body
      const flag = dPost <= bite + 3.0 ? (dPost <= bite ? 'LETHAL' : 'CLOSE') : 'ok';
      if (flag !== 'ok') bad++;
      console.log(`${id} ${cp.id || 'cp'+i} p=${cp.p.map(v=>+v.toFixed(2))}  dPost=${dPost.toFixed(2)} (bite ${bite.toFixed(2)})  dBody=${dBody.toFixed(2)} (aggro ${aggro.toFixed(2)})  ${flag}`);
    }
  });
}
console.log('flagged:', bad);
