// HIT PARADE — sim units (CONTRACT §2). 1 U = 10 µm, so 1 m = 100000 U. Frame = 1/60 s.
// Positions/velocities are int32 in U and U/frame; gravity in U/frame². Float -> U conversion
// happens ONLY when data is compiled (IEEE multiply + Math.round are exact and identical on every
// engine); the step itself never touches a float.

export const M = 100000;
export const FPS = 60;

/** metres -> U (rounded). Data compile / tests only. */
export function mToU(m: number): number {
  return Math.round(m * M);
}

/** U -> metres. View/UI only (snapshots). */
export function uToM(u: number): number {
  return u / M;
}

/** m/s -> U/frame (rounded). Data compile only. */
export function mpsToUpf(v: number): number {
  return Math.round((v * M) / FPS);
}

/** m/s² -> U/frame² (rounded). Data compile only. */
export function mps2ToUpf2(a: number): number {
  return Math.round((a * M) / (FPS * FPS));
}
