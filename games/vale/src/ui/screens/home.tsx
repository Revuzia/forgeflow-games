// VALE UI — Home (client_hud §3.1): the headline over the live Rim, the feature card (its CTA is the
// screen's chalk CTA), four tiles from catalog.client.home. A tile whose target queue is above your
// level is LOCKED (dashed border + the unlock path, never grey). A tile keeps the gloam "new" dot until
// you open it once.

import type { JSX } from 'preact';
import { useApp } from '../app_ctx.ts';
import { Button } from '../components/Button.tsx';
import { Icon } from '../components/Glyphs.tsx';
import { NewDot } from '../components/Plate.tsx';
import { ArtFrame } from '../components/Portrait.tsx';
import { Screen } from '../components/Screen.tsx';

export function HomeScreen(): JSX.Element {
  const { cv, router, state, sound } = useApp();
  const home = cv.c.client.home;
  const profile = state.profile.value;
  const seen = state.prefs.value.seenScreens;
  const feature = home.feature;
  const fMode = cv.mode(feature.cta.params.mode);
  const open = (screen: string, params: Record<string, string>, tileId?: string): void => {
    if (tileId && !seen.includes(`tile:${tileId}`)) state.setPrefs({ seenScreens: [...seen, `tile:${tileId}`] });
    router.go(screen, params);
  };
  return (
    <Screen
      label={home.headline}
      cta={<Button variant="chalk" size="l" wedge data-autofocus="" onPress={() => open(feature.cta.screen, feature.cta.params)}>{feature.cta.label}</Button>}
      foot={<span class="t-body-s muted">{cv.t('app.local_note', 'Your profile is saved in this browser only.')}</span>}>
      <div class="home">
        <div class="home__hero stg">
          <h1 class="t-display-l home__headline">{home.headline}</h1>
          <p class="t-body-l home__sub">{home.sub}</p>
        </div>
        <article class="home__feature plate stg">
          <ArtFrame src={feature.art} mark={fMode ? cv.modeMark(fMode) : null} lanes={cv.laneCount(fMode)} class="home__featureart" />
          <div class="home__featuretext">
            {fMode ? <span class="t-label home__featuremode">{fMode.name}</span> : null}
            <h2 class="t-h1">{feature.title}</h2>
            <p class="t-body muted">{feature.body}</p>
          </div>
        </article>
        <div class="home__tiles" data-arrownav="grid">
          {home.tiles.map((tile) => {
            const q = cv.queue(tile.params.queue);
            const lockLevel = q && q.unlockLevel > profile.level ? q.unlockLevel : 0;
            const lockText = lockLevel ? cv.t('state.locked.queue', 'Reach level {level} to play {queue}.', { level: lockLevel, queue: q!.name }) : null;
            const tMode = cv.mode(tile.params.mode ?? q?.mode);
            const isNew = !seen.includes(`tile:${tile.id}`);
            return (
              <button type="button" class={`tile plate stg ${lockText ? 'is-locked' : ''}`} data-nav=""
                aria-label={`${tile.title}. ${tile.body}${lockText ? ` ${lockText}` : ''}`}
                onPointerEnter={() => sound.play('hover')} onPointerDown={() => sound.play(lockText ? 'error' : 'click')}
                onClick={() => open(tile.screen, tile.params, tile.id)}>
                <ArtFrame src={tile.art} mark={tMode ? cv.modeMark(tMode) : null} lanes={cv.laneCount(tMode)} class="tile__art" />
                <span class="tile__text">
                  <span class="tile__title t-label">{tile.title}{isNew ? <NewDot label={cv.t('common.new', 'New')} /> : null}</span>
                  <span class="tile__body t-body-s">{tile.body}</span>
                  {lockText ? <span class="tile__lock t-caption"><Icon name="lock" size={14} />{lockText}</span> : null}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </Screen>
  );
}
