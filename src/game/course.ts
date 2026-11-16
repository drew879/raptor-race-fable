// The rough test course. This is for feeling out controls, speed, camera and the downhill.
// It is not the Level 1 layout: that gets a course map and a sign-off first.
//
// Distances are meters along the trail. Lanes are -1 (left), 0, 1 (right).

import type { Segment } from '../world/track';

export const LANE = 0.68;
export const DEFAULT_SPEED = 7; // meters per second

export type ObstacleKind = 'log' | 'arch' | 'boulder' | 'tree';

export interface Obstacle {
  s: number;
  kind: ObstacleKind;
  /** Lanes it blocks. Logs and arches span the trail. */
  lanes: number[];
}

export interface Amber {
  s: number;
  lane: number;
  lift: number; // height above the trail
}

const ALL = [-1, 0, 1];
const O = (s: number, kind: ObstacleKind, ...lanes: number[]): Obstacle => ({
  s,
  kind,
  lanes: kind === 'log' || kind === 'arch' ? ALL : lanes,
});

export const SEGMENTS: Segment[] = [
  { length: 40, slope: -0.08 }, // warm-up
  { length: 50, turn: 0.5, slope: -0.12 }, // lanes
  { length: 50, turn: -0.6, slope: -0.1 }, // jumps, then slides
  { length: 32, turn: 0.05, slope: -0.3 }, // the trail tips over: first view of the valley
  { length: 30, turn: 0.1, slope: -0.3 }, // steep and clear, amber only
  { length: 40, turn: 0.4, slope: -0.08 },
  { length: 60, turn: -0.7, slope: -0.14 }, // mixed
  { length: 50, turn: 0.5, slope: -0.1 },
  { length: 32, turn: -0.05, slope: -0.28 }, // second drop
  { length: 30, turn: -0.1, slope: -0.28 },
  { length: 60, turn: -0.4, slope: -0.05 },
  { length: 56, turn: 0.2, slope: -0.02 }, // out into the clearing
];
export const START_SLOPE = -0.06;

/** Stretches where tall trees stay off the valley side so the view opens up. */
export const VISTAS: [number, number][] = [
  [128, 215],
  [338, 425],
];

export const OBSTACLES: Obstacle[] = [
  // one thing at a time: lanes
  O(34, 'boulder', 0),
  O(46, 'tree', -1),
  O(58, 'boulder', 1),
  O(70, 'tree', 0),
  O(70, 'boulder', -1),
  // jumps
  O(86, 'log'),
  O(100, 'log'),
  O(113, 'log'),
  // slides
  O(128, 'arch'),
  O(141, 'arch'),
  // (first drop: nothing in the way)
  // mixed
  O(214, 'boulder', 0),
  O(226, 'log'),
  O(238, 'arch'),
  O(251, 'tree', -1),
  O(251, 'tree', 1),
  O(263, 'log'),
  O(276, 'boulder', 1),
  O(276, 'boulder', 0),
  O(288, 'arch'),
  O(300, 'log'),
  O(313, 'tree', 0),
  O(325, 'log'),
  O(337, 'arch'),
  // (second drop)
  O(422, 'log'),
  O(434, 'boulder', -1),
  O(446, 'arch'),
  O(458, 'tree', 1),
  O(458, 'boulder', 0),
  O(470, 'log'),
];

/** Where the egg comes to rest. */
export const END_S = 512;

const SPACING = 1.75; // a quarter second apart at the default speed
const FLOAT = 0.34;

function line(out: Amber[], s0: number, s1: number, lane: number, lift = FLOAT) {
  for (let s = s0; s <= s1 + 0.01; s += SPACING) out.push({ s, lane, lift });
}
function arc(out: Amber[], center: number, lane: number) {
  for (let i = -2; i <= 2; i++) {
    out.push({ s: center + i * 0.95, lane, lift: FLOAT + Math.cos((i / 2) * (Math.PI / 2)) * 0.6 });
  }
}

function buildAmber(): Amber[] {
  const a: Amber[] = [];
  line(a, 8, 24, 0);
  line(a, 28, 38, -1); // around the first boulder
  line(a, 42, 51, 0);
  line(a, 54, 62, -1);
  line(a, 65, 76, 1);
  arc(a, 86, 0);
  line(a, 91, 95, 0);
  arc(a, 100, -1);
  arc(a, 113, 1);
  line(a, 123, 133, 0, 0.26); // low, under the arch
  line(a, 137, 145, 1, 0.26);
  // first drop: a slalom of amber down the steep pitch
  line(a, 152, 162, 0);
  line(a, 165, 175, 1);
  line(a, 178, 188, 0);
  line(a, 191, 203, -1);
  line(a, 208, 218, 1);
  arc(a, 226, 0);
  line(a, 233, 243, -1, 0.26);
  line(a, 246, 256, 0);
  arc(a, 263, 1);
  line(a, 270, 281, -1);
  line(a, 284, 292, 0, 0.26);
  arc(a, 300, -1);
  line(a, 307, 318, 1);
  arc(a, 325, 0);
  line(a, 332, 341, 1, 0.26);
  // second drop
  line(a, 350, 361, 0);
  line(a, 364, 375, -1);
  line(a, 378, 389, 0);
  line(a, 392, 404, 1);
  line(a, 408, 414, 0);
  arc(a, 422, 0);
  line(a, 428, 439, 1);
  line(a, 442, 450, 0, 0.26);
  line(a, 453, 462, -1);
  arc(a, 470, 0);
  line(a, 478, 502, 0);
  return a;
}

export const AMBER: Amber[] = buildAmber();

export const HINTS: { s: number; text: string }[] = [
  { s: 18, text: 'Swipe left or right' },
  { s: 72, text: 'Swipe up to jump' },
  { s: 114, text: 'Swipe down to slide' },
];
