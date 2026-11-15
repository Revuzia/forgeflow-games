// app fix group: node probe for Input (A3 hit-stop buffer window, PC-08 movement live across ui→game).
import { Input } from '../../../src/core/input.ts';
import { INPUT_BUFFER_S, SIM_DT } from '../../../src/core/config.ts';

let now = 1000;
(globalThis as any).performance = { now: () => now };
class FakeWin extends EventTarget { document = Object.assign(new EventTarget(), { hidden: false, timeline: null }); navigator = {}; }
const win = new FakeWin() as unknown as Window;
const key = (type: string, code: string) => { const e = new Event(type) as any; e.code = code; e.key = code; e.repeat = false; win.dispatchEvent(e); };
const out: Record<string, unknown> = {};

// A3: a HOOK press 0.21 s before the next slowed tick (hit-stop tick spacing = SIM_DT/0.15 = 0.222 s)
const inp = new Input(win);
inp.mode = 'game';
key('keydown', 'Space'); key('keyup', 'Space');
now += 210;
out.default_window_press_210ms_consumed = inp.titanInput().ability;
inp.bufferS = Math.max(INPUT_BUFFER_S, SIM_DT / 0.15 + 0.02);
key('keydown', 'Space'); key('keyup', 'Space');
now += 210;
out.hitstop_window_s = +inp.bufferS.toFixed(3);
out.hitstop_window_press_210ms_consumed = inp.titanInput().ability;
inp.bufferS = INPUT_BUFFER_S;
key('keydown', 'Space'); key('keyup', 'Space');
now += 5000;
out.stale_press_5s_consumed = inp.titanInput().ability;   // must stay false (no stale hooks)

// PC-08: hold D through ui (pause/draft) → game
key('keydown', 'KeyD');
out.moving_before = inp.titanInput().mx !== 0 || inp.titanInput().mz !== 0;
inp.mode = 'ui';
out.ui_stick_zero = inp.stick().x === 0;
inp.mode = 'game';
const ti = inp.titanInput();
out.moving_after_resume_no_repress = ti.mx !== 0 || ti.mz !== 0;
// Space held through a draft (the key that picked a card) must stay dead after resume
key('keydown', 'Space');
inp.mode = 'ui';
inp.mode = 'game';
inp.update();
const t2 = inp.titanInput();
out.space_held_through_ui_is_dead = t2.abilityHeld === false && t2.ability === false;
// a movement key pressed fresh inside the ui (e.g. arrows to move the draft focus) and still held
key('keyup', 'KeyD'); key('keyup', 'Space');
inp.mode = 'ui';
key('keydown', 'ArrowLeft');
inp.mode = 'game';
out.fresh_arrow_in_ui_moves_after = inp.stick().x < 0;
key('keyup', 'ArrowLeft');
out.released_stops = inp.stick().x === 0;
console.log(JSON.stringify(out, null, 1));
