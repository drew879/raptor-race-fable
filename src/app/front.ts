// What the player sees before a run: the loading screen and the home screen. Plain HTML above
// everything else. The painting and the name are Drew's art (art/home, made small for the web by
// art/make-web.sh); the buttons are built here, so they can change without new art.
//
// This belongs to the whole game, not to any one level: nothing here is Jehol Forest's.

import '@fontsource/bebas-neue/400.css';
import type { Choice } from '../audio/sound';
import { BUILD } from './build';
import { choiceRows } from './choices';

const art = (name: string) => `${import.meta.env.BASE_URL}art/${name}`;
/** The hidden finds. One of them, picked at random, is the loading screen. */
const FINDS = ['find-feathered-tail.webp', 'find-baby-bird.webp', 'find-spider-web.webp'];

export interface FrontHooks {
  /** PLAY, or a level picked from the list. */
  play(): void;
  /** A bell for a tap: `go` starts a run, `back` closes something. */
  bell(kind: 'tap' | 'go' | 'back'): void;
  /** Open the Field Journal. */
  journal(): void;
  soundOn(): boolean;
  setSound(on: boolean): void;
  /** Sounds on trial, to switch between here (the band). */
  choices(): Choice[];
}

export interface Front {
  /** True while the loading screen or the home screen covers the game. */
  readonly up: boolean;
  /** The game is ready: fill the find to the top, then show the home screen. */
  ready(hooks: FrontHooks): Promise<void>;
  /** Back to the home screen from a run. */
  showHome(): void;
}

const GEAR =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-1.7-1L15 3.5h-4l-.3 2.5a7.6 7.6 0 0 0-1.7 1l-2.4-1-2 3.4L6.600 11a7.6 7.6 0 0 0 0 2l-2 1.600 2 3.400 2.400-1a7.600 7.600 0 0 0 1.700 1l.300 2.500h4l.300-2.500a7.600 7.600 0 0 0 1.700-1l2.400 1 2-3.400zM13 15.200a3.200 3.200 0 1 1 0-6.400 3.200 3.200 0 0 1 0 6.400z"/></svg>';

export function makeFront(parent: HTMLElement): Front {
  const root = document.createElement('div');
  root.className = 'front';
  const find = art(FINDS[Math.floor(Math.random() * FINDS.length)]);
  root.innerHTML = `
    <div class="f-loading" role="img" aria-label="Loading">
      <div class="f-filling">
        <img class="empty" src="${find}" alt="">
        <div class="glow"><img class="full" src="${find}" alt=""></div>
      </div>
    </div>
    <div class="f-home" hidden>
      <img class="f-bg" src="${art('home-background.webp')}" alt="">
      <div class="f-shade"></div>
      <img class="f-title" src="${art('home-title.webp')}" alt="Raptor Race">
      <div class="f-buttons">
        <button class="f-plate f-play"><span>Play</span></button>
        <div class="f-pair">
          <button class="f-chip f-levels"><span>Levels</span></button>
          <button class="f-chip f-journal"><span>Journal</span></button>
        </div>
        <div class="f-pair end"><button class="f-chip f-gear" aria-label="Settings">${GEAR}</button></div>
      </div>
      <div class="sheet f-levels-sheet" hidden>
        <h2>Levels</h2>
        <button class="f-level">
          <b>1</b><span><strong>Jehol Forest</strong><small>Caudipteryx and the runaway egg</small></span><i>Play</i>
        </button>
        <div class="f-level locked">
          <b>2</b><span><strong>Gobi Desert</strong><small>Velociraptor</small></span><i>Coming soon</i>
        </div>
        <button class="big ghost f-close">Back</button>
      </div>
      <div class="sheet f-settings-sheet" hidden>
        <h2>Settings</h2>
        <div class="setting"><span>Sound</span><div class="tabs words sound-tabs"><button>On</button><button>Off</button></div></div>
        <div class="f-choices"></div>
        <small class="f-about">Raptor Race &middot; build ${BUILD}</small>
        <button class="big ghost f-close">Back</button>
      </div>
    </div>`;
  parent.appendChild(root);

  const q = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const loading = q('.f-loading');
  const home = q('.f-home');
  const full = q('.full');
  let up = true;
  let hooks: FrontHooks | null = null;

  // The find fills from the bottom while the game loads. Nobody can say how long that will take,
  // so it climbs quickly at first and ever more slowly, and only reaches the top when the game is ready.
  const began = performance.now();
  let level = 0;
  let done = false;
  const fill = () => {
    if (done) return;
    level = 0.9 * (1 - Math.exp(-(performance.now() - began) / 1800));
    full.style.setProperty('--fill', `${(level * 100).toFixed(1)}%`);
    requestAnimationFrame(fill);
  };
  fill();

  // A tap answers on the way down, like the game's own buttons, so nothing feels late.
  const press = (el: HTMLElement, fn: () => void) => {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      fn();
    });
  };
  const sheets = [q('.f-levels-sheet'), q('.f-settings-sheet')];
  const open = (sheet: HTMLElement | null) => {
    for (const s of sheets) s.hidden = s !== sheet;
    home.classList.toggle('behind', sheet !== null);
  };
  const play = () => {
    hooks?.bell('go');
    open(null);
    root.classList.add('gone');
    up = false;
    hooks?.play();
  };
  press(q('.f-play'), play);
  press(q('.f-level:not(.locked)'), play);
  press(q('.f-journal'), () => {
    hooks?.bell('tap');
    hooks?.journal();
  });
  for (const [button, sheet] of [['.f-levels', sheets[0]], ['.f-gear', sheets[1]]] as const) {
    press(q(button), () => {
      hooks?.bell('tap');
      open(sheet);
    });
  }
  for (const el of root.querySelectorAll<HTMLElement>('.f-close')) {
    press(el, () => {
      hooks?.bell('back');
      open(null);
    });
  }
  const soundTabs = [...q('.sound-tabs').children] as HTMLElement[];
  const markSound = (on: boolean) => soundTabs.forEach((el, i) => el.classList.toggle('on', (i === 0) === on));
  soundTabs.forEach((el, i) =>
    press(el, () => {
      hooks?.setSound(i === 0);
      markSound(i === 0);
      hooks?.bell('tap');
    }),
  );

  const loaded = (src: string) =>
    new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = img.onerror = () => resolve();
      img.src = src;
    });
  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  return {
    get up() {
      return up;
    },
    async ready(h) {
      hooks = h;
      markSound(h.soundOn());
      choiceRows(q('.f-choices'), h.choices(), press, () => h.bell('tap'));
      // the home screen's own pictures have to be in hand before it is shown (but not for ever)
      await Promise.race([Promise.all([loaded(art('home-background.webp')), loaded(art('home-title.webp'))]), wait(4000)]);
      done = true;
      full.classList.add('topping');
      full.style.setProperty('--fill', '100%');
      await wait(520);
      home.hidden = false;
      loading.classList.add('gone');
      await wait(450);
      loading.hidden = true;
    },
    showHome() {
      open(null);
      up = true;
      root.classList.remove('gone');
    },
  };
}
