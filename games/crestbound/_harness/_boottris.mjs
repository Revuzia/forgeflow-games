import { bevelBoxGeometry } from '../runtime/world/builders.js';
const tri = (g) => g.attributes.position.count / 3;
const box = (w,h,d,b) => tri(bevelBoxGeometry(w,h,d,b,1));
// OLD boot: shell, toecap, sole slab, 3 ribs  (lathe unchanged in both)
const old_ = box(0.170,0.160,0.222,0.038) + box(0.153,0.1184,0.126,0.045)
  + box(0.184,0.034,0.300,0.014) + 3*box(0.160,0.012,0.030,0.005);
// NEW boot: shell, vamp, toe cap, 3 lace bars, 3 sole segs, 5 lugs
const new_ = box(0.170,0.160,0.222,0.038) + box(0.150,0.112,0.110,0.040) + box(0.116,0.078,0.062,0.028)
  + 3*box(0.146,0.011,0.012,0.004)
  + box(0.156,0.030,0.118,0.013) + box(0.124,0.030,0.086,0.012) + box(0.152,0.034,0.096,0.013)
  + 3*box(0.140,0.012,0.026,0.005) + 2*box(0.128,0.012,0.026,0.005);
console.log('old per boot', old_, 'new per boot', new_, 'delta x2 =', (new_-old_)*2);
