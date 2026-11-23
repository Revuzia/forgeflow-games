// Meter DO: one instance (idFromName("meter")). Counts what this relay spends per UTC day, in both counting modes,
// so switching COUNT_MODE needs no migration. Rooms report in batches (about once a minute while busy), so the
// meter costs a handful of DO requests per match, not one per message.
import { DurableObject } from 'cloudflare:workers';
import { num, utcDay, type Env } from './env';

export interface MeterStatus {
  day: string;
  mode: 'strict' | 'billing20';
  msgs: number;
  conns: number;
  raw: number;
  units: number;
  cap: number;
  used: number;
  open: boolean;
}

export class Meter extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS day(utc TEXT PRIMARY KEY, msgs INTEGER NOT NULL DEFAULT 0, conns INTEGER NOT NULL DEFAULT 0)',
    );
  }

  private row(day: string): { msgs: number; conns: number } {
    const r = this.ctx.storage.sql.exec('SELECT msgs, conns FROM day WHERE utc = ?', day).toArray()[0] as
      | { msgs: number; conns: number }
      | undefined;
    return r ?? { msgs: 0, conns: 0 };
  }

  async status(): Promise<MeterStatus> {
    const day = utcDay();
    const { msgs, conns } = this.row(day);
    const mode = this.env.COUNT_MODE === 'billing20' ? 'billing20' : 'strict';
    // +1 per report: the room's own RPC to this object is a DO request too
    const raw = msgs + conns;
    const units = Math.ceil(msgs / 20) + conns;
    const cap = mode === 'strict' ? num(this.env, 'RAW_CAP', 20000) : num(this.env, 'UNIT_CAP', 20000);
    const used = mode === 'strict' ? raw : units;
    return { day, mode, msgs, conns, raw, units, cap, used, open: used < cap };
  }

  /** A room's batch: incoming messages and new connections since its last report. */
  async add(msgs: number, conns: number): Promise<void> {
    const day = utcDay();
    this.ctx.storage.sql.exec(
      'INSERT INTO day(utc, msgs, conns) VALUES(?, ?, ?) ON CONFLICT(utc) DO UPDATE SET msgs = msgs + excluded.msgs, conns = conns + excluded.conns',
      day,
      Math.max(0, msgs | 0),
      Math.max(0, conns | 0) + 1,
    );
    // keep two weeks
    const cut = utcDay(Date.now() - 14 * 86400e3);
    this.ctx.storage.sql.exec('DELETE FROM day WHERE utc < ?', cut);
  }

  /** DEV only (the Worker guards the route): set today's counts. */
  async devSet(msgs: number, conns: number): Promise<MeterStatus> {
    this.ctx.storage.sql.exec(
      'INSERT INTO day(utc, msgs, conns) VALUES(?, ?, ?) ON CONFLICT(utc) DO UPDATE SET msgs = excluded.msgs, conns = excluded.conns',
      utcDay(),
      msgs,
      conns,
    );
    return this.status();
  }
}
