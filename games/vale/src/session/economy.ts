// VALE session — wallet, ledger, ownership, store purchases (CONTRACT §8).
//
// Invariants (checkInvariants returns every violation; probes require none):
//   * every wallet change is a LedgerEntry; wallet[c] === Σ ledger deltas of currency c, and each
//     entry's `balance` is the running sum after it; no balance is ever negative
//   * ownership is an explicit OwnershipRecord, at most one per skin (ref); record ids and ledger
//     txns are unique; a purchase record points at the ledger txn that paid for it
//   * every equipped skin is owned and belongs to that fighter
// In a live deployment these run server-side (RemoteSession); locally they guard the profile.

import type { CatalogT, SkinDefT, StoreDefT } from '../contracts/catalog.ts';
import type { LedgerEntry, OwnershipRecord, Profile } from '../contracts/session.ts';

/** what ledger/ownership writes need from the session */
export interface LedgerCtx {
  nowIso(): string;
  newId(prefix: string): string;
  readonly catalogVersion: string;
}

type Offer = StoreDefT['offers'][number];

/** the currency play grants are paid in: the first `earnedOnly` currency (else the first one) */
export function earnedCurrency(catalog: CatalogT): string | null {
  const cs = catalog.store.currencies;
  return (cs.find((c) => c.earnedOnly) ?? cs[0])?.id ?? null;
}

export function balance(p: Profile, currency: string): number { return p.wallet[currency] ?? 0; }

export function ledgerSum(p: Profile, currency: string): number {
  let s = 0;
  for (const e of p.ledger) if (e.currency === currency) s += e.delta;
  return s;
}

/** append a ledger entry and move the wallet with it (the only way the wallet changes) */
export function addLedger(p: Profile, ctx: LedgerCtx, currency: string, delta: number, reason: LedgerEntry['reason'], ref?: string): LedgerEntry {
  if (!Number.isInteger(delta)) throw new Error(`ledger: delta must be an integer (got ${delta})`);
  const bal = balance(p, currency) + delta;
  if (bal < 0) throw new Error(`ledger: ${currency} would go negative (${bal})`);
  const e: LedgerEntry = { txn: ctx.newId('txn'), at: ctx.nowIso(), currency, delta, balance: bal, reason };
  if (ref !== undefined) e.ref = ref;
  p.ledger.push(e);
  p.wallet[currency] = bal;
  return e;
}

export function ownsSkin(p: Profile, skin: string): boolean { return p.owned.some((o) => o.kind === 'skin' && o.ref === skin); }

export function addOwnership(p: Profile, ctx: LedgerCtx, r: { sku: string; skin: SkinDefT; source: OwnershipRecord['source']; txn?: string; price?: { currency: string; amount: number } }): OwnershipRecord {
  if (ownsSkin(p, r.skin.id)) throw new Error(`ownership: '${r.skin.id}' is already owned`);
  const rec: OwnershipRecord = {
    id: ctx.newId('own'), sku: r.sku, kind: 'skin', ref: r.skin.id, fighter: r.skin.fighter,
    acquiredAt: ctx.nowIso(), source: r.source, catalogVersion: ctx.catalogVersion,
  };
  if (r.txn) rec.txn = r.txn;
  if (r.price) rec.price = { ...r.price };
  p.owned.push(rec);
  return rec;
}

/** own every store.starterOwnership skin not owned yet (idempotent; new fighters' base skins arrive with a catalog update) */
export function grantStarterSkins(p: Profile, catalog: CatalogT, ctx: LedgerCtx): number {
  let n = 0;
  for (const id of catalog.store.starterOwnership) {
    const skin = catalog.skins.find((s) => s.id === id);
    if (!skin || ownsSkin(p, id)) continue;
    addOwnership(p, ctx, { sku: `starter:${id}`, skin, source: 'starter' });
    n++;
  }
  return n;
}

/** the starter wallet, once, at profile creation */
export function grantStarterWallet(p: Profile, catalog: CatalogT, ctx: LedgerCtx): void {
  for (const [currency, amount] of Object.entries(catalog.store.starterWallet)) {
    if (amount > 0) addLedger(p, ctx, currency, amount, 'starter');
    else p.wallet[currency] = p.wallet[currency] ?? 0;
  }
  for (const c of catalog.store.currencies) p.wallet[c.id] = p.wallet[c.id] ?? 0;
}

/** an offer's [from, until) window contains `wallMs` (missing ends are open) */
export function offerAvailable(o: Offer, wallMs: number): boolean {
  if (o.from) { const t = Date.parse(o.from); if (Number.isFinite(t) && wallMs < t) return false; }
  if (o.until) { const t = Date.parse(o.until); if (Number.isFinite(t) && wallMs >= t) return false; }
  return true;
}

export type PurchaseResult = { ok: true; record: OwnershipRecord } | { ok: false; reason: 'unknown_sku' | 'owned' | 'funds' | 'unavailable' };

/** CONTRACT §8: offer exists and is in its window → not owned → funds → ledger −price → ownership record */
export function purchase(p: Profile, catalog: CatalogT, sku: string, ctx: LedgerCtx & { wall(): number }): PurchaseResult {
  const offer = catalog.store.offers.find((o) => o.sku === sku);
  if (!offer) return { ok: false, reason: 'unknown_sku' };
  const skin = offer.kind === 'skin' ? catalog.skins.find((s) => s.id === offer.ref) : undefined;
  if (!skin || !offerAvailable(offer, ctx.wall()) || !catalog.store.currencies.some((c) => c.id === offer.price.currency)) {
    return { ok: false, reason: 'unavailable' };
  }
  if (ownsSkin(p, skin.id)) return { ok: false, reason: 'owned' };
  if (balance(p, offer.price.currency) < offer.price.amount) return { ok: false, reason: 'funds' };
  const e = addLedger(p, ctx, offer.price.currency, -offer.price.amount, 'purchase', sku);
  const record = addOwnership(p, ctx, { sku, skin, source: 'purchase', txn: e.txn, price: { ...offer.price } });
  return { ok: true, record };
}

export function equipSkin(p: Profile, catalog: CatalogT, fighter: string, skin: string): { ok: boolean; reason?: string } {
  const def = catalog.skins.find((s) => s.id === skin);
  if (!def) return { ok: false, reason: 'unknown_skin' };
  if (def.fighter !== fighter) return { ok: false, reason: 'wrong_fighter' };
  if (!ownsSkin(p, skin)) return { ok: false, reason: 'not_owned' };
  p.equipped[fighter] = skin;
  return { ok: true };
}

/** the skin a profile wears for a fighter: equipped if owned, else an owned base skin, else any owned, else the first base */
export function wornSkin(p: Profile, catalog: CatalogT, fighter: string): string | null {
  const eq = p.equipped[fighter];
  if (eq && ownsSkin(p, eq) && catalog.skins.some((s) => s.id === eq && s.fighter === fighter)) return eq;
  const mine = catalog.skins.filter((s) => s.fighter === fighter);
  return (mine.find((s) => s.tier === 'base' && ownsSkin(p, s.id)) ?? mine.find((s) => ownsSkin(p, s.id))
    ?? mine.find((s) => s.tier === 'base') ?? mine[0])?.id ?? null;
}

/** every invariant violation (empty = healthy) */
export function checkInvariants(p: Profile, catalog?: CatalogT): string[] {
  const out: string[] = [];
  const currencies = new Set<string>([...Object.keys(p.wallet), ...p.ledger.map((e) => e.currency)]);
  for (const c of currencies) {
    let run = 0;
    for (const e of p.ledger) {
      if (e.currency !== c) continue;
      run += e.delta;
      if (e.balance !== run) out.push(`ledger ${e.txn}: balance ${e.balance} ≠ running sum ${run}`);
      if (run < 0) out.push(`ledger ${e.txn}: ${c} negative (${run})`);
    }
    if ((p.wallet[c] ?? 0) !== run) out.push(`wallet ${c} = ${p.wallet[c] ?? 0} ≠ ledger sum ${run}`);
  }
  const txns = new Set<string>();
  for (const e of p.ledger) { if (txns.has(e.txn)) out.push(`ledger txn ${e.txn} duplicated`); txns.add(e.txn); }
  const refs = new Set<string>(), ids = new Set<string>();
  for (const o of p.owned) {
    if (refs.has(o.ref)) out.push(`ownership: '${o.ref}' owned twice`);
    refs.add(o.ref);
    if (ids.has(o.id)) out.push(`ownership record id ${o.id} duplicated`);
    ids.add(o.id);
    if (o.source === 'purchase') {
      const e = p.ledger.find((x) => x.txn === o.txn);
      if (!e) out.push(`ownership ${o.id}: purchase without a ledger txn`);
      else if (e.reason !== 'purchase' || -e.delta !== o.price?.amount || e.currency !== o.price?.currency) out.push(`ownership ${o.id}: txn ${e.txn} does not pay its price`);
    }
    if (catalog) {
      const s = catalog.skins.find((x) => x.id === o.ref);
      if (s && s.fighter !== o.fighter) out.push(`ownership ${o.id}: fighter ${o.fighter} ≠ skin's ${s.fighter}`);
    }
  }
  for (const [f, s] of Object.entries(p.equipped)) {
    if (!refs.has(s)) out.push(`equipped ${f} → '${s}' is not owned`);
    if (catalog) {
      const d = catalog.skins.find((x) => x.id === s);
      if (d && d.fighter !== f) out.push(`equipped ${f} → '${s}' belongs to ${d.fighter}`);
    }
  }
  return out;
}
