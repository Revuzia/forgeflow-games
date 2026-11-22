// VALE UI — Friend room (net.ts FRIEND ROOMS): a private room on the game server with a short code. Not in a room: join
// one by code, or start one. In a room: the code and an invite link to share, who is here, the host's choice of game
// and side (one team together, or against each other), and Start match (host only). Open seats are filled when the match
// starts, as in matchmaking. The room stays after the match: Play again on the post-game comes back here.

import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { QueueDefT } from '../../contracts/catalog.ts';
import { FRIEND_CODE_LEN, FRIEND_ROOM_KINDS } from '../../contracts/net.ts';
import { useApp } from '../app_ctx.ts';
import type { CatalogView } from '../catalog_view.ts';
import { Button } from '../components/Button.tsx';
import { Icon } from '../components/Glyphs.tsx';
import { Screen, Section } from '../components/Screen.tsx';
import { Segmented } from '../components/Select.tsx';

/** queues a friend room may play, in the live modes (optionally one mode's) */
export function friendQueues(cv: CatalogView, modeId?: string | null): QueueDefT[] {
  const live = cv.c.client.modeSlots.filter((s) => s.mode && s.status === 'live' && cv.mode(s.mode)).map((s) => s.mode!);
  const modes = modeId ? live.filter((m) => m === modeId) : live;
  return modes.flatMap((m) => cv.queuesOf(m)).filter((q) => (FRIEND_ROOM_KINDS as readonly string[]).includes(q.kind));
}

/** the friend room a mode starts with: its standard queue, else its first friend queue */
export function defaultFriendQueue(cv: CatalogView, modeId?: string | null): QueueDefT | undefined {
  const qs = friendQueues(cv, modeId);
  return qs.find((q) => q.kind === 'standard') ?? qs[0] ?? friendQueues(cv)[0];
}

/** the link a friend opens to land in this room (the site's game page forwards ?room= into the game) */
export function inviteLink(code: string): string {
  let base = '';
  try {
    if (window.top !== window && document.referrer) base = `${new URL(document.referrer).origin}/games/vale/`;
    else base = `${location.origin}${location.pathname}`;
  } catch { base = 'https://forgeflowgames.com/games/vale/'; }
  return `${base}?room=${encodeURIComponent(code)}`;
}

const cleanCode = (v: string): string => v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, FRIEND_CODE_LEN);

/** the code box + Join (Play screen and the room screen share it) */
export function JoinCode(p: { autoFocus?: boolean }): JSX.Element {
  const { cv, state } = useApp();
  const [code, setCode] = useState('');
  const online = state.online.value?.status === 'online';
  const ok = code.length === FRIEND_CODE_LEN && online;
  const join = (): void => { if (ok) state.joinFriendRoom(code); };
  return (
    <form class="joincode" onSubmit={(e) => { e.preventDefault(); join(); }}>
      <label class="t-label joincode__label" for="joincode-input">{cv.t('froom.code_label', 'Room code')}</label>
      <input id="joincode-input" class="input joincode__input t-h2" value={code} maxLength={FRIEND_CODE_LEN} autoComplete="off" autoCapitalize="characters" spellcheck={false}
        placeholder={'•'.repeat(FRIEND_CODE_LEN)} autoFocus={p.autoFocus} data-autofocus={p.autoFocus ? '' : undefined}
        aria-label={cv.t('froom.code_label', 'Room code')} onInput={(e) => setCode(cleanCode((e.currentTarget as HTMLInputElement).value))} />
      <Button type="submit" variant="secondary" size="m" disabled={!ok}
        reason={online ? cv.t('froom.code_need', 'Type the {n}-letter code your friend gave you.', { n: FRIEND_CODE_LEN }) : cv.t('froom.offline', 'Playing with friends needs a connection to the game server.')}>
        {cv.t('btn.join_friend', 'Join friend')}
      </Button>
    </form>
  );
}

export function RoomScreen(): JSX.Element {
  const { cv, router, state, session, sound } = useApp();
  const room = state.friendRoom.value;
  const online = state.online.value?.status === 'online';
  const title = cv.t('froom.title', 'Play with friends');

  if (!room) {
    const start = defaultFriendQueue(cv, state.prefs.value.lastMode);
    return (
      <Screen title={title}
        foot={!online ? <span class="reason reason--warn t-body-s">{cv.t('froom.offline', 'Playing with friends needs a connection to the game server.')}</span> : null}>
        <div class="froom froom--out">
          <Section title={cv.t('froom.join_title', 'Join a friend')} hint={cv.t('froom.join_hint', 'Type the code from your friend’s room.')}>
            <JoinCode autoFocus />
          </Section>
          <Section title={cv.t('froom.start_title', 'Start a room')} hint={cv.t('froom.start_hint', 'Get a code to share. Friends who join play in your match.')}>
            <Button variant="chalk" size="l" wedge disabled={!online || !start} reason={cv.t('froom.offline', 'Playing with friends needs a connection to the game server.')}
              onPress={() => { if (start) state.createFriendRoom(start.id, true); }}>{cv.t('btn.start_room', 'Start room')}</Button>
          </Section>
        </div>
      </Screen>
    );
  }

  const isHost = room.host === room.you;
  const queue = cv.queue(room.queue);
  const mode = queue ? cv.mode(queue.mode) : undefined;
  const ffa = cv.isFfa(mode);
  const coop = queue?.bots.fill === 'opponents_only';
  const sideFixed = ffa || coop;
  const busy = room.members.some((m) => m.busy) || room.starting;
  const link = inviteLink(room.code);
  const copy = (text: string, done: string): void => {
    void (async () => {
      try { await navigator.clipboard.writeText(text); state.toast(done, 'ok'); }
      catch { state.toast(cv.t('froom.copy_failed', 'Copy did not work here. The code is {code}.', { code: room.code }), 'warn'); }
    })();
  };
  const leave = (): void => { session.leaveFriendRoom?.(); state.friendRoom.value = null; sound.play('back'); router.reset('play', {}, 'back'); };
  const queues = friendQueues(cv);
  const sideText = ffa ? cv.t('froom.side_ffa', 'Everyone plays in the same match.')
    : coop ? cv.t('froom.side_coop', 'You all play on one team.')
      : room.together ? cv.t('froom.side_together_line', 'You all play on one team.') : cv.t('froom.side_against_line', 'You are split across both sides.');
  let reason: string | null = null;
  if (!online) reason = cv.t('froom.offline', 'Playing with friends needs a connection to the game server.');
  else if (!isHost) reason = cv.t('froom.wait_host', 'Waiting for {name} to start the match.', { name: room.members[0]?.name ?? '' });
  else if (room.starting) reason = cv.t('froom.starting', 'Starting…');
  else if (busy) reason = cv.t('froom.busy', 'Someone in the room is still in a match.');
  const open = Math.max(0, room.max - room.members.length);

  return (
    <Screen title={title}
      foot={reason ? <span class="reason t-body-s">{reason}</span> : <span class="t-body-s muted">{cv.t('froom.open_seats', 'Open seats are filled when the match starts.')}</span>}
      cta={<Button variant="chalk" size="l" wedge disabled={!!reason} reason={reason ?? undefined} onPress={() => session.startFriendRoom?.()} cue="confirm">{cv.t('btn.start_match', 'Start match')}</Button>}>
      <div class="froom">
        <section class="froom__code plate pad stg" aria-label={cv.t('froom.code_label', 'Room code')}>
          <span class="t-label muted">{cv.t('froom.code_label', 'Room code')}</span>
          <span class="froom__codetext t-display-m num" data-froom-code={room.code}>{room.code}</span>
          <span class="t-body-s muted">{cv.t('froom.share_hint', 'Send this code or the invite link to your friends.')}</span>
          <div class="row froom__share">
            <Button variant="secondary" size="m" onPress={() => copy(room.code, cv.t('froom.copied_code', 'Code copied.'))}>{cv.t('btn.copy_code', 'Copy code')}</Button>
            <Button variant="secondary" size="m" onPress={() => copy(link, cv.t('froom.copied_link', 'Invite link copied.'))}>{cv.t('btn.copy_link', 'Copy invite link')}</Button>
          </div>
        </section>

        <Section title={cv.t('froom.members', 'In this room ({n} of {max})', { n: room.members.length, max: room.max })}>
          <ul class="froom__members">
            {room.members.map((m) => (
              <li class={`froom__m plate ${m.id === room.you ? 'is-you' : ''}`}>
                <Icon name="user" size={16} />
                <span class="t-body">{m.name}</span>
                {m.id === room.host ? <span class="chip">{cv.t('froom.host', 'Host')}</span> : null}
                {m.id === room.you ? <span class="chip chip--line">{cv.t('party.you', 'You')}</span> : null}
                {m.busy ? <span class="t-caption muted">{cv.t('froom.in_match', 'In a match')}</span> : null}
              </li>
            ))}
            {open > 0 ? <li class="froom__m froom__m--open t-body-s muted">{open === 1 ? cv.t('froom.open_one', '1 open seat') : cv.t('froom.open_n', '{n} open seats', { n: open })}</li> : null}
          </ul>
        </Section>

        <Section title={cv.t('froom.game', 'Game')} hint={isHost ? undefined : cv.t('froom.host_sets', 'The host chooses the game.')}>
          {isHost ? (
            <Segmented label={cv.t('froom.game', 'Game')} value={room.queue}
              options={queues.map((q) => ({ value: q.id, label: `${cv.mode(q.mode)?.name ?? q.mode} · ${q.name}` }))}
              onChange={(id) => session.setFriendRoom?.({ queue: id })} />
          ) : <span class="chip chip--line">{mode?.name} · {queue?.name}</span>}
          {queue ? <p class="t-body-s muted froom__desc">{queue.desc}</p> : null}
          {isHost && !sideFixed ? (
            <div class="row froom__side">
              <span class="t-label">{cv.t('froom.side', 'Teams')}</span>
              <Segmented label={cv.t('froom.side', 'Teams')} value={room.together ? 'together' : 'against'}
                options={[{ value: 'together', label: cv.t('froom.side_together', 'Same team') }, { value: 'against', label: cv.t('froom.side_against', 'Against each other') }]}
                onChange={(v) => session.setFriendRoom?.({ together: v === 'together' })} />
            </div>
          ) : null}
          <p class="t-body-s">{sideText}</p>
        </Section>

        <div class="row">
          <Button variant="quiet" size="s" onPress={leave}>{cv.t('btn.leave_room', 'Leave room')}</Button>
        </div>
      </div>
    </Screen>
  );
}
