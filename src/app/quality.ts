// Holds the frame rate. When the phone can't keep up, the picture is drawn a little less sharp
// (fewer pixels, stretched to fill the screen); when there is room again, it sharpens back up.
// The choice is remembered, so the next launch starts where this one settled.

const KEY = 'rr-scale';
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
    if (missed > 0.15) {
      this.calm = 0;
      if (this.scale <= MIN) return;
      // most frames late means we are far off, so come down faster; but after trying sharper
      // and failing, go back exactly one step and wait longer before trying again
      let step = missed > 0.6 ? STEP * 2 : STEP;
      if (this.raised) {
        step = STEP;
        this.noRaise = this.wait;
        this.wait = Math.min(this.wait * 2, 600000);
      }
      this.set(this.scale - step, false);
    } else if (missed < 0.03) {
      this.calm++;
      if (this.calm >= 6 && this.scale < 1 && this.noRaise <= 0) {
        this.calm = 0;
        this.set(this.scale + STEP, true);
      } else if (this.calm >= 6) {
        this.raised = false; // the current sharpness has held for a good while
      }
    } else {
      this.calm = 0;
    }
  }

  /** Pin the sharpness (the speed test does this). */
  force(scale: number) {
    this.enabled = false;
    this.scale = scale;
    this.apply(scale);
  }

  private set(scale: number, raised: boolean) {
    this.scale = Math.min(1, Math.max(MIN, Math.round(scale * 100) / 100));
    this.raised = raised;
    try {
      localStorage.setItem(KEY, String(this.scale));
    } catch {
      /* private mode */
    }
    this.apply(this.scale);
    this.rest(700);
  }
}
