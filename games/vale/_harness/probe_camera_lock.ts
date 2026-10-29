// probe (lane RENDER): the in-match camera keeps your fighter centred unless you deliberately look away.
//
// Drives the REAL CameraRig (src/render/camera.ts) at a fixed 60 Hz with a fighter running at 4 m/s on a
// 1920x1080 view, and checks the owner's rule (2026-10-29: "the player MUST stay centered unless we purposely
// move off screen to look somewhere else"):
//   · locked is the default mode, and while locked the focus IS your fighter (0 offset) while it runs
//   · brushing an edge for less than the dwell does not move the camera
//   · holding the pointer at an edge (or the arrow keys) peeks: the focus leaves your fighter
//   · letting go glides back and lands on your fighter within peekReturnMaxS, even while it keeps running
//   · minimap / middle-drag scouting snaps back on release; Space (centerOnSelf) recentres at once
//   · semi and free keep their old behaviour (leash; stay where panned)
//
//   node _harness/probe_camera_lock.ts       exit 0 = PASS

import { CAMERA, CameraRig } from '../src/render/camera.ts';
import { defaultSettings, normalizeSettings } from '../src/session/settings.ts';

let fails = 0, passes = 0;
const check = (name: string, ok: boolean, got?: unknown): void => {
  if (ok) { passes++; console.log(`PASS ${name}`); } else { fails++; console.log(`FAIL ${name}${got === undefined ? '' : ` (got ${JSON.stringify(got)})`}`); }
};

const DT = 1 / 60, W = 1920, H = 1080, SPEED = 4;
function rig(): { cam: CameraRig; self: { x: number; z: number }; step: (s: number, run?: boolean) => void; off: () => number } {
  const cam = new CameraRig(W / H);
  cam.setViewport(W, H);
  cam.setBounds(400, 400);
  const self = { x: 100, z: 200 };
  cam.setSelf(self.x, self.z);
  const step = (s: number, run = true): void => {
    for (let t = 0; t < s - 1e-9; t += DT) {
      if (run) self.x += SPEED * DT;
      cam.setSelf(self.x, self.z);
      cam.update(DT);
    }
  };
  const off = (): number => Math.hypot(cam.focus.x - self.x, cam.focus.z - self.z);
  return { cam, self, step, off };
}

// 1 · default + centred while running
{
  const { cam, step, off } = rig();
  check('locked is the default camera mode', cam.mode === 'locked', cam.mode);
  cam.setPointer(W / 2, H / 2, true);
  let worst = 0;
  for (let i = 0; i < 180; i++) { step(DT); worst = Math.max(worst, off()); }
  check('locked: the fighter stays exactly centred while running 3 s', worst < 1e-6, worst);
}

// 2 · an edge brush shorter than the dwell does nothing
{
  const { cam, step, off } = rig();
  cam.setPointer(W - 1, H / 2, true);
  step(CAMERA.peekDwell * 0.6);
  cam.setPointer(W / 2, H / 2, true);
  step(0.2);
  check(`locked: an edge brush shorter than ${CAMERA.peekDwell} s does not move the camera`, off() < 1e-6, off());
}

// 3 · holding an edge peeks, letting go glides back within peekReturnMaxS while still running
{
  const { cam, step, off } = rig();
  cam.setPointer(W - 1, H / 2, true);
  step(1.0);
  const peek = off();
  check('locked: holding the pointer at the right edge for 1 s looks away (> 10 m)', peek > 10, +peek.toFixed(2));
  cam.setPointer(W / 2, H / 2, true);
  step(0.1);
  const mid = off();
  check('locked: the return is a glide, not a cut (still off-centre 0.1 s after letting go)', mid > 0.5 && mid < peek, +mid.toFixed(2));
  step(CAMERA.peekReturnMaxS - 0.1 + DT);
  check(`locked: back on the running fighter within ${CAMERA.peekReturnMaxS} s of letting go`, off() < 1e-6, off());
  let worst = 0;
  for (let i = 0; i < 60; i++) { step(DT); worst = Math.max(worst, off()); }
  check('locked: stays exactly centred after the peek', worst < 1e-6, worst);
}

// 4 · arrow keys peek too, and return
{
  const { cam, step, off } = rig();
  cam.setPointer(W / 2, H / 2, true);
  cam.setKeyPan(0, -1);
  step(0.5);
  check('locked: arrow keys look away', off() > 5, +off().toFixed(2));
  cam.setKeyPan(0, 0);
  step(CAMERA.peekReturnMaxS + DT);
  check('locked: back on the fighter after the arrow keys are released', off() < 1e-6, off());
}

// 5 · scouting (minimap drag / middle drag) and Space
{
  const { cam, step, off } = rig();
  cam.setPointer(W / 2, H / 2, true);
  cam.scout(true);
  cam.focusOn(300, 100);
  step(0.5);
  check('scouting holds the view where the minimap / middle drag put it', off() > 50, +off().toFixed(1));
  cam.scout(false);
  step(DT);
  check('releasing the scout returns to the fighter at once', off() < 1e-6, off());
  cam.setPointer(W - 1, H / 2, true);
  step(0.6);
  cam.centerOnSelf();
  cam.setPointer(W / 2, H / 2, true);
  step(DT);
  check('Space (centerOnSelf) recentres a peek at once', off() < 1e-6, off());
}

// 6 · semi and free unchanged
{
  const { cam, step, off } = rig();
  cam.setMode('semi');
  cam.setPointer(W - 1, H / 2, true);
  step(1.0, false);
  check(`semi: an edge pan is held to the ${CAMERA.leash} m leash`, Math.abs(off() - CAMERA.leash) < 0.01, +off().toFixed(2));
  const f = rig();
  f.cam.setMode('free');
  f.cam.setPointer(W - 1, H / 2, true);
  f.step(0.5, false);
  const gone = f.off();
  f.cam.setPointer(W / 2, H / 2, true);
  f.step(1.0, false);
  check('free: the view stays where you panned it', gone > 5 && Math.abs(f.off() - gone) < 1e-6, [+gone.toFixed(2), +f.off().toFixed(2)]);
}

// 7 · settings: locked by default; a save from before the locked default locks once; a deliberate unlock is kept
{
  const d = defaultSettings();
  check('settings: cameraLock defaults to true', d.controls.cameraLock === true, d.controls.cameraLock);
  const old = JSON.parse(JSON.stringify(d)); old.controls.cameraLock = false; delete old.controls.cameraLockChosen;
  check('settings: an old save with the former unlocked default now locks', normalizeSettings(old).controls.cameraLock === true);
  const chose = JSON.parse(JSON.stringify(d)); chose.controls.cameraLock = false; chose.controls.cameraLockChosen = true;
  const n = normalizeSettings(chose);
  check('settings: a player who chose an unlocked camera keeps it (and the choice survives a reload)', n.controls.cameraLock === false && normalizeSettings(JSON.parse(JSON.stringify(n))).controls.cameraLock === false);
}

console.log(`probe_camera_lock: ${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
