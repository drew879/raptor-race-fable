// Holds the frame rate by trading away sharpness, but only when that is shown to help.
//
// Drawing fewer pixels only speeds things up if pixels are what is slow. On the iPhone 16 Pro
// Max they are not (its speed test barely changes between full and half sharpness), so a
// governor that simply lowers sharpness whenever frames run late softens the picture for
// nothing. This one runs a trial first: it drops straight to half sharpness for a second. If
// late frames don't clearly fall, pixels are not the problem, so it puts the sharpness back (and
// after two such trials leaves it alone for the session). If they do fall, it stays low and
// climbs back a step at a time to the sharpest setting that holds.

const KEY = 'rr-scale2';
const MIN = 0.5;
const STEP = 0.1;
const SLOW_FRAME = 22; // ms: longer than this and a frame was missed on a 60-a-second screen

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
  /** A step down that has not yet proved itself: where we came from and how late frames were. */
  private trial: { from: number; missed: number } | null = null;
  private failedTrials = 0;

  constructor(
    private apply: (scale: number) => void,
    private enabled = true,
  ) {
    try {
      const saved = Number(localStorage.getItem(KEY));
      if (enabled && saved >= MIN && saved <= 1) this.scale = saved;
    } catch {
      /* private mode */
    }
  }

  /** Loading, resizing and coming back from the background all hitch; none of that says anything about speed. */
  rest(ms = 1500) {
    this.resting = Math.max(this.resting, ms);
    this.frames = this.slow = this.span = 0;
  }

  /** Call once a frame with the time since the last one. */
  tick(ms: number) {
    if (!this.enabled) return;
    this.noRaise = Math.max(0, this.noRaise - ms);
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

    if (this.trial) {
      const { from, missed: before } = this.trial;
      this.trial = null;
      if (missed > before * 0.6) {
        // drawing fewer pixels did not help: pixels are not what is slow here
        this.failedTrials++;
        this.set(from, false, false);
        return;
      }
      this.save(); // it helped: keep it, and remember it for next launch
    }

    if (missed > 0.15) {
      this.calm = 0;
      if (this.scale <= MIN || this.failedTrials >= 2) return;
      if (this.raised) {
        // we had just tried one step sharper and it didn't hold: go back and wait longer
        this.noRaise = this.wait;
        this.wait = Math.min(this.wait * 2, 600000);
        this.set(this.scale - STEP, false, true);
        return;
      }
      // The trial goes all the way down, not one step: a screen shows frames in whole ticks,
      // so a small gain can hide, but if even half the pixels doesn't help, nothing will.
      this.trial = { from: this.scale, missed };
      this.set(MIN, false, false);
    } else if (missed < 0.03) {
      this.calm++;
      if (this.calm >= 6 && this.scale < 1 && this.noRaise <= 0) {
        this.calm = 0;
        this.set(this.scale + STEP, true, true);
      } else if (this.calm >= 6) {
        this.raised = false; // the current sharpness has held for a good while
      }
    } else {
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
