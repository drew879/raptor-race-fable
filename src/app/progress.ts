// What the player has earned, kept on the phone: the best score for each level, the hidden
// finds ever picked up, and whether a level's journal page is theirs yet. Everything here has
// to work when nothing can be kept (a private window), so every read has an answer.

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: it lasts for this visit only */
    kept.set(key, value);
  }
};
/** What could not be written, for the rest of this visit. */
const kept = new Map<string, string>();
const get = (key: string) => kept.get(key) ?? read(key);

export const progress = {
  best: (level: number) => Number(get(`rr-best-${level}`)) || 0,
  setBest: (level: number, score: number) => write(`rr-best-${level}`, String(Math.round(score))),
  /** Which of a level's three hidden finds have ever been picked up. */
  finds: (level: number): boolean[] => {
    const bits = get(`rr-finds-${level}`) ?? '';
    return [0, 1, 2].map((i) => bits[i] === '1');
  },
  /** Add the finds of one run to the ones already found. */
  addFinds(level: number, found: boolean[]) {
    const had = progress.finds(level);
    write(`rr-finds-${level}`, [0, 1, 2].map((i) => (had[i] || found[i] ? '1' : '0')).join(''));
  },
  /** A level's journal page is earned by finishing the level. */
  page: (level: number) => get(`rr-page-${level}`) === '1',
  earnPage: (level: number) => write(`rr-page-${level}`, '1'),
};
