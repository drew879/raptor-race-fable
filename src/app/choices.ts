// Rows of Settings for things on trial: each a label and a few options to switch between while
// playing (the music's band, the drum mix, what the amber sounds like). What the options are and
// what they do is the sound's business (Sound.choices); this only draws them.

import type { Choice } from '../audio/sound';

/**
 * Put a row into `holder` for each choice. Two options are two tabs. More than two are one button
 * that shows the option in use and moves to the next at each tap, to keep the row to one line.
 * `press` is the caller's own way of hearing a tap (they answer on the way down).
 */
export function choiceRows(holder: HTMLElement, choices: Choice[], press: (el: HTMLElement, fn: () => void) => void, tapped?: (choice: Choice) => void) {
  holder.replaceChildren();
  for (const choice of choices) {
    const row = document.createElement('div');
    row.className = 'setting';
    const label = document.createElement('span');
    label.textContent = choice.label;
    const tabs = document.createElement('div');
    tabs.className = 'tabs words';
    row.append(label, tabs);
    if (choice.options.length <= 2) {
      const buttons = choice.options.map((name, i) => {
        const b = document.createElement('button');
        b.textContent = name;
        press(b, () => {
          choice.set(i);
          mark();
          tapped?.(choice);
        });
        tabs.appendChild(b);
        return b;
      });
      const mark = () => buttons.forEach((b, i) => b.classList.toggle('on', i === choice.get()));
      mark();
    } else {
      const b = document.createElement('button');
      b.className = 'on';
      const show = () => (b.textContent = `${choice.options[choice.get()] ?? choice.options[0]} ›`);
      press(b, () => {
        choice.set((choice.get() + 1) % choice.options.length);
        show();
        tapped?.(choice);
      });
      show();
      tabs.appendChild(b);
    }
    holder.appendChild(row);
  }
}
