// Keyboard + mouse + virtual joystick input

export function createInput(container) {
  const keys = new Set();
  const state = {
    moveX: 0,
    moveZ: 0,
    aimX: 0,
    aimZ: 1,
    attack: false,
    attackHeld: false,
    ability1: false,
    ability2: false,
    ability3: false,
    modeSwap: false,
    block: false,
    heal: false,
    pause: false,
    pointerNdc: { x: 0, y: 0 },
    hasPointer: false,
  };

  const edge = {
    attack: false,
    ability1: false,
    ability2: false,
    ability3: false,
    modeSwap: false,
    heal: false,
    pause: false,
  };

  // Virtual joystick
  const joyZone = document.getElementById('joystick-zone');
  const joyKnob = document.getElementById('joy-knob');
  const joyBase = document.getElementById('joy-base');
  let joyActive = false;
  let joyId = null;
  let joyCx = 0;
  let joyCy = 0;
  let joyVX = 0;
  let joyVZ = 0;
  const JOY_R = 40;

  function setJoyVisual(dx, dy) {
    if (!joyKnob) return;
    joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  function onJoyStart(e, id, x, y) {
    joyActive = true;
    joyId = id;
    const rect = joyBase.getBoundingClientRect();
    joyCx = rect.left + rect.width / 2;
    joyCy = rect.top + rect.height / 2;
    onJoyMove(x, y);
  }

  function onJoyMove(x, y) {
    if (!joyActive) return;
    let dx = x - joyCx;
    let dy = y - joyCy;
    const len = Math.hypot(dx, dy) || 1;
    const cl = Math.min(len, JOY_R);
    dx = (dx / len) * cl;
    dy = (dy / len) * cl;
    setJoyVisual(dx, dy);
    joyVX = dx / JOY_R;
    joyVZ = dy / JOY_R;
  }

  function onJoyEnd() {
    joyActive = false;
    joyId = null;
    joyVX = 0;
    joyVZ = 0;
    setJoyVisual(0, 0);
  }

  if (joyZone) {
    joyZone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      joyZone.setPointerCapture?.(e.pointerId);
      onJoyStart(e, e.pointerId, e.clientX, e.clientY);
    });
    joyZone.addEventListener('pointermove', (e) => {
      if (joyId === e.pointerId) onJoyMove(e.clientX, e.clientY);
    });
    joyZone.addEventListener('pointerup', (e) => {
      if (joyId === e.pointerId) onJoyEnd();
    });
    joyZone.addEventListener('pointercancel', onJoyEnd);
  }

  // Ability buttons (basic slot supports hold-to-spam for mobile)
  document.querySelectorAll('.ability-btn[data-slot]').forEach((btn) => {
    const slot = btn.getAttribute('data-slot');
    const fire = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (slot === '0') {
        edge.attack = true;
        state.attackHeld = true;
      }
      if (slot === '1') edge.ability1 = true;
      if (slot === '2') edge.ability2 = true;
      if (slot === '3') edge.ability3 = true;
      btn.classList.add('pressed');
    };
    const release = (e) => {
      if (slot === '0') state.attackHeld = false;
      btn.classList.remove('pressed');
    };
    btn.addEventListener('pointerdown', fire);
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointerleave', release);
    btn.addEventListener('pointercancel', release);
  });

  const modeBtn = document.getElementById('mode-btn');
  if (modeBtn) {
    modeBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      edge.modeSwap = true;
    });
  }

  const pauseBtn = document.getElementById('btn-pause');
  if (pauseBtn) {
    pauseBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      edge.pause = true;
    });
  }

  const healBtn = document.getElementById('btn-heal');
  if (healBtn) {
    healBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      edge.heal = true;
    });
  }

  const blockBtn = document.getElementById('block-btn');
  if (blockBtn) {
    blockBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      state.block = true;
      blockBtn.classList.add('active');
    });
    const endBlock = () => {
      state.block = false;
      blockBtn.classList.remove('active');
    };
    blockBtn.addEventListener('pointerup', endBlock);
    blockBtn.addEventListener('pointerleave', endBlock);
    blockBtn.addEventListener('pointercancel', endBlock);
  }

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    keys.add(k);
    if (e.code === 'Space') keys.add('space');
    if (k === 'j' || k === ' ') {
      if (!e.repeat) edge.attack = true;
      state.attackHeld = true;
    }
    if (k === '1' || k === 'u') if (!e.repeat) edge.ability1 = true;
    if (k === '2' || k === 'i') if (!e.repeat) edge.ability2 = true;
    if (k === '3' || k === 'o') if (!e.repeat) edge.ability3 = true;
    if (k === 'q' || k === 'tab') {
      e.preventDefault();
      if (!e.repeat) edge.modeSwap = true;
    }
    if (k === 'h') if (!e.repeat) edge.heal = true;
    if (k === 'shift' || k === 'k') state.block = true;
    if (k === 'escape') if (!e.repeat) edge.pause = true;
  });

  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    keys.delete(k);
    if (e.code === 'Space') keys.delete('space');
    if (k === 'j' || k === ' ') state.attackHeld = false;
    if (k === 'shift' || k === 'k') state.block = false;
  });

  const canvasHost = container;
  canvasHost.addEventListener('pointerdown', (e) => {
    if (e.button === 0 && e.target.tagName === 'CANVAS') {
      edge.attack = true;
      state.attackHeld = true;
    }
    updatePointer(e);
  });
  canvasHost.addEventListener('pointerup', (e) => {
    if (e.button === 0) state.attackHeld = false;
  });
  canvasHost.addEventListener('pointermove', updatePointer);
  canvasHost.addEventListener('contextmenu', (e) => e.preventDefault());

  function updatePointer(e) {
    const rect = canvasHost.getBoundingClientRect();
    state.pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    state.pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    state.hasPointer = true;
  }

  function poll() {
    let mx = 0;
    let mz = 0;
    // WASD + ZQSD (Z/S/D) + arrows. Q is Warrior mode swap (use A/← for left).
    if (keys.has('w') || keys.has('z') || keys.has('arrowup')) mz -= 1;
    if (keys.has('s') || keys.has('arrowdown')) mz += 1;
    if (keys.has('a') || keys.has('arrowleft')) mx -= 1;
    if (keys.has('d') || keys.has('arrowright')) mx += 1;

    mx += joyVX;
    mz += joyVZ;

    const len = Math.hypot(mx, mz);
    if (len > 1) {
      mx /= len;
      mz /= len;
    }
    state.moveX = mx;
    state.moveZ = mz;
    if (len > 0.15) {
      state.aimX = mx;
      state.aimZ = mz;
    }

    state.attack = edge.attack;
    state.ability1 = edge.ability1;
    state.ability2 = edge.ability2;
    state.ability3 = edge.ability3;
    state.modeSwap = edge.modeSwap;
    state.heal = edge.heal;
    state.pause = edge.pause;

    edge.attack = false;
    edge.ability1 = false;
    edge.ability2 = false;
    edge.ability3 = false;
    edge.modeSwap = false;
    edge.heal = false;
    edge.pause = false;

    return state;
  }

  return { poll, state, unlock: () => {} };
}
