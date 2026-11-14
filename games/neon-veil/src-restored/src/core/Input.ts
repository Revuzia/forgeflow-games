/**
 * Keyboard / mouse input.
 * Pointer lock is preferred (hides cursor) but optional — `engaged` is the
 * real "player is in control" gate so a lock failure never freezes the game.
 */
export class Input {
  keys = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  /** Absolute cursor position (screen px) + normalized offset from screen center
   *  [-1,1]. The free mouse IS the aiming reticle (cursor-aim). */
  mouseX = 0;
  mouseY = 0;
  mouseNX = 0;
  mouseNY = 0;
  mouseButtons = new Set<number>();
  wheel = 0;
  /** True while document.pointerLockElement === canvas */
  pointerLocked = false;
  /**
   * User has clicked CLICK TO ENGAGE (or Enter). Controls + fire work with this
   * even if the browser refuses pointer lock.
   */
  engaged = false;
  /** Last lock error message (for HUD hint), cleared on successful lock */
  lockError: string | null = null;

  private canvas: HTMLCanvasElement;
  private lockRequestInFlight = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('pointerlockchange', this.onLockChange);
    document.addEventListener('pointerlockerror', this.onLockError);
    canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('wheel', this.onWheel, { passive: true });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    document.removeEventListener('pointerlockerror', this.onLockError);
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    this.canvas.removeEventListener('wheel', this.onWheel);
  }

  /** Enter combat control — always succeeds even if pointer lock fails. */
  engage() {
    this.engaged = true;
    // Cursor-aim: no pointer lock — the mouse stays a free, visible reticle.
  }

  /** Leave combat control (Esc / menu / death pause). */
  disengage() {
    this.engaged = false;
    this.releaseLock();
  }

  requestLock() {
    if (document.pointerLockElement === this.canvas) return;
    if (this.lockRequestInFlight) return;
    if (typeof this.canvas.requestPointerLock !== 'function') {
      this.lockError = 'Pointer lock not supported — free-mouse mode';
      return;
    }
    this.lockRequestInFlight = true;
    try {
      const result = this.canvas.requestPointerLock() as void | Promise<void>;
      if (result && typeof (result as Promise<void>).then === 'function') {
        void (result as Promise<void>)
          .then(() => {
            this.lockRequestInFlight = false;
            this.lockError = null;
          })
          .catch((err: unknown) => {
            this.lockRequestInFlight = false;
            const msg = err instanceof Error ? err.message : 'Pointer lock denied';
            this.lockError = `${msg} — free-mouse mode (look still works)`;
            console.warn('[NEON VEIL] pointer lock failed, using free-mouse', err);
          });
      } else {
        // Older browsers: success/fail arrives via pointerlockchange / error
        window.setTimeout(() => {
          this.lockRequestInFlight = false;
          if (document.pointerLockElement !== this.canvas) {
            this.lockError = 'Pointer lock unavailable — free-mouse mode';
          }
        }, 120);
      }
    } catch (err) {
      this.lockRequestInFlight = false;
      this.lockError = 'Pointer lock error — free-mouse mode';
      console.warn('[NEON VEIL] requestPointerLock threw', err);
    }
  }

  releaseLock() {
    if (document.pointerLockElement === this.canvas) {
      try {
        document.exitPointerLock();
      } catch {
        /* ignore */
      }
    }
  }

  endFrame() {
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }

  isDown(code: string) {
    return this.keys.has(code);
  }

  isMouseDown(btn: number) {
    return this.mouseButtons.has(btn);
  }

  /** True when player should steer / shoot */
  isControlActive() {
    return this.engaged;
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.code === 'Tab' || e.code === 'F3') e.preventDefault();
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private onLockChange = () => {
    const locked = document.pointerLockElement === this.canvas;
    const wasLocked = this.pointerLocked;
    this.pointerLocked = locked;
    this.lockRequestInFlight = false;
    if (locked) {
      this.engaged = true;
      this.lockError = null;
    } else if (wasLocked) {
      // User pressed Esc or browser exited lock — pause control
      this.engaged = false;
    }
  };

  private onLockError = () => {
    this.lockRequestInFlight = false;
    this.lockError = 'Pointer lock denied — free-mouse mode (look still works)';
    // Keep engaged so the player is not stuck on the overlay
    console.warn('[NEON VEIL] pointerlockerror — continuing without lock');
  };

  private onMouseDown = (e: MouseEvent) => {
    this.mouseButtons.add(e.button);
    if (this.engaged && !this.pointerLocked) {
      // Re-try lock on later clicks (browser may allow after first gesture)
      this.requestLock();
    }
  };

  private onMouseUp = (e: MouseEvent) => {
    this.mouseButtons.delete(e.button);
  };

  private onMouseMove = (e: MouseEvent) => {
    this.mouseDX += e.movementX;
    this.mouseDY += e.movementY;
    // Absolute cursor → the on-screen reticle + cursor-relative steering.
    this.mouseX = e.clientX;
    this.mouseY = e.clientY;
    this.mouseNX = (e.clientX / window.innerWidth) * 2 - 1;
    this.mouseNY = (e.clientY / window.innerHeight) * 2 - 1;
  };

  private onWheel = (e: WheelEvent) => {
    this.wheel += Math.sign(e.deltaY);
  };
}
