// The run's on-screen controls: amber count, pause, hints, and the pause and finish sheets.
// Plain HTML above the 3D view. The pause button answers on touch-down, not on click,
// so a swipe handler underneath can never swallow it.

import { BUILD } from '../app/build';
import { currentFps, isStandalone } from '../app/viewport';
import type { Style } from '../render/styles';

export interface HudHooks {
  styles: Style[];
  styleIndex: number;
  speed: number;
  onStart(): void;
  onPause(): void;
  onResume(): void;
  onRestart(): void;
  onStyle(index: number): void;
  onSpeed(speed: number): void;
}

export interface Hud {
  setAmber(count: number): void;
  hint(text: string | null): void;
  warn(on: boolean): void;
  setPaused(paused: boolean): void;
  showFinish(amber: number, total: number): void;
  hideFinish(): void;
  setStyle(index: number): void;
}

export function makeHud(root: HTMLElement, hooks: HudHooks): Hud {
  root.classList.remove('clean');
  root.innerHTML = `
    <div class="hud">
      <div class="chip amber-count"><span class="drop"></span><span class="n">0</span></div>
      <button class="chip pause" aria-label="Pause" style="margin-left:auto"><span></span><span></span></button>
    </div>
    <div class="hint" hidden></div>
    <div class="warn" hidden>The egg is getting away!</div>
    <div class="sheet pause-sheet" hidden>
      <h2>Paused</h2>
      <button class="big resume">Keep running</button>
      <button class="big ghost restart">Start over</button>
      <div class="setting"><span>Look</span><div class="tabs"></div></div>
      <div class="setting"><span>Speed</span>
        <div class="stepper"><button class="slower" aria-label="Slower">&minus;</button><b class="speed"></b><button class="faster" aria-label="Faster">+</button></div>
      </div>
      <a class="link" href="?">See the concept frames</a>
      <small class="about">Rough test run &middot; build ${BUILD}</small>
    </div>
    <div class="sheet start-sheet">
      <h2>Rough test run</h2>
      <p>Swipe left or right to change lanes.<br>Swipe up to jump.<br>Swipe down to slide.</p>
      <button class="big go">Run!</button>
    </div>
    <div class="sheet finish-sheet" hidden>
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
    warn(on) {
      warnEl.hidden = !on;
    },
    setPaused(paused) {
      pauseSheet.hidden = !paused;
      if (paused) {
        // handy when reporting back from the phone: which build, how smooth, and how it was opened
        q<HTMLElement>('.about').textContent =
          `Rough test run · build ${BUILD} · ${currentFps().toFixed(0)} fps · ${isStandalone() ? 'Home Screen' : 'browser'}`;
      }
    },
    showFinish(count, total) {
      q<HTMLElement>('.tally').textContent = `Amber: ${count} of ${total}`;
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
