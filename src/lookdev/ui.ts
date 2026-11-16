// Concept viewer controls: flip between style directions, hide the controls for a clean look,
// and a fit check that reports how the page fills the phone.

import { BUILD } from '../app/build';
import { viewportReport } from '../app/viewport';
import type { Style } from '../render/styles';

export interface ViewerUI {
  setStyle(index: number): void;
  refresh(): void;
}

export function makeViewerUI(root: HTMLElement, styles: Style[], onPick: (index: number) => void): ViewerUI {
  root.innerHTML = `
    <div class="hud">
      <div class="chip amber-count"><span class="drop"></span><span>12</span></div>
      <div class="chip score">1,480</div>
      <button class="chip pause" aria-label="Pause"><span></span><span></span></button>
    </div>
    <div class="fit" hidden>
      <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
      <pre></pre>
    </div>
    <div class="picker">
      <div class="row">
        <div class="title"><b></b><span></span></div>
        <div class="tabs"></div>
      </div>
      <div class="foot">
        <span class="hint">Tap the picture to hide controls</span>
        <button class="fit-toggle">build ${BUILD} · fit check</button>
      </div>
    </div>`;
  const tabs = root.querySelector('.tabs') as HTMLElement;
  const title = root.querySelector('.title b') as HTMLElement;
  const blurb = root.querySelector('.title span') as HTMLElement;
  const fit = root.querySelector('.fit') as HTMLElement;
  const fitText = fit.querySelector('pre') as HTMLElement;
  let current = 0;

  styles.forEach((style, i) => {
    const b = document.createElement('button');
    b.textContent = style.tab;
    b.setAttribute('aria-label', style.name);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onPick(i);
    });
    tabs.appendChild(b);
  });

  const api: ViewerUI = {
    setStyle(index: number) {
      current = index;
      const style = styles[index];
      title.textContent = `${style.tab}. ${style.name}`;
      blurb.textContent = style.blurb;
      [...tabs.children].forEach((el, i) => el.classList.toggle('on', i === index));
      root.style.setProperty('--ui-ink', style.ui.ink);
      root.style.setProperty('--ui-panel', style.ui.panel);
      root.style.setProperty('--ui-accent', style.ui.accent);
      root.style.setProperty('--ui-text', style.ui.text);
    },
    refresh() {
      fitText.textContent = viewportReport();
    },
  };

  (root.querySelector('.fit-toggle') as HTMLElement).addEventListener('click', (e) => {
    e.stopPropagation();
    fit.hidden = !fit.hidden;
    api.refresh();
  });
  (root.querySelector('.pause') as HTMLElement).addEventListener('click', (e) => {
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.classList.toggle('pressed');
  });

  // tap the picture to hide or show the controls; swipe sideways to change direction
  const stage = document.getElementById('stage') as HTMLElement;
  let start: { x: number; y: number; t: number } | null = null;
  stage.addEventListener('pointerdown', (e) => {
    start = { x: e.clientX, y: e.clientY, t: performance.now() };
  });
  stage.addEventListener('pointerup', (e) => {
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    const quick = performance.now() - start.t < 600;
    start = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      onPick((current + (dx < 0 ? 1 : styles.length - 1)) % styles.length);
    } else if (quick && Math.abs(dx) < 10 && Math.abs(dy) < 10) {
      root.classList.toggle('clean');
    }
  });

  return api;
}
