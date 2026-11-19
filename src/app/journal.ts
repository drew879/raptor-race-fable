// The Field Journal: the notebook the player fills in. A level's page is earned by finishing
// the level, and each hidden find, once picked up in a run, is stuck in at the foot of the page
// and opens a small card of its own.
//
// The page itself is Drew's art with its handwriting painted in (art/journal). What changes is
// set over it here: the row of finds, on the blank paper the art leaves for it, and the way
// back, on the arrow painted in the page's corner.
//
// The cards' facts were checked on 2026-11-18 (see the notes). The real pieces of amber came
// from Myanmar and Spain, not from Jehol, and each card says where.

import { progress } from './progress';

const art = (name: string) => `${import.meta.env.BASE_URL}art/${name}`;

/** The three hidden finds, in the order the level numbers them. */
const FINDS = [
  {
    art: 'find-feathered-tail.webp',
    name: "A dinosaur's tail",
    text: 'This is the tip of a real dinosaur\'s tail, feathers and all. It belonged to a young dinosaur about the size of a sparrow. Its feathers were chestnut brown on top and white underneath.',
    real: 'The real one was found in Myanmar. It is about 99 million years old.',
  },
  {
    art: 'find-spider-web.webp',
    name: "A spider's web",
    text: 'A spider spun this web, and it still holds what it caught: a fly, a mite, a beetle and a wasp. It is one of the oldest spider webs ever found.',
    real: 'The real one was found in Spain. It is about 110 million years old.',
  },
  {
    art: 'find-baby-bird.webp',
    name: 'A baby bird',
    text: 'This chick had only just hatched when it was caught in sticky tree resin, which hardened into amber. It already had flying feathers on its wings. It was a kind of bird with teeth, which lived beside the dinosaurs and is gone now.',
    real: 'The real one was found in Myanmar. It is about 99 million years old.',
  },
];

export interface JournalHooks {
  bell(kind: 'tap' | 'go' | 'back', up?: number): void;
}

export interface Journal {
  /** Open the journal over whatever is showing. Closing it goes back there. */
  open(): void;
}

export function makeJournal(parent: HTMLElement, hooks: JournalHooks): Journal {
  const root = document.createElement('div');
  root.className = 'journal-screen gone';
  root.innerHTML = `
    <img class="j-under" src="${art('results-page.webp')}" alt="">
    <div class="j-scroll">
      <div class="j-page">
        <img class="j-art" src="${art('journal-jehol-page.webp')}" alt="Caudipteryx, Jehol Forest: the journal page">
        <button class="j-back" aria-label="Back"></button>
        <div class="j-finds">
          <span class="j-label"></span>
          <div class="j-slots">
            ${FINDS.map((f, i) => `<button class="j-find" data-i="${i}" aria-label="${f.name}"><img src="${art(f.art)}" alt=""><i>?</i></button>`).join('')}
          </div>
        </div>
      </div>
      <div class="j-locked">
        <img class="j-art" src="${art('results-page.webp')}" alt="">
        <div class="j-locked-text">
          <h1>Field Journal</h1>
          <p>Finish Jehol Forest and its page goes in here.</p>
          <button class="f-chip j-leave"><span>Back</span></button>
        </div>
      </div>
    </div>
    <div class="j-card" hidden>
      <div class="j-paper">
        <img alt="">
        <h2></h2>
        <p class="j-text"></p>
        <p class="j-real"></p>
        <button class="f-chip j-close"><span>Back</span></button>
      </div>
    </div>`;
  parent.appendChild(root);

  const q = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const press = (el: HTMLElement, fn: () => void) => {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      fn();
    });
  };
  const card = q('.j-card');
  const slots = [...root.querySelectorAll<HTMLElement>('.j-find')];
  const close = () => {
    hooks.bell('back');
    root.classList.add('gone');
    card.hidden = true;
  };
  press(q('.j-back'), close);
  press(q('.j-leave'), close);
  press(q('.j-close'), () => {
    hooks.bell('back');
    card.hidden = true;
  });
  // a tap on the dimmed page behind a card puts the card away too
  press(card, () => (card.hidden = true));
  q('.j-paper').addEventListener('pointerdown', (e) => e.stopPropagation());
  slots.forEach((slot, i) =>
    press(slot, () => {
      if (slot.classList.contains('missing')) {
        // not found yet: a shake of the head
        hooks.bell('back');
        slot.classList.remove('no');
        void slot.offsetWidth;
        slot.classList.add('no');
        return;
      }
      hooks.bell('tap', i);
      const find = FINDS[i];
      (card.querySelector('img') as HTMLImageElement).src = art(find.art);
      card.querySelector('h2')!.textContent = find.name;
      card.querySelector('.j-text')!.textContent = find.text;
      card.querySelector('.j-real')!.textContent = find.real;
      card.hidden = false;
    }),
  );

  return {
    open() {
      const earned = progress.page(1);
      q('.j-page').hidden = !earned;
      q('.j-locked').hidden = earned;
      const found = progress.finds(1);
      slots.forEach((slot, i) => slot.classList.toggle('missing', !found[i]));
      const count = found.filter(Boolean).length;
      q('.j-label').textContent = count === 3 ? 'Hidden finds: all three!' : `Hidden finds: ${count} of 3`;
      card.hidden = true;
      q('.j-scroll').scrollTop = 0;
      root.classList.remove('gone');
    },
  };
}
