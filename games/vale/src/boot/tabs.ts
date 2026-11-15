// VALE boot — one tab plays at a time (W1-E, TECH-08). A Web Lock named 'vale-profile' is held for the life of the
// page that owns the profile. A second tab finds it taken and offers "Play here", which steals it; the first tab's
// held request then rejects (AbortError) and it shows the moved plate. Without navigator.locks (old Safari) the store's
// rev guard (session/profile_store.ts) still keeps a second tab from overwriting anything.

export const LOCK_NAME = 'vale-profile';
type Locks = { request(name: string, opts: { ifAvailable?: boolean; steal?: boolean }, cb: (lock: unknown) => Promise<void> | void): Promise<unknown> };
const locks = (): Locks | null => (typeof navigator !== 'undefined' ? (navigator as unknown as { locks?: Locks }).locks ?? null : null);

export const tabLocksSupported = (): boolean => locks() !== null;

function hold(opts: { ifAvailable?: boolean; steal?: boolean }, onLost: () => void): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const l = locks();
    if (!l) { resolve(true); return; }
    let granted = false;
    let p: Promise<unknown>;
    try {
      p = l.request(LOCK_NAME, opts, (lock) => {
        if (!lock) { resolve(false); return undefined; }
        granted = true;
        resolve(true);
        return new Promise<void>(() => { /* held until the page goes, or until another tab steals it */ });
      });
    } catch { resolve(true); return; }
    p.catch(() => { if (granted) onLost(); else resolve(true); });   // stolen (AbortError) / a browser that refuses: never block play
  });
}

/** true = this tab owns the profile (or locks are unavailable); false = another tab holds it */
export const acquireTab = (onLost: () => void): Promise<boolean> => hold({ ifAvailable: true }, onLost);
/** take the lock from the other tab */
export const stealTab = (onLost: () => void): Promise<boolean> => hold({ steal: true }, onLost);
