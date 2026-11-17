// Level 1, Jehol Forest: the course the game runs. It is read from the layout Drew signed off
// (docs/level-1/course.mjs, which also draws the course map), so the two can't drift apart.
//
// Distances are meters along the trail. Lanes are -1 (left), 0, 1 (right).

import { build, EGG } from '../../docs/level-1/course.mjs';
import { smoothstep } from '../world/noise';
import type { Segment } from '../world/track';

export const LANE = 0.68;
export const DEFAULT_SPEED = 8; // meters per second

export type ObstacleKind = 'log' | 'arch' | 'boulder' | 'tree' | 'creek' | 'hollow' | 'crossing';

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
/** The nest sits on a level shelf this long from the trail's start, and the trail tips away below it at this slope. */
export const NEST_SHELF = 3.95;
const NEST_PITCH = -0.4;
/** How steeply the ground falls away at the end of the trail, in radians. */
const CLIFF = -1.25;
level.sections.forEach((sec, i) => {
  const turns = Array.isArray(sec.turn) ? sec.turn : [sec.turn];
  const length = sec.length + (i === 0 ? LEAD_IN : 0);
  if (i === 0) {
    // An egg that goes over the nest's rim has a slope to roll down. The pitch is short, and
    // the trail eases back to the section's own slope below it.
    SEGMENTS.push(
      { length: NEST_SHELF, slope: -0.02 },
      { length: 1.8, slope: NEST_PITCH },
      { length: 2.4, slope: NEST_PITCH },
      { length: 4.6, slope: sec.slope },
      { length: length - NEST_SHELF - 8.8, turn: turns[0], slope: sec.slope },
    );
    return;
  }
  if (sec.edge !== undefined) {
    // The last shelf: level out to its edge, and there the ground stops. A short lip, and a long way down.
    SEGMENTS.push(
      { length: sec.edge * 0.3, turn: turns[0] * 0.3, slope: sec.slope },
      { length: sec.edge * 0.7, turn: turns[0] * 0.7, slope: sec.slope },
      { length: 1, slope: CLIFF },
      { length: 80, slope: CLIFF },
    );
    return;
  }
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
export const START_SLOPE = -0.02;

/** Stretches where tall trees stay off the valley side so the view opens up: the two drops. */
export const VISTAS: [number, number][] = level.sections.filter((s) => s.drop).map((s) => [at(s.start - 22), at(s.end + 12)]);
VISTAS.push([at(level.end - 46), at(level.end + 5)]); // and the last of the trail, where it runs out over the valley

// ---------------------------------------------------------------- the fork
const BOW = 1.05; // meters each side lane swings out round the island
/** The stretch of trail the island stands in, or null if the course has no fork. */
export const FORK = level.island ? { from: at(level.island[0]), to: at(level.island[1]) } : null;
/** Where the two labels that explain the fork's sides come up. */
export const FORK_LABELS_FROM = level.labelsFrom === null ? -1 : at(level.labelsFrom);
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
      OBSTACLES.push({ s, kind, lanes: kind === 'log' || kind === 'arch' || kind === 'creek' || kind === 'crossing' ? ALL : part.lanes });
    }
  }
}
OBSTACLES.sort((a, b) => a.s - b.s);

// in trail order: the run draws and collects amber in batches along the trail
export const AMBER: Amber[] = level.amber.map((a) => ({ s: at(a.s), lane: a.lane, lift: a.lift }));

/** The one power-up, "Fan out": the runner spreads its fans and sweeps in amber from every lane. */
export const POWER = level.power ? { s: at(level.power.s), lane: level.power.lane, reach: level.power.reach } : { s: -100, lane: 0, reach: 0 };

/** Hidden finds: off the amber line, one each in the lanes section, the fork's hard side and the home stretch. */
export const FINDS = level.finds.map((f) => ({ s: at(f.s), lane: f.lane, lift: f.high ? 0.95 : 0.4, n: f.n }));
/** Where a run restarts if the egg gets away. */
export const CHECKPOINTS = level.checkpoints.map(at);

/** Where the ground ends: the edge the egg makes for. */
export const END_S = at(level.end);
/** Where the run picks up again if the catch at the edge is missed. */
export const RETRY_S = level.retryFrom === null ? at(0) : at(level.retryFrom);

/** First-time hints. (Fan out's shows when the leaf is taken; the last one comes with the egg's dash for the edge.) */
export const HINTS: { s: number; text: string }[] = level.hints
  .filter((h) => !h.text.startsWith('Fan out') && h.text !== 'Swipe up!')
  .map((h) => ({ s: at(h.s), text: h.text }));

/** The chase's numbers, as agreed with the layout. */
export const CHASE = EGG;
