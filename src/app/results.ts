// The results screen: what a finished level comes to. A page of the notebook (Drew's art, in
// art/results), with everything that changes from run to run set on it as live type: the
// level's name, the three rows of the score, the score, and what comes next.
//
// How it reads was settled in Drew's review of the mock-up (docs/NOTES.md, "Art from Drew's
// review"): the rows land one at a time, each with what was earned and what it was worth big
// and the "x 10" small and faint; the score comes last, as their sum, and counts up as they
// land. Nothing is ever taken away: a bump just means one obstacle fewer cleared.
//
// This belongs to the whole game. What is Jehol Forest's own arrives in `show()`.

import type { RunResult } from '../game/run';

const art = (name: string) => `${import.meta.env.BASE_URL}art/${name}`;
const FINDS = ['find-feathered-tail.webp', 'find-baby-bird.webp', 'find-spider-web.webp'];
/** What each thing is worth. */
export const WORTH = { amber: 10, find: 250, cleared: 25 };
const num = (n: number) => Math.round(n).toLocaleString('en-US');

export interface ResultsHooks {
  again(): void;
  next(): void;
  bell(kind: 'tap' | 'go' | 'back'): void;
}

export interface Results {
  /** True while the results cover the game. */
  readonly up: boolean;
  show(run: RunResult): void;
}

export function makeResults(parent: HTMLElement, hooks: ResultsHooks): Results {
  const root = document.createElement('div');
  root.className = 'results gone';
  root.innerHTML = `
    <img class="r-page" src="${art('results-page.webp')}" alt="">
    <div class="r-body">
      <header class="r-top r-in">
        <div class="r-name"><small>Level 1</small><h1></h1></div>
        <img class="r-chick" src="${art('results-chick.webp')}" alt="">
      </header>
      <section class="r-panel r-in">
        <div class="r-row" data-row="amber">
          <img class="r-icon" src="${art('results-amber.webp')}" alt="Amber">
          <b class="r-earned"></b><i class="r-times">&times; ${WORTH.amber}</i><b class="r-worth"></b>
        </div>
        <div class="r-row" data-row="finds">
          <span class="r-finds" aria-label="Hidden finds">${FINDS.map((f) => `<img src="${art(f)}" alt="">`).join('')}</span>
          <i class="r-times">&times; ${WORTH.find}</i><b class="r-worth"></b>
        </div>
        <div class="r-row" data-row="cleared">
          <img class="r-icon" src="${art('results-log.webp')}" alt="Obstacles cleared">
          <b class="r-earned"></b><i class="r-times">&times; ${WORTH.cleared}</i><b class="r-worth"></b>
          <span class="r-stamp">Clean run!</span>
        </div>
        <div class="r-total"><span>Score</span><b></b></div>
        <small class="r-best"></small>
      </section>
      <div class="r-lower">
        <div class="r-new r-in"><span>New page!</span><div class="r-card"><img src="${art('journal-jehol-thumb.webp')}" alt=""></div></div>
        <div class="r-next r-in">
          <img src="${art('results-next-gobi.webp')}" alt="">
          <div class="r-next-text"><small>Next</small><b>Velociraptor</b><span>in the Gobi Desert</span><em>Coming soon</em></div>
        </div>
      </div>
      <div class="r-buttons r-in">
        <button class="f-chip r-again"><span>Again</span></button>
        <button class="f-plate r-next-button"><span>Next</span></button>
      </div>
    </div>`;
  parent.appendChild(root);

  const q = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const rows = [...root.querySelectorAll<HTMLElement>('.r-row')];
  const total = q('.r-total b');
  let up = false;
  let timers: number[] = [];
  let frame = 0;
  let finish: (() => void) | null = null;

  const press = (el: HTMLElement, fn: () => void) => {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      fn();
    });
  };
  const leave = (then: () => void) => {
    for (const t of timers) clearTimeout(t);
    cancelAnimationFrame(frame);
    finish = null;
    up = false;
    root.classList.add('gone');
    then();
  };
  press(q('.r-again'), () => {
    hooks.bell('go');
    leave(hooks.again);
  });
  press(q('.r-next-button'), () => {
    hooks.bell('back');
    leave(hooks.next);
  });
  // a tap anywhere else while the rows are still landing puts everything in place at once
  root.addEventListener('pointerdown', () => finish?.());

  return {
    get up() {
      return up;
    },
    show(run) {
      const found = run.finds.filter(Boolean).length;
      const worth = [run.amber * WORTH.amber, found * WORTH.find, run.cleared * WORTH.cleared];
      const score = worth[0] + worth[1] + worth[2];
      const clean = run.cleared >= run.obstacles;
      let best = 0;
      try {
        best = Number(localStorage.getItem('rr-best-1')) || 0;
        if (score > best) localStorage.setItem('rr-best-1', String(score));
      } catch {
        /* private mode */
      }

      q('.r-name h1').textContent = run.level;
      rows[0].querySelector('.r-earned')!.textContent = num(run.amber);
      rows[2].querySelector('.r-earned')!.textContent = num(run.cleared);
      [...q('.r-finds').children].forEach((el, i) => el.classList.toggle('missing', !run.finds[i]));
      q('.r-best').textContent = score > best ? (best > 0 ? `New best! It was ${num(best)}` : 'Your first score') : `Best ${num(best)}`;
      for (const el of root.querySelectorAll('.shown')) el.classList.remove('shown');
      rows.forEach((row) => (row.querySelector('.r-worth')!.textContent = ''));
      total.textContent = '0';
      q('.r-stamp').hidden = !clean;

      // ---- one thing at a time
      let shown = 0; // the score so far
      const count = (el: Element, from: number, to: number, ms: number, also?: (v: number) => void) => {
        const t0 = performance.now();
        const tick = () => {
          const k = Math.min(1, (performance.now() - t0) / ms);
          const v = from + (to - from) * (1 - (1 - k) ** 3);
          el.textContent = num(v);
          also?.(v);
          if (k < 1) frame = requestAnimationFrame(tick);
        };
        tick();
        // (and the right number at the end whatever happens to the frames in between)
        timers.push(
          window.setTimeout(() => {
            el.textContent = num(to);
            also?.(to);
          }, ms + 80),
        );
      };
      const land = (i: number) => {
        rows[i].classList.add('shown');
        hooks.bell('tap');
        const before = shown;
        shown += worth[i];
        count(rows[i].querySelector('.r-worth')!, 0, worth[i], 420, (v) => (total.textContent = num(before + v)));
      };
      const steps: [number, () => void][] = [
        [150, () => root.querySelectorAll('.r-top, .r-panel').forEach((el) => el.classList.add('shown'))],
        [750, () => land(0)],
        [1500, () => land(1)],
        [2250, () => land(2)],
        [3050, () => {
          q('.r-total').classList.add('shown');
          q('.r-best').classList.add('shown');
          if (clean) q('.r-stamp').classList.add('shown');
          hooks.bell('go');
        }],
        [3650, () => q('.r-new').classList.add('shown')],
        [4050, () => q('.r-next').classList.add('shown')],
        [4450, () => q('.r-buttons').classList.add('shown')],
      ];
      for (const t of timers) clearTimeout(t);
      timers = steps.map(([at, fn]) => window.setTimeout(fn, at));
      timers.push(window.setTimeout(() => (finish = null), 4500));
      finish = () => {
        finish = null;
        for (const t of timers) clearTimeout(t);
        cancelAnimationFrame(frame);
        for (const el of root.querySelectorAll('.r-in, .r-row, .r-total, .r-best, .r-stamp')) el.classList.add('shown');
        rows.forEach((row, i) => (row.querySelector('.r-worth')!.textContent = num(worth[i])));
        total.textContent = num(score);
      };
      up = true;
      root.classList.remove('gone');
    },
  };
}
