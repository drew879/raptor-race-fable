// Holds the frame rate by trading away sharpness, but only when that is shown to help.
//
// Drawing fewer pixels only speeds things up if pixels are what is slow. On the iPhone 16 Pro
// Max they are not (its speed test barely changes between full and half sharpness), so a
// governor that lowers sharpness whenever frames run late softens the picture for nothing.
// Three versions of this file did exactly that on the phone, so this one is built to doubt:
//
// - It only judges frames during play. Sheets (start, pause, finish) blur the picture behind
//   them, which costs frames that have nothing to do with how fast the forest draws.
// - It waits for three slow seconds in a row: a hitch is not a slow phone.
// - Then it runs a there-and-back trial. Half sharpness for a second; if that is no better,
//   pixels are not the problem. If it is better, that still proves nothing (a hitch that passed
//   on its own looks the same), so it goes back to the old sharpness for a second. Only if the
//   slowness comes back does it settle at half, and then climb a step at a time to the
//   sharpest setting that holds.
// - Two trials that come to nothing and it leaves sharpness alone for the session.
//
// It also keeps a short history, shown in the pause sheet's small print, so a screenshot from
// the phone says what it did and why.

const KEY = 'rr-scale4';
const MIN = 0.5;
const STEP = 0.1;
const SLOW_FRAME = 22; // ms: longer than this and a frame was missed on a 60-a-second screen
const SLOW = 0.15; // a second with this share of late frames is a slow second
const CALM = 0.03;

type Phase =
  | { name: 'watch' }
  /** At half sharpness: are late frames clearly down? */
  | { name: 'low'; from: number; before: number }
  /** Back at the old sharpness: does the slowness come back? */
  | { name: 'back'; from: number; low: number };

const pct = (share: number) => `${Math.round(share * 100)}%`;

export class Quality {
  /** Share of full sharpness, 0.5 to 1. */
  scale = 1;
  private frames = 0;
  private slow = 0;
  private span = 0;
  private calm = 0;
  private resting = 2500;
  private noRaise = 0;
  private wait = 45000;
  private raised = false;
  private phase: Phase = { name: 'watch' };
  private failedTrials = 0;
  /** Slow seconds in a row, and the mildest of them. */
  private slowRun = 0;
  private slowMin = 1;
  /** True while climbing back up after a trial that held. */
  private afterTrial = false;
  private log: string[] = [];

  constructor(
    private apply: (scale: number) => void,
    private enabled = true,
  ) {
    try {
      const saved = Number(localStorage.getItem(KEY));
      if (enabled && saved >= MIN && saved < 1) {
        this.scale = saved;
        this.note(`began at ${pct(saved)} (saved)`);
      }
    } catch {
      /* private mode */
    }
  }

  /** The last few things the governor did, for the pause sheet. Empty if it has done nothing. */
  history(): string {
    return this.log.slice(-4).join(' · ');
  }

  private note(text: string) {
    this.log.push(`${Math.round(performance.now() / 1000)}s ${text}`);
    if (this.log.length > 12) this.log.shift();
  }

  /** Loading, resizing and coming back from the background all hitch; none of that says anything about speed. */
  rest(ms = 1500) {
    this.resting = Math.max(this.resting, ms);
    this.frames = this.slow = this.span = 0;
  }

  /**
   * Call once a frame with the time since the last one. `steady` is false whenever the frame
   * says nothing about how fast the game draws (a sheet is up, the run has not begun).
   */
  tick(ms: number, steady = true) {
    if (!this.enabled) return;
    this.noRaise = Math.max(0, this.noRaise - ms);
    if (!steady) return this.rest(1000);
    if (ms > 250) return this.rest();
    if (this.resting > 0) {
      this.resting -= ms;
      return;
    }
    this.frames++;
    this.span += ms;
    if (ms > SLOW_FRAME) this.slow++;
    if (this.span < 1000) return;
    const missed = this.slow / this.frames;
    this.frames = this.slow = this.span = 0;

    const phase = this.phase;
    if (phase.name === 'low') {
      if (missed > phase.before * 0.5) {
        // drawing half the pixels did not help: pixels are not what is slow here
        this.failedTrials++;
        this.phase = { name: 'watch' };
        this.note(`half: ${pct(missed)} late, no help`);
        this.set(phase.from, false, false);
        return;
      }
      this.phase = { name: 'back', from: phase.from, low: missed };
      this.note(`half: ${pct(missed)} late, checking`);
      this.set(phase.from, false, false);
      return;
    }
    if (phase.name === 'back') {
      this.phase = { name: 'watch' };
      this.slowRun = 0;
      if (missed > SLOW * 0.6 && missed > phase.low * 2) {
        // slow at the old sharpness, smooth at half, slow again: pixels are the cost
        this.afterTrial = true;
        this.note(`${pct(phase.from)}: ${pct(missed)} late again, staying at half`);
        this.set(MIN, false, true);
        return;
      }
      // smooth again without any help from us: it was a passing hitch
      this.failedTrials++;
      this.note(`${pct(phase.from)}: ${pct(missed)} late, it passed`);
      return;
    }

    if (missed > SLOW) {
      this.calm = 0;
      this.slowRun++;
      this.slowMin = this.slowRun === 1 ? missed : Math.min(this.slowMin, missed);
      if (this.scale <= MIN || this.failedTrials >= 2) return;
      if (this.raised) {
        if (this.slowRun < 2) return;
        // we had just tried one step sharper and it didn't hold: go back and wait longer
        this.noRaise = this.wait;
        this.wait = Math.min(this.wait * 2, 600000);
        this.note(`${pct(this.scale)} didn't hold`);
        this.set(this.scale - STEP, false, true);
        return;
      }
      if (this.slowRun < 3) return;
      // The trial goes all the way down, not one step: a screen shows frames in whole ticks,
      // so a small gain can hide, but if even half the pixels doesn't help, nothing will.
      this.phase = { name: 'low', from: this.scale, before: this.slowMin };
      this.note(`3 slow seconds (${pct(this.slowMin)} late), trying half`);
      this.set(MIN, false, false);
    } else if (missed < CALM) {
      this.slowRun = 0;
      this.calm++;
      if (this.calm >= 6 && this.scale < 1 && this.noRaise <= 0) {
        this.calm = 0;
        this.note(`up to ${pct(this.scale + STEP)}`);
        this.set(this.scale + STEP, true, true);
      } else if (this.calm >= 6) {
        this.raised = false; // the current sharpness has held for a good while
        if (this.afterTrial && this.scale >= 1) {
          // back at full and holding: the dip was never needed
          this.afterTrial = false;
          this.failedTrials++;
        }
      }
    } else {
      this.slowRun = 0;
      this.calm = 0;
    }
  }

  private set(scale: number, raised: boolean, remember: boolean) {
    this.scale = Math.min(1, Math.max(MIN, Math.round(scale * 100) / 100));
    this.raised = raised;
    if (remember) this.save();
    this.apply(this.scale);
    this.rest(700);
  }

  private save() {
    try {
      localStorage.setItem(KEY, String(this.scale));
    } catch {
      /* private mode */
    }
  }
}
