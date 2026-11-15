// Meter DO (§O2.5, §O9.3, §O9.3a): one instance, idFromName("meter"). Counts every billable unit the relay
// spends per UTC day, in both counting modes, and admits a match only if its whole estimate fits under the cap.
//   strict    — admission on `raw` (incoming frames + connections + RPCs, counted 1:1) against RAW_CAP (55,000)
//   billing20 — admission on `units` (ceil(frames/20) + connections + RPCs) against DAILY_UNIT_CAP (60,000)
// Both counts are always recorded, so switching COUNT_MODE needs no data migration.
import { DurableObject } from 'cloudflare:workers';
import { countMode, isDev, num, type CountMode, type Env } from './env';
import { utcDay, type Usage } from './proto';

export interface Release {
  day: string;
  units: number;
  raw: number;
}

export interface MeterStatus {
  day: string;
  mode: CountMode;
  units: number;
  raw: number;
  reservedUnits: number;
  reservedRaw: number;
  capUnits: number;
  capRaw: number;
  /** The active mode's figures. */
  used: number;
  reserved: number;
  cap: number;
  open: boolean;
  writes: number;
}

export interface AdmitResult {
  ok: boolean;
  day: string;
  status: MeterStatus;
}

interface Row {
  units: number;
  raw: number;
  res_units: number;
  res_raw: number;
}

const KEEP_DAYS = 14;

export class Meter extends DurableObject<Env> {
  /** RPCs this object served since its last write; folded into the next write (status() never writes). */
  private selfRpc = 0;
  private prunedDay = '';
  private writes = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS day(utc TEXT PRIMARY KEY, units INTEGER NOT NULL DEFAULT 0, raw INTEGER NOT NULL DEFAULT 0, res_units INTEGER NOT NULL DEFAULT 0, res_raw INTEGER NOT NULL DEFAULT 0)',
    );
  }

  private capUnits(): number {
    return num(this.env, 'DAILY_UNIT_CAP', 60000);
  }
  private capRaw(): number {
    return num(this.env, 'RAW_CAP', 55000);
  }

  private row(day: string): Row {
    const rows = this.ctx.storage.sql
      .exec<{ units: number; raw: number; res_units: number; res_raw: number }>(
        'SELECT units, raw, res_units, res_raw FROM day WHERE utc = ?',
        day,
      )
      .toArray();
    const r = rows[0];
    return r
      ? { units: Number(r.units), raw: Number(r.raw), res_units: Number(r.res_units), res_raw: Number(r.res_raw) }
      : { units: 0, raw: 0, res_units: 0, res_raw: 0 };
  }

  private snapshot(day: string = utcDay()): MeterStatus {
    const r = this.row(day);
    const mode = countMode(this.env);
    const units = r.units + this.selfRpc;
    const raw = r.raw + this.selfRpc;
    const capUnits = this.capUnits();
    const capRaw = this.capRaw();
    const used = mode === 'strict' ? raw : units;
    const reserved = mode === 'strict' ? r.res_raw : r.res_units;
    const cap = mode === 'strict' ? capRaw : capUnits;
    return {
      day,
      mode,
      units,
      raw,
      reservedUnits: r.res_units,
      reservedRaw: r.res_raw,
      capUnits,
      capRaw,
      used,
      reserved,
      cap,
      open: used + reserved < cap,
      writes: this.writes,
    };
  }

  /** One upsert per touched day row (≤ 2). Negative reservation deltas are clamped at 0. */
  private upsert(day: string, units: number, raw: number, resUnits: number, resRaw: number): void {
    this.ctx.storage.sql.exec(
      'INSERT INTO day(utc, units, raw, res_units, res_raw) VALUES (?, ?, ?, MAX(0, ?), MAX(0, ?)) ' +
        'ON CONFLICT(utc) DO UPDATE SET units = units + excluded.units, raw = raw + excluded.raw, ' +
        'res_units = MAX(0, res_units + ?), res_raw = MAX(0, res_raw + ?)',
      day,
      Math.round(units),
      Math.round(raw),
      Math.round(resUnits),
      Math.round(resRaw),
      Math.round(resUnits),
      Math.round(resRaw),
    );
    this.writes++;
  }

  private apply(add: Usage | null | undefined, release: Release | null | undefined, reserve?: Usage): void {
    const today = utcDay();
    if (this.prunedDay !== today) {
      const cutoff = utcDay(Date.now() - KEEP_DAYS * 86400_000);
      this.ctx.storage.sql.exec('DELETE FROM day WHERE utc < ?', cutoff);
      this.prunedDay = today;
    }
    const addU = Math.max(0, add?.units ?? 0) + this.selfRpc;
    const addR = Math.max(0, add?.raw ?? 0) + this.selfRpc;
    this.selfRpc = 0;
    let resU = reserve ? Math.max(0, reserve.units) : 0;
    let resR = reserve ? Math.max(0, reserve.raw) : 0;
    if (release && (release.units > 0 || release.raw > 0)) {
      if (release.day === today) {
        resU -= Math.max(0, release.units);
        resR -= Math.max(0, release.raw);
      } else if (typeof release.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(release.day)) {
        this.upsert(release.day, 0, 0, -Math.max(0, release.units), -Math.max(0, release.raw));
      }
    }
    if (addU || addR || resU || resR) this.upsert(today, addU, addR, resU, resR);
  }

  // ---------------- RPC ----------------

  status(): MeterStatus {
    this.selfRpc++;
    return this.snapshot();
  }

  /** Usage flush (Room every 60 s while live, Lobby at launches). `release` returns part of a reservation. */
  add(add: Usage, release?: Release | null): MeterStatus {
    this.selfRpc++;
    this.apply(add, release ?? null);
    return this.snapshot();
  }

  /**
   * §O2.5 admission: succeeds only if, for the active mode, used + reserved + est ≤ cap; then reserves est.
   * `add` (the caller's pending usage) is recorded first either way.
   */
  admit(est: Usage, add?: Usage | null): AdmitResult {
    this.selfRpc++;
    this.apply(add ?? null, null);
    const s = this.snapshot();
    const need = s.mode === 'strict' ? Math.max(0, est.raw) : Math.max(0, est.units);
    if (s.used + s.reserved + need > s.cap) return { ok: false, day: s.day, status: s };
    this.apply(null, null, est);
    return { ok: true, day: s.day, status: this.snapshot() };
  }

  /** At post / close: release what is left of the reservation and record the final usage. */
  settle(release: Release | null, add: Usage): MeterStatus {
    this.selfRpc++;
    this.apply(add, release);
    return this.snapshot();
  }

  /** DEV only (wrangler dev with DEV = "1"): preload today's row for quota tests. */
  devSet(v: { units?: number; raw?: number; reservedUnits?: number; reservedRaw?: number }): MeterStatus {
    if (!isDev(this.env)) throw new Error('dev only');
    const day = utcDay();
    this.ctx.storage.sql.exec(
      'INSERT INTO day(utc, units, raw, res_units, res_raw) VALUES (?, ?, ?, ?, ?) ON CONFLICT(utc) DO UPDATE SET ' +
        'units = excluded.units, raw = excluded.raw, res_units = excluded.res_units, res_raw = excluded.res_raw',
      day,
      Math.round(v.units ?? 0),
      Math.round(v.raw ?? 0),
      Math.round(v.reservedUnits ?? 0),
      Math.round(v.reservedRaw ?? 0),
    );
    this.selfRpc = 0;
    return this.snapshot();
  }
}
