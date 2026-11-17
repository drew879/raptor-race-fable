// The run's on-screen controls: amber count, pause, hints, and the pause and finish sheets.
// Plain HTML above the 3D view. The pause button answers on touch-down, not on click,
// so a swipe handler underneath can never swallow it.

import { BUILD } from '../app/build';
import { currentFps, fitLine, isStandalone, lateFrames } from '../app/viewport';
import type { Style } from '../render/styles';

export interface HudHooks {
  styles: Style[];
  styleIndex: number;
  speed: number;
  eggModes: string[];
  eggMode: number;
  eggSizes: string[];
  eggSize: number;
  /** Picking another size starts the game again, since the nest is built to it. */
  onEggSize(pick: number): void;
  /** "Try again" on the sheet that says the egg got away. */
  onRetry(): void;
  /** "Next" on the Field Journal card that closes the level. */
  onJournalNext(): void;
  /** A short note on how sharp the picture is being drawn, for the pause sheet's small print. */
  quality?(): string;
  /** What one frame costs right now, measured after the sheet is up. */
  speedNow?(): Promise<string>;
  onEgg(mode: number): void;
  onStart(): void;
  onPause(): void;
  onResume(): void;
  onRestart(): void;
  onStyle(index: number): void;
  onSpeed(speed: number): void;
}

export interface Hud {
  setAmber(count: number): void;
  /** Which of the hidden finds have been picked up, in order. */
  setFinds(found: boolean[]): void;
  /** The two labels that say what each side of the fork holds. */
  fork(on: boolean): void;
  /** Dim the picture, once the egg is lost. */
  fade(on: boolean): void;
  showLost(): void;
  hideLost(): void;
  /** The small "Tap to skip" under the opening. */
  skip(on: boolean): void;
  /** Hide the counters and the pause button while a scene plays. */
  clean(on: boolean): void;
  showJournal(): void;
  hideJournal(): void;
  hint(text: string | null): void;
  warn(on: boolean): void;
  setPaused(paused: boolean): void;
  showFinish(amber: number, total: number, finds: number, totalFinds: number): void;
  hideFinish(): void;
  setStyle(index: number): void;
}

export function makeHud(root: HTMLElement, hooks: HudHooks): Hud {
  root.classList.remove('clean');
  root.innerHTML = `
    <div class="hud">
      <div class="chip amber-count"><span class="drop"></span><span class="n">0</span></div>
      <div class="chip finds" aria-label="Hidden finds"></div>
      <button class="chip pause" aria-label="Pause" style="margin-left:auto"><span></span><span></span></button>
    </div>
    <div class="hint" hidden></div>
    <div class="fork-label left" hidden><b>&larr;</b><span>Riskier,<br>more amber</span></div>
    <div class="fork-label right" hidden><span>Safer,<br>less amber</span><b>&rarr;</b></div>
    <div class="fade"></div>
    <div class="skip" hidden>Tap to skip</div>
    <div class="journal" hidden>
      <small>Field Journal</small>
      <p>Caudipteryx was in Oviraptor's family.</p>
      <p>Fossils show dinosaurs from this family sitting on their nests with their arms over the eggs, just like birds.</p>
      <button class="big next">Next</button>
    </div>
    <div class="warn" hidden>The egg is getting away!</div>
    <div class="sheet pause-sheet" hidden>
      <h2>Paused</h2>
      <button class="big resume">Keep running</button>
      <button class="big ghost restart">Start over</button>
      <div class="setting look-row"><span>Look</span><div class="tabs"></div></div>
      <div class="setting"><span>Speed</span>
        <div class="stepper"><button class="slower" aria-label="Slower">&minus;</button><b class="speed"></b><button class="faster" aria-label="Faster">+</button></div>
      </div>
      <div class="setting"><span>Egg</span><div class="tabs words egg-tabs"></div></div>
      <div class="setting"><span>Egg size</span><div class="tabs words size-tabs"></div></div>
      <div class="links"><a class="link" href="?mode=close">Close-up</a><a class="link" href="?mode=bench">Speed test</a></div>
      <small class="about">Rough test run &middot; build ${BUILD}</small>
    </div>
    <div class="sheet start-sheet low">
      <h2>Raptor Race</h2>
      <p>Jehol Forest</p>
      <button class="big go">Run!</button>
    </div>
    <div class="sheet lost-sheet" hidden>
      <h2>The egg got away!</h2>
      <p>Every bump lets it roll further ahead.</p>
      <button class="big retry">Try again</button>
    </div>
    <div class="sheet finish-sheet low" hidden>
      <h2>You caught the egg!</h2>
      <p class="tally"></p>
      <button class="big again">Run again</button>
    </div>`;
  const q = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const amber = q<HTMLElement>('.amber-count .n');
  const hintEl = q<HTMLElement>('.hint');
  const warnEl = q<HTMLElement>('.warn');
  const pauseSheet = q<HTMLElement>('.pause-sheet');
  const finishSheet = q<HTMLElement>('.finish-sheet');
  const speedEl = q<HTMLElement>('.speed');
  const tabs = q<HTMLElement>('.pause-sheet .tabs');
  // with one look there is nothing to pick
  q<HTMLElement>('.look-row').hidden = hooks.styles.length < 2;
  let speed = hooks.speed;

  const press = (el: HTMLElement, fn: () => void) => {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      fn();
    });
  };
  press(q('.go'), () => {
    q<HTMLElement>('.start-sheet').hidden = true;
    hooks.onStart();
  });
  press(q('.pause'), hooks.onPause);
  press(q('.resume'), hooks.onResume);
  press(q('.restart'), hooks.onRestart);
  press(q('.again'), hooks.onRestart);
  press(q('.retry'), hooks.onRetry);
  press(q('.next'), hooks.onJournalNext);
  const skipEl = q<HTMLElement>('.skip');
  const showSpeed = () => (speedEl.textContent = speed.toFixed(1));
  press(q('.slower'), () => {
    speed = Math.max(4, speed - 0.5);
    showSpeed();
    hooks.onSpeed(speed);
  });
  press(q('.faster'), () => {
    speed = Math.min(11, speed + 0.5);
    showSpeed();
    hooks.onSpeed(speed);
  });
  showSpeed();

  const eggTabs = q<HTMLElement>('.egg-tabs');
  const markEgg = (mode: number) => [...eggTabs.children].forEach((el, i) => el.classList.toggle('on', i === mode));
  hooks.eggModes.forEach((name, i) => {
    const b = document.createElement('button');
    b.textContent = name;
    press(b, () => {
      markEgg(i);
      hooks.onEgg(i);
    });
    eggTabs.appendChild(b);
  });
  markEgg(hooks.eggMode);

  const sizeTabs = q<HTMLElement>('.size-tabs');
  hooks.eggSizes.forEach((name, i) => {
    const b = document.createElement('button');
    b.textContent = name;
    b.classList.toggle('on', i === hooks.eggSize);
    press(b, () => {
      if (i !== hooks.eggSize) hooks.onEggSize(i);
    });
    sizeTabs.appendChild(b);
  });
  const forkEls = [q<HTMLElement>('.fork-label.left'), q<HTMLElement>('.fork-label.right')];
  let forkShown = false;

  hooks.styles.forEach((style, i) => {
    const b = document.createElement('button');
    b.textContent = style.tab;
    b.setAttribute('aria-label', style.name);
    press(b, () => hooks.onStyle(i));
    tabs.appendChild(b);
  });

  const api: Hud = {
    setAmber(count) {
      amber.textContent = String(count);
    },
    hint(text) {
      hintEl.hidden = !text;
      if (text) hintEl.textContent = text;
    },
    setFinds(found) {
      const el = q<HTMLElement>('.finds');
      el.innerHTML = found.map((f) => `<i class="${f ? 'on' : ''}"></i>`).join('');
      el.hidden = found.length === 0;
    },
    fork(on) {
      // asked for every frame, so only touch the page when something changes
      if (on === forkShown) return;
      forkShown = on;
      for (const el of forkEls) el.hidden = !on;
    },
    skip(on) {
      if (skipEl.hidden === on) skipEl.hidden = !on;
    },
    clean(on) {
      root.classList.toggle('clean', on);
    },
    showJournal() {
      q<HTMLElement>('.journal').hidden = false;
    },
    hideJournal() {
      q<HTMLElement>('.journal').hidden = true;
    },
    showLost() {
      q<HTMLElement>('.lost-sheet').hidden = false;
    },
    hideLost() {
      q<HTMLElement>('.lost-sheet').hidden = true;
    },
    fade(on) {
      q<HTMLElement>('.fade').classList.toggle('on', on);
    },
    warn(on) {
      warnEl.hidden = !on;
    },
    setPaused(paused) {
      pauseSheet.hidden = !paused;
      if (paused) {
        // handy when reporting back from the phone: which build, how smooth, and how it was opened
        q<HTMLElement>('.about').textContent =
          `Rough test run · build ${BUILD} · ${currentFps().toFixed(0)} fps · ${isStandalone() ? 'Home Screen' : 'browser'}` +
          `${hooks.quality ? ` · ${hooks.quality()}` : ''}\n${lateFrames()}\n${fitLine()}`;
        // the phone's own speed at this moment, so a screenshot says whether the phone or the game is slow
        const about = q<HTMLElement>('.about');
        const shown = about.textContent;
        void hooks.speedNow?.().then((line) => {
          if (!pauseSheet.hidden && about.textContent === shown) about.textContent = `${shown}\n${line}`;
        });
      }
    },
    showFinish(count, total, finds, totalFinds) {
      q<HTMLElement>('.tally').textContent = `Amber: ${count} of ${total}` + (totalFinds ? `\nHidden finds: ${finds} of ${totalFinds}` : '');
      finishSheet.hidden = false;
    },
    hideFinish() {
      finishSheet.hidden = true;
    },
    setStyle(index) {
      const style = hooks.styles[index];
      [...tabs.children].forEach((el, i) => el.classList.toggle('on', i === index));
      root.style.setProperty('--ui-ink', style.ui.ink);
      root.style.setProperty('--ui-panel', style.ui.panel);
      root.style.setProperty('--ui-accent', style.ui.accent);
      root.style.setProperty('--ui-text', style.ui.text);
    },
  };
  api.setStyle(hooks.styleIndex);
  return api;
}
