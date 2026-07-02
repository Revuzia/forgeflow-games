// Keyboard + mouse input. Polled by systems each tick; edge-detection helpers included.

const down = new Set();        // currently-held codes
const pressed = new Set();     // went down since last tick consume
const released = new Set();    // went up since last tick consume

export const mouse = {
  x: 0, y: 0,            // CSS px, relative to canvas
  worldX: 0, worldY: 0,   // filled by camera each tick
  left: false, right: false,
  leftPressed: false, rightPressed: false,
  wheel: 0,               // accumulated wheel delta since last consume
};

// Rebindable action map (code → action). Kept simple: actions read via helpers below.
export const binds = {
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  jump: ['Space'],
  inventory: ['KeyE'],
  interact: ['KeyF'],
  pause: ['Escape'],
  hotbar: ['Digit1','Digit2','Digit3','Digit4','Digit5','Digit6','Digit7','Digit8','Digit9','Digit0'],
};

export function isDown(action) {
  return binds[action]?.some(c => down.has(c)) ?? false;
}
export function wasPressed(action) {
  return binds[action]?.some(c => pressed.has(c)) ?? false;
}
export function hotbarPressed() {
  // returns 0-9 slot index or -1
  for (let i = 0; i < binds.hotbar.length; i++) if (pressed.has(binds.hotbar[i])) return i;
  return -1;
}
export function anyPressed() { return pressed.size > 0 || mouse.leftPressed || mouse.rightPressed; }

// Called once per tick AFTER all updaters have read input.
export function consumeTick() {
  pressed.clear();
  released.clear();
  mouse.leftPressed = false;
  mouse.rightPressed = false;
  mouse.wheel = 0;
}

export function initInput(canvas) {
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    down.add(e.code);
    pressed.add(e.code);
    // stop the browser stealing game keys (space scroll, etc.)
    if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Tab'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    down.delete(e.code);
    released.add(e.code);
  });
  window.addEventListener('blur', () => down.clear());

  canvas.addEventListener('mousemove', (e) => {
    const r = canvas.getBoundingClientRect();
    mouse.x = e.clientX - r.left;
    mouse.y = e.clientY - r.top;
  });
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) { mouse.left = true; mouse.leftPressed = true; }
    if (e.button === 2) { mouse.right = true; mouse.rightPressed = true; }
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) mouse.left = false;
    if (e.button === 2) mouse.right = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => { mouse.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
}
