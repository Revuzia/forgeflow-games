// Thin DOM glue: pointer events on the canvas -> App.input (which owns ndc conversion, the raycast through the camera
// and the gesture state machine). Everything touch-hostile the browser would do on its own is switched off here:
// scrolling, pull-to-refresh, double-tap zoom, pinch-zoom of the page, text selection, the context menu.
import type { App } from '../app.ts';

export interface PointerGlueApp { input: App['input']; unlockAudio(): void }

const LINE_PX = 16;

export function attachPointerInput(canvas: HTMLCanvasElement, app: PointerGlueApp): () => void {
  const off: Array<() => void> = [];
  const on = <E extends Event>(t: EventTarget, type: string, fn: (e: E) => void, opts?: AddEventListenerOptions): void => {
    t.addEventListener(type, fn as EventListener, opts);
    off.push(() => t.removeEventListener(type, fn as EventListener, opts));
  };

  const local = (e: PointerEvent): { x: number; y: number } => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const ptype = (e: PointerEvent): 'mouse' | 'touch' | 'pen' => (e.pointerType === 'pen' ? 'pen' : e.pointerType === 'touch' ? 'touch' : 'mouse');

  on<PointerEvent>(canvas, 'pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button > 2) return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch { /* the pointer vanished already: harmless */ }
    const p = local(e);
    app.input.pointerDown({ id: e.pointerId, x: p.x, y: p.y, t: e.timeStamp, button: e.pointerType === 'mouse' ? e.button : 0, type: ptype(e) });
  });

  on<PointerEvent>(canvas, 'pointermove', (e) => {
    const p = local(e);
    if (app.input.isDown(e.pointerId)) {
      // a mouse button released outside the window or over a menu: we never got the pointerup, so end the press now
      if (e.pointerType === 'mouse' && e.buttons === 0) { app.input.pointerUp({ id: e.pointerId, x: p.x, y: p.y, t: e.timeStamp, type: 'mouse' }); return; }
      e.preventDefault();
      app.input.pointerMove({ id: e.pointerId, x: p.x, y: p.y, t: e.timeStamp, type: ptype(e) });
    } else if (e.pointerType === 'mouse' || e.pointerType === 'pen') {
      app.input.hover(p.x, p.y);
    }
  });

  const up = (e: PointerEvent): void => {
    const p = local(e);
    app.input.pointerUp({ id: e.pointerId, x: p.x, y: p.y, t: e.timeStamp, type: ptype(e) });
    app.unlockAudio(); // pointerup counts as a user gesture on desktop browsers; iOS needs touchend/click (see lifecycle.ts)
  };
  on<PointerEvent>(canvas, 'pointerup', up);
  on<PointerEvent>(canvas, 'pointercancel', (e) => { app.input.pointerCancel(e.pointerId); });
  // capture lost without an up (element removed, system gesture, devtools): release cleanly. After a normal pointerup the
  // pointer is already gone from the gesture machine, so this is a no-op then.
  on<PointerEvent>(canvas, 'lostpointercapture', (e) => { app.input.pointerCancel(e.pointerId); });
  on<PointerEvent>(canvas, 'pointerleave', (e) => { if (e.pointerType === 'mouse' && !app.input.isDown(e.pointerId)) app.input.hoverEnd(); });

  on<WheelEvent>(canvas, 'wheel', (e) => {
    e.preventDefault();
    let d = e.deltaY;
    if (e.deltaMode === 1) d *= LINE_PX; else if (e.deltaMode === 2) d *= canvas.clientHeight || 600;
    if (e.ctrlKey) d *= 6; // trackpad pinch arrives as ctrl+wheel with tiny deltas
    app.input.wheel(d);
  }, { passive: false });

  on<Event>(canvas, 'contextmenu', (e) => e.preventDefault());

  // Touch: pointer events do the work; these only stop the browser's own touch behaviour (needs passive:false).
  const stop = (e: Event): void => { if (e.cancelable) e.preventDefault(); };
  on<TouchEvent>(canvas, 'touchstart', stop, { passive: false });
  on<TouchEvent>(canvas, 'touchmove', stop, { passive: false });
  on<TouchEvent>(canvas, 'touchend', (e) => { stop(e); app.unlockAudio(); }, { passive: false });
  // Safari-only pinch-zoom gesture events (touch-action is not enough on older iOS)
  for (const t of ['gesturestart', 'gesturechange', 'gestureend']) on<Event>(document, t, stop, { passive: false });

  return () => { for (const f of off.splice(0)) f(); };
}
