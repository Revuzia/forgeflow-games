// VALE UI — Profile (client_hud §3.11): Overview (display name + Change name, level and XP, the wallet
// with its recent ledger lines, skins owned, record, most played, reset), History (the last 50 matches;
// empty: one drawing, one sentence, one action), Rating (tier emblem, rating, peak, games, next tier,
// placement progress; locked below the ranked level). Reset says exactly what returns to defaults.

import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { LedgerEntry, MatchHistoryEntry } from '../../contracts/session.ts';
import { useApp } from '../app_ctx.ts';
import { Button } from '../components/Button.tsx';
import { Currency } from '../components/Currency.tsx';
import { Icon } from '../components/Glyphs.tsx';
import { confirmDialog } from '../components/Modal.tsx';
import { Portrait } from '../components/Portrait.tsx';
import { RankEmblem } from '../components/RankEmblem.tsx';
import { Screen, Section } from '../components/Screen.tsx';
import { EmptyState } from '../components/States.tsx';
import { Tabs } from '../components/Tabs.tsx';
import { fmtClock, fmtInt, fmtSigned, fmtWhen } from '../format.ts';

const xpToNext = (level: number): number => 100 + 25 * (level - 1);   // CONTRACT §7 grants

export function ProfileScreen(p: { params: Record<string, string> }): JSX.Element {
  const { cv, router, state, overlay, session } = useApp();
  const tab = ['overview', 'history', 'rating'].includes(p.params.tab) ? p.params.tab : 'overview';
  const profile = state.profile.value;
  const rename = (): void => openRename(overlay, cv, profile.identity.displayName, (n) => { session.rename(n); state.toast(cv.t('toast.name_changed', 'Name changed to {name}.', { name: n }), 'ok'); });
  return (
    <Screen title={cv.t('profile.title', 'Profile')}
      foot={<span class="t-body-s muted">{cv.t('profile.storage_note', 'Your profile is saved in this browser only.')} · {cv.t('profile.seen_version', 'Content version {version}', { version: cv.version })}</span>}
      cta={tab === 'overview' ? <Button variant="chalk" size="l" icon="edit" onPress={rename}>{cv.t('profile.rename', 'Change name')}</Button> : null}>
      <Tabs label={cv.t('profile.title', 'Profile')} value={tab} onChange={(id) => router.setParams({ tab: id })} items={[
        { id: 'overview', label: cv.t('profile.tab.overview', 'Overview') },
        { id: 'history', label: cv.t('profile.tab.history', 'History'), badge: profile.history.length },
        { id: 'rating', label: cv.t('profile.tab.rating', 'Rating') },
      ]} />
      <div class="tabpanel">
        {tab === 'overview' ? <Overview /> : tab === 'history' ? <History /> : <Rating />}
      </div>
    </Screen>
  );
}

function openRename(overlay: ReturnType<typeof useApp>['overlay'], cv: ReturnType<typeof useApp>['cv'], current: string, done: (n: string) => void): void {
  overlay.open({ title: cv.t('profile.rename', 'Change name'), size: 's', render: (close) => <RenameForm current={current} onDone={(n) => { done(n); close(); }} onCancel={close} /> });
}

function RenameForm(p: { current: string; onDone: (n: string) => void; onCancel: () => void }): JSX.Element {
  const { cv, sound } = useApp();
  const [v, setV] = useState(p.current);
  const [err, setErr] = useState<string | null>(null);
  const submit = (e?: Event): void => {
    e?.preventDefault();
    const n = v.trim();
    const why = n.length < 2 ? cv.t('error.rename.short', 'Names need at least 2 characters.') : n.length > 16 ? cv.t('error.rename.long', 'Names can be up to 16 characters.') : n === p.current ? cv.t('error.rename.same', 'That is already your name.') : null;
    if (why) { setErr(why); sound.play('error'); return; }
    sound.play('confirm');
    p.onDone(n);
  };
  return (
    <form class="confirm" onSubmit={submit}>
      <div class="confirm__body">
        <label class="field">
          <span class="t-label">{cv.t('profile.name', 'Display name')}</span>
          <input class={`input t-body ${err ? 'is-error' : ''}`} value={v} maxLength={24} autoFocus data-autofocus="" aria-invalid={err ? 'true' : undefined} aria-describedby="rename-hint"
            onInput={(e) => { setV((e.currentTarget as HTMLInputElement).value); setErr(null); }} />
          <span id="rename-hint" class={`t-caption ${err ? 'reason--err' : 'muted'}`}>{err ?? cv.t('profile.name_hint', '2 to 16 characters.')}</span>
        </label>
      </div>
      <div class="confirm__actions">
        <Button variant="quiet" cue="back" onPress={p.onCancel}>{cv.t('common.cancel', 'Cancel')}</Button>
        <Button variant="chalk" type="submit" cue={null}>{cv.t('common.save', 'Save')}</Button>
      </div>
    </form>
  );
}

function ledgerLabel(cv: ReturnType<typeof useApp>['cv'], e: LedgerEntry): string {
  if (e.reason === 'purchase') { const s = cv.skin(cv.offer(e.ref)?.ref); return s ? s.name : cv.t('profile.ledger.purchase', 'Purchase'); }
  const fall: Record<LedgerEntry['reason'], string> = { match_grant: 'Match reward', first_win: 'First win of the day', purchase: 'Purchase', starter: 'Starting Candles', refund: 'Refund', migration: 'Carried over' };
  return cv.t(e.reason === 'first_win' ? 'grant.first_win' : `profile.ledger.${e.reason}`, fall[e.reason]);
}

function Overview(): JSX.Element {
  const { cv, router, state, session, overlay } = useApp();
  const profile = state.profile.value;
  const cur = cv.earnedCurrency();
  const need = xpToNext(profile.level);
  const wins = profile.history.filter((h) => h.won).length;
  const losses = profile.history.length - wins;
  const counts = new Map<string, number>();
  for (const h of profile.history) counts.set(h.fighter, (counts.get(h.fighter) ?? 0) + 1);
  const fav = [...counts].sort((a, b) => b[1] - a[1])[0];
  const favF = cv.fighter(fav?.[0]);
  const owned = profile.owned.filter((o) => o.kind === 'skin' && cv.skin(o.ref)?.tier !== 'base').length;
  const total = cv.c.skins.filter((s) => s.tier !== 'base').length;
  const ledger = [...profile.ledger].reverse().slice(0, 6);
  const reset = (): void => {
    void confirmDialog(overlay, {
      title: cv.t('profile.reset.title', 'Reset your profile'), body: cv.t('profile.reset.body', "This returns your Candles, skins, history and settings to a new account's. It cannot be undone."),
      confirm: cv.t('profile.reset.confirm', 'Reset profile'), cancel: cv.t('profile.reset.cancel', 'Keep my profile'), tone: 'danger',
    }).then((yes) => { if (yes) { session.resetProfile(); state.toast(cv.t('toast.profile_reset', 'Profile reset.'), 'ok'); } });
  };
  return (
    <div class="prof">
      <section class="prof__id plate pad-l stg">
        <span class="prof__avatar"><Icon name="user" size={40} /></span>
        <div class="stack stack--s prof__idtext">
          <h2 class="t-display-m">{profile.identity.displayName}</h2>
          <span class="t-label muted">{cv.t('profile.level', 'Level {n}', { n: profile.level })}</span>
          <div class="bar-line bar-line--gloam" role="progressbar" aria-valuemin={0} aria-valuemax={need} aria-valuenow={profile.xp} aria-label={cv.t('profile.xp', '{xp} of {next} XP to level {n}', { xp: profile.xp, next: need, n: profile.level + 1 })}>
            <span class="bar-line__fill" style={{ width: `${Math.min(100, (profile.xp / need) * 100)}%` }} />
          </div>
          <span class="t-caption muted num">{cv.t('profile.xp', '{xp} of {next} XP to level {n}', { xp: fmtInt(profile.xp), next: fmtInt(need), n: profile.level + 1 })}</span>
        </div>
      </section>
      <div class="prof__grid">
        <Section title={cv.t('profile.wallet', 'Wallet')} class="plate pad-l">
          {cur ? <Currency id={cur.id} amount={profile.wallet[cur.id] ?? 0} size="l" showName /> : null}
          <ul class="ledger ledger--compact">
            {ledger.map((e) => (
              <li class="ledger__row is-in">
                <span class="t-body-s">{ledgerLabel(cv, e)}<span class="t-caption muted"> · {fmtWhen(e.at)}</span></span>
                <span class={`num t-body-s ${e.delta >= 0 ? 'is-up' : 'is-down'}`}>{fmtSigned(e.delta)}</span>
              </li>
            ))}
          </ul>
        </Section>
        <Section title={cv.t('profile.record', 'Record')} class="plate pad-l">
          <dl class="stats stats--2">
            <div><dt class="t-caption">{cv.t('profile.record', 'Record')}</dt><dd class="t-body">{cv.t('profile.record_line', '{wins} wins · {losses} losses', { wins, losses })}</dd></div>
            <div><dt class="t-caption">{cv.t('profile.matches', '{n} matches played', { n: profile.history.length })}</dt><dd class="num">{profile.history.length}</dd></div>
            <div><dt class="t-caption">{cv.t('profile.favourite', 'Most played')}</dt><dd class="t-body">{favF ? <span class="row row--s row--nowrap"><Portrait fighter={favF} size="xs" />{favF.name}</span> : '—'}</dd></div>
            <div><dt class="t-caption">{cv.t('collection.tab.skins', 'Skins')}</dt><dd class="t-body">{cv.t('collection.skins_owned', '{n} of {m} skins owned', { n: owned, m: total })}</dd></div>
          </dl>
          <div class="row"><Button variant="quiet" size="s" iconAfter="arrow" onPress={() => router.go('collection', { tab: 'skins' }, { root: true })}>{cv.t('collection.title', 'Collection')}</Button></div>
        </Section>
      </div>
      <div class="row prof__danger">
        <Button variant="quiet" size="s" icon="reroll" onPress={reset}>{cv.t('profile.reset.title', 'Reset your profile')}</Button>
      </div>
    </div>
  );
}

function History(): JSX.Element {
  const { cv, router, state } = useApp();
  const h = state.profile.value.history;
  if (!h.length) return <EmptyState text={cv.t('profile.history.empty', 'No matches yet. Play one and it will be kept here.')} action={{ label: cv.t('btn.play', 'Play'), run: () => router.go('play', {}, { root: true }) }} />;
  return (
    <div class="hist">
      <table class="hist__table">
        <thead><tr>
          <th class="t-caption">{cv.t('profile.history.col.result', 'Result')}</th>
          <th class="t-caption">{cv.t('profile.history.col.fighter', 'Fighter')}</th>
          <th class="t-caption">{cv.t('profile.history.col.mode', 'Mode')}</th>
          <th class="t-caption num">{cv.t('profile.history.col.kda', 'T / F / A')}</th>
          <th class="t-caption num">{cv.t('profile.history.col.length', 'Length')}</th>
          <th class="t-caption num">{cv.t('profile.history.col.candles', 'Candles')}</th>
          <th class="t-caption">{cv.t('profile.history.col.when', 'When')}</th>
        </tr></thead>
        <tbody>{h.map((m) => <HistRow m={m} />)}</tbody>
      </table>
      {h.length >= 50 ? <p class="t-caption muted">{cv.t('profile.history.capped', 'Showing your last {n} matches.', { n: 50 })}</p> : null}
    </div>
  );
}

function HistRow(p: { m: MatchHistoryEntry }): JSX.Element {
  const { cv } = useApp();
  const m = p.m;
  const mode = cv.mode(m.mode);
  const q = cv.queue(m.queue);
  const ffa = cv.isFfa(mode);
  const f = cv.fighter(m.fighter);
  const candles = Object.values(m.grants.currency).reduce((a, b) => a + b, 0);
  return (
    <tr class={`hrow ${ffa ? 'is-place' : m.won ? 'is-win' : 'is-loss'}`}>
      <td><span class="hrow__res t-label">{ffa ? cv.t('profile.history.placed', '{ord} of {total}', { ord: cv.ordinal(m.placement), total: cv.seatsOf(mode) }) : m.won ? cv.t('profile.history.won', 'Victory') : cv.t('profile.history.lost', 'Defeat')}</span>
        {m.ratingDelta !== undefined ? <span class="t-caption muted"> {cv.t('profile.history.rating_delta', 'Rating {delta}', { delta: fmtSigned(m.ratingDelta) })}</span> : null}</td>
      <td><span class="row row--s row--nowrap"><Portrait fighter={f} skin={m.skin} size="xs" /><span class="t-body-s">{f?.name}</span></span></td>
      <td class="t-body-s">{mode?.name}<span class="muted"> · {q?.name}</span></td>
      <td class="num">{m.kills} / {m.deaths} / {m.assists}</td>
      <td class="num">{fmtClock(m.duration)}</td>
      <td class="num">{candles ? `+${fmtInt(candles)}` : '—'}</td>
      <td class="t-caption muted">{fmtWhen(m.at)}</td>
    </tr>
  );
}

function Rating(): JSX.Element {
  const { cv, router, state } = useApp();
  const profile = state.profile.value;
  const qs = cv.rankedQueues();
  if (!qs.length) return <EmptyState text={cv.t('profile.rating.none', 'Play ranked RIFT to get a rating.')} />;
  const tiers = [...cv.c.ranks].sort((a, b) => a.minRating - b.minRating);
  return (
    <div class="stack stack--l">
      {qs.map((q) => {
        const rec = profile.ratings[q.ranked!.ratingId];
        const tier = cv.ratingTier(rec);
        const locked = q.unlockLevel > profile.level;
        const next = tier ? tiers[tiers.findIndex((t) => t.id === tier.id) + 1] : undefined;
        return (
          <section class="plate pad-l rating stg" aria-label={q.name}>
            <RankEmblem tier={tier} provisional={!tier} size={128} art />
            <div class="stack stack--s">
              <span class="t-label muted">{cv.mode(q.mode)?.name} · {q.name}</span>
              {locked ? <p class="t-body locknote"><Icon name="lock" size={16} />{cv.t('profile.rating.locked', 'Reach level {level} to play Ranked.', { level: q.unlockLevel })}</p>
                : !rec ? <><p class="t-body">{cv.t('profile.rating.none', 'Play ranked RIFT to get a rating.')}</p><div><Button variant="secondary" onPress={() => router.go('play', { mode: q.mode, queue: q.id }, { root: true })}>{cv.t('btn.play', 'Play')}</Button></div></>
                  : <>
                    <h2 class="t-display-m">{tier ? tier.name : cv.t('profile.rating.provisional', 'Placing · {n} of {m} matches played', { n: rec.games, m: q.ranked!.placementGames })}</h2>
                    <dl class="stats stats--4">
                      <div><dt class="t-caption">{cv.t('profile.rating.title', 'Rating')}</dt><dd class="num">{tier ? fmtInt(rec.rating) : '—'}</dd></div>
                      <div><dt class="t-caption">{cv.t('profile.rating.peak', 'Peak {n}', { n: '' }).trim()}</dt><dd class="num">{fmtInt(rec.peak)}</dd></div>
                      <div><dt class="t-caption">{cv.t('profile.rating.games', '{n} ranked matches', { n: '' }).trim()}</dt><dd class="num">{rec.games}</dd></div>
                      <div><dt class="t-caption">{cv.t('profile.record', 'Record')}</dt><dd class="num">{rec.wins} / {rec.games - rec.wins}</dd></div>
                    </dl>
                    <p class="t-body-s muted">{tier && next ? cv.t('profile.rating.next', '{n} rating to {tier}', { n: fmtInt(Math.max(0, next.minRating - rec.rating)), tier: next.name }) : tier ? cv.t('profile.rating.top', 'You are at the top tier.') : ''}</p>
                  </>}
            </div>
          </section>
        );
      })}
      <section class="tiers stg" aria-label={cv.t('profile.rating.tier', 'Tier')}>
        <p class="t-body-s muted">{cv.t('profile.rating.scale', 'Tiers climb with the sun, from Lamplit to Unshadowed.')}</p>
        <div class="tiers__row">
          {tiers.map((t) => <span class="tiers__t"><RankEmblem tier={t} size={48} /><span class="t-caption">{t.name}</span><span class="t-caption muted num">{fmtInt(t.minRating)}</span></span>)}
        </div>
      </section>
    </div>
  );
}
