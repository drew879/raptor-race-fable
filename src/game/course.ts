// Level 1, Jehol Forest: the course the game runs. It is read from the layout Drew signed off
// (docs/level-1/course.mjs, which also draws the course map), so the two can't drift apart.
//
// Distances are meters along the trail. Lanes are -1 (left), 0, 1 (right).

import { build, EGG } from '../../docs/level-1/course.mjs';
import { smoothstep } from '../world/noise';
import type { Segment } from '../world/track';

export const LANE = 0.68;
export const DEFAULT_SPEED = 8; // meters per second

export type ObstacleKind = 'log' | 'arch' | 'boulder' | 'tree' | 'creek' | 'hollow' | 'psittaco';

export interface Obstacle {
  s: number;
  kind: ObstacleKind;
  /** Lanes it blocks. Logs, creeks and arches span the trail. A hollow log lies in its one lane, with boulders (their own obstacles) closing the others. */
  lanes: number[];
  /** In the fork, the side it is on (-1 left, 1 right): each side is a single lane. */
  branch?: number;
}

export interface Amber {
  s: number;
  lane: number;
  lift: number; // height above the trail
}

const level = build();
/** The layout counts from where the chase begins; the trail itself starts a little before that. */
const LEAD_IN = 3;
const at = (s: number) => s + LEAD_IN;

// ---------------------------------------------------------------- the trail
// Each section tips to its own slope over its first stretch and then holds it, so a drop
// visibly falls away at its top instead of easing in along its whole length.
export const SEGMENTS: Segment[] = [];
level.sections.forEach((sec, i) => {
  const turns = Array.isArray(sec.turn) ? sec.turn : [sec.turn];
  const length = sec.length + (i === 0 ? LEAD_IN : 0);
  const lead = sec.drop ? 0.4 : 0.3;
  turns.forEach((turn, k) => {
    const part = length / turns.length;
    if (k === 0) {
      SEGMENTS.push({ length: part * lead, turn: turn * lead, slope: sec.slope });
      SEGMENTS.push({ length: part * (1 - lead), turn: turn * (1 - lead), slope: sec.slope });
    } else {
      SEGMENTS.push({ length: part, turn, slope: sec.slope });
    }
  });
});
SEGMENTS.push({ length: 50, turn: 0.1, slope: -0.02 }); // ground beyond the clearing
export const START_SLOPE = -0.06;

/** Stretches where tall trees stay off the valley side so the view opens up: the two drops. */
export const VISTAS: [number, number][] = level.sections.filter((s) => s.drop).map((s) => [at(s.start - 22), at(s.end + 12)]);

// ---------------------------------------------------------------- the fork
const BOW = 1.05; // meters each side lane swings out round the island
/** The stretch of trail the island stands in, or null if the course has no fork. */
export const FORK = level.island ? { from: at(level.island[0]), to: at(level.island[1]) } : null;
/** How far the side lanes have swung apart at s. */
export const bowAt = (s: number): number =>
  FORK ? smoothstep(FORK.from - 12, FORK.from + 3, s) * (1 - smoothstep(FORK.to - 3, FORK.to + 12, s)) * BOW : 0;
/** Where a lane's middle is across the trail at s. */
export const laneU = (lane: number, s: number): number => lane * LANE + Math.sign(lane) * bowAt(s);
/** The reverse, for the ground: a point's place across the trail as if the lanes ran straight. */
export const laneMap = (u: number, s: number): number => {
  const b = bowAt(s);
  if (b <= 0) return u;
  const a = Math.abs(u);
  const half = LANE / 2;
  return Math.sign(u) * (a <= half + b ? (a * half) / (half + b) : a - b);
};

// ---------------------------------------------------------------- obstacles
const ALL = [-1, 0, 1];
export const OBSTACLES: Obstacle[] = [];
for (const row of level.rows) {
  const s = at(row.s);
  if (row.branch) {
    const side = row.branch === 'left' ? -1 : 1;
    OBSTACLES.push({ s, kind: row.kind as ObstacleKind, lanes: [side], branch: side });
    continue;
  }
  for (const part of row.parts) {
    const kind = part.kind as ObstacleKind;
    if (kind === 'hollow') {
      // boulders close the lanes beside the hollow log's mouth, so the only way is through it
      for (const lane of ALL) if (!part.lanes.includes(lane)) OBSTACLES.push({ s: s - 2.2, kind: 'boulder', lanes: [lane] });
      OBSTACLES.push({ s, kind, lanes: part.lanes });
    } else {
      OBSTACLES.push({ s, kind, lanes: kind === 'log' || kind === 'arch' || kind === 'creek' ? ALL : part.lanes });
    }
  }
}
OBSTACLES.sort((a, b) => a.s - b.s);

// in trail order: the run draws and collects amber in batches along the trail
export const AMBER: Amber[] = level.amber.map((a) => ({ s: at(a.s), lane: a.lane, lift: a.lift }));

/** The one power-up, "Fan out": the runner spreads its fans and sweeps in amber from every lane. */
export const POWER = level.power ? { s: at(level.power.s), lane: level.power.lane, lasts: level.power.lasts } : { s: -100, lane: 0, lasts: 0 };

/** Hidden finds: off the amber line, one each in the lanes section, the fork's hard side and the home stretch. */
export const FINDS = level.finds.map((f) => ({ s: at(f.s), lane: f.lane, lift: f.high ? 0.95 : 0.4, n: f.n }));
/** Where a run restarts if the egg gets away. */
export const CHECKPOINTS = level.checkpoints.map(at);

/** Where the egg comes to rest. */
export const END_S = at(level.end);

/** First-time hints. (Fan out's shows when the leaf is taken; the scoop's comes with the ending.) */
export const HINTS: { s: number; text: string }[] = level.hints
  .filter((h) => !h.text.startsWith('Fan out') && !h.text.includes('scoop'))
  .map((h) => ({ s: at(h.s), text: h.text }));

/** The chase's numbers, as agreed with the layout. */
export const CHASE = EGG;
