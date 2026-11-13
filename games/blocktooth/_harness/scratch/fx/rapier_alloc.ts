// fx lane scratch (A5): heap cost of rapier pose getters with vs without a target object.
//   node --expose-gc _harness/scratch/fx/rapier_alloc.ts
import RAPIER from '@dimforge/rapier3d-compat';
await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
const bodies: RAPIER.RigidBody[] = [];
for (let i = 0; i < 150; i++) {
  const b = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(i, 5, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5), b);
  bodies.push(b);
}
const T = { x: 0, y: 0, z: 0 }, Q = { x: 0, y: 0, z: 0, w: 1 }, V = { x: 0, y: 0, z: 0 };
const g = (globalThis as { gc?: () => void }).gc!;
function frames(withTarget: boolean, n: number): number {
  let acc = 0;
  for (let f = 0; f < n; f++) {
    for (const b of bodies) {
      const t = withTarget ? b.translation(T as RAPIER.Vector) : b.translation();
      const r = withTarget ? b.rotation(Q as RAPIER.Rotation) : b.rotation();
      const v = withTarget ? b.linvel(V as RAPIER.Vector) : b.linvel();
      acc += t.x + r.w + v.y;
    }
  }
  return acc;
}
for (const withTarget of [false, true, false, true]) {
  frames(withTarget, 50);
  g(); const h0 = process.memoryUsage().heapUsed;
  // no gc inside: measure garbage produced by 200 frames x 150 bodies (young gen may still collect; use allocation via --trace? keep it simple)
  const before = process.memoryUsage().heapUsed;
  frames(withTarget, 20);
  const after = process.memoryUsage().heapUsed;
  console.log(`${withTarget ? 'target   ' : 'no target'}: heap +${((after - before) / 20 / 1024).toFixed(1)} KB/frame (150 bodies, 3 getters each) [base ${(h0 / 1048576).toFixed(1)} MB]`);
}
