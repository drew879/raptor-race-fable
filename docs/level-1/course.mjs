// Level 1, Jehol Forest: the course, as data. This is the plan Drew signs off on.
// The map page is drawn from it (make-map.mjs), and the game reads it directly (src/game/course.ts),
// so what was agreed is what gets built.
//
// Distances are meters along the trail from where the chase begins. Inside a section,
// positions are measured from the section's start. Lanes are -1 (left), 0, 1 (right).
//
// THE COURSE IS LAID OUT TO THE MUSIC (agreed 2026-11-18). The chase music is tied to the
// ground: a sixteenth note for every meter. So a beat is 4 m, a bar is 16 m (two seconds at the
// usual speed), and the music's loop of eight bars is 128 m. Everything here sits on that grid:
//   - every section is a whole number of bars;
//   - the swipe for an obstacle falls on a beat, and the obstacle stands 2 m further on
//     (a jump takes off on one beat and comes down on the next);
//   - amber lies on the eighths, every 2 m, and every line of it starts on a beat;
//   - the five pieces over a jump are five sixteenths, from the take-off beat to the landing;
//   - the chase is 39 bars, and the egg's dash for the edge begins with bar 40: the last bar of
//     the loop, on the chord that wants to go home. The catch lands where bar 41 would begin.

export const SPEED = 8; // meters per second
export const LANE = 0.68;
/** Meters to a beat and to a bar. */
export const BEAT = 4;
export const BAR = 16;

/** A place in a section: bar and beat, both counted from 1. */
const at = (bar, beat = 1) => (bar - 1) * BAR + (beat - 1) * BEAT;
/** Where an obstacle stands when its swipe falls on that beat. */
const past = (bar, beat = 1) => at(bar, beat) + 2;
/** A line of amber from a beat, lasting so many beats (halves allowed): a piece every 2 m. */
const line = (bar, beat, beats, lane, low = false) => ({ from: at(bar, beat), to: at(bar, beat) + beats * BEAT - 2, lane, low });
/** One piece of amber on a beat. */
const one = (bar, beat, lane) => line(bar, beat, 0.5, lane);
/** Amber in an arc over a jump whose swipe falls on that beat. */
const arc = (bar, beat, lane) => ({ arc: past(bar, beat), lane });

export const SECTIONS = [
  {
    id: 'nest',
    name: 'Off the nest',
    length: 2 * BAR,
    slope: -0.08,
    turn: 0,
    teaches: 'Nothing in the way and no amber yet. The egg pulls ahead, and the band plays alone.',
    rows: [],
    amber: [],
  },
  {
    id: 'hollow',
    name: 'Fern hollow',
    length: 6 * BAR,
    slope: -0.11,
    turn: [0.5, -0.6],
    teaches: 'Lanes. The first amber, then something to go around in every bar, and two closer together at the end.',
    hints: [{ at: 6, text: 'Swipe left or right' }],
    rows: [
      { at: past(2), kind: 'boulder', lanes: [0] },
      { at: past(3), kind: 'tree', lanes: [1] },
      { at: past(4), kind: 'tree', lanes: [1], also: [{ kind: 'boulder', lanes: [-1] }] },
      { at: past(5), kind: 'boulder', lanes: [0] },
      { at: past(5, 4), kind: 'boulder', lanes: [1] },
      { at: past(6, 3), kind: 'boulder', lanes: [0], also: [{ kind: 'tree', lanes: [-1] }] },
    ],
    amber: [line(1, 1, 2, 0), line(1, 4, 3, 1), line(2, 4, 3, 0), line(3, 4, 3, 0), line(4, 4, 2.5, 1), line(5, 3, 2.5, 0), line(6, 2, 3, 1)],
    finds: [{ at: at(5, 2) + 2, lane: -1, n: 1, risk: 'Off the amber line. Pass the boulder on the left, grab it, then get right across before the last pair.' }],
  },
  {
    id: 'drop1',
    name: 'First drop',
    length: 3 * BAR,
    slope: -0.3,
    turn: 0.08,
    drop: true,
    teaches: 'The trail tips over and the valley opens up as the music comes round again. Steep and clear, with a slalom of amber: three bells and a breath, six times.',
    checkpoint: 0,
    rows: [],
    amber: [line(1, 1, 1.5, 0), line(1, 3, 1.5, 1), line(2, 1, 1.5, 0), line(2, 3, 1.5, -1), line(3, 1, 1.5, 0), line(3, 3, 1.5, 1)],
  },
  {
    id: 'windfall',
    name: 'Windfall',
    length: 6 * BAR,
    slope: -0.09,
    turn: 0.45,
    teaches: 'Jumps. A log or a creek in every bar, a boulder to keep the lanes in play, and the last three closer together.',
    hints: [{ at: 6, text: 'Swipe up to jump' }],
    rows: [
      { at: past(2), kind: 'log' },
      { at: past(3), kind: 'log' },
      { at: past(4), kind: 'creek' },
      { at: past(5), kind: 'boulder', lanes: [0] },
      { at: past(5, 4), kind: 'log' },
      { at: past(6, 3), kind: 'creek' },
    ],
    amber: [line(1, 1, 3, 0), arc(2, 1, 0), line(2, 3, 1.5, -1), arc(3, 1, -1), line(3, 3, 1.5, 0), arc(4, 1, 0), line(4, 4, 3, 1), arc(5, 4, 1), arc(6, 3, 0)],
  },
  {
    id: 'giants',
    name: 'Under the giants',
    length: 5 * BAR,
    slope: -0.12,
    turn: -0.6,
    teaches: 'Slides. Two propped trunks and the hollow log, a bar apart, then a jump and a slide close together.',
    hints: [{ at: 6, text: 'Swipe down to slide' }],
    rows: [
      { at: past(2), kind: 'arch' },
      { at: past(3), kind: 'arch' },
      // (the hollow log is 3.4 m long and is placed by its middle: this puts its mouth 2 m past the beat, like everything else)
      { at: at(4) + 4, kind: 'hollow', lanes: [0] },
      { at: past(5), kind: 'log' },
      { at: past(5, 4), kind: 'arch' },
    ],
    amber: [line(1, 1, 2, 0), line(1, 4, 3, 0, true), line(2, 4, 3, -1, true), line(3, 4, 3, 0, true), arc(5, 1, 0), line(5, 3, 2.5, 0, true)],
  },
  {
    id: 'fork',
    name: 'The old ginkgo',
    length: 7 * BAR,
    slope: -0.08,
    turn: 0.3,
    teaches: 'The fork, which begins as the music comes round a fourth time. Left is riskier and richer: five moves three beats apart. Right is safer: two easy jumps.',
    checkpoint: 0,
    labels: 0, // the two side labels show from here until the rock
    island: [at(3), at(7)],
    rows: [
      { at: past(3, 3), kind: 'log', branch: 'left' },
      { at: past(4, 2), kind: 'arch', branch: 'left' },
      { at: past(5, 1), kind: 'creek', branch: 'left' },
      { at: past(5, 4), kind: 'arch', branch: 'left' },
      { at: past(6, 3), kind: 'log', branch: 'left' },
      { at: past(4, 1), kind: 'log', branch: 'right' },
      { at: past(6, 1), kind: 'log', branch: 'right' },
    ],
    amber: [
      line(1, 3, 6, -1), arc(3, 3, -1), line(4, 1, 2.5, -1, true), arc(5, 1, -1), line(5, 3, 2.5, -1, true), arc(6, 3, -1),
      one(1, 3, 1), one(2, 1, 1), one(2, 3, 1), one(3, 1, 1), arc(4, 1, 1), one(5, 1, 1), one(5, 3, 1), arc(6, 1, 1), one(6, 4, 1),
      line(7, 2, 3, 0),
    ],
    finds: [{ at: past(5, 1), lane: -1, n: 2, high: true, risk: 'On the risky side, at the top of the jump over the creek.' }],
  },
  {
    id: 'drop2',
    name: 'Second drop',
    length: 3 * BAR,
    slope: -0.28,
    turn: -0.1,
    drop: true,
    teaches: 'The power-up, on a steep clear pitch with amber in all three lanes: the fans sweep it all in, and the bells sound as chords.',
    checkpoint: 0,
    hints: [{ at: 6, text: 'Fan out! Catch it all' }],
    power: { at: at(1, 2), lane: 0, reach: 44 }, // the fans stay out for this many meters: to the foot of the drop
    rows: [],
    amber: [line(1, 3, 10, -1), line(1, 3, 10, 0), line(1, 3, 10, 1)],
  },
  {
    id: 'home',
    name: 'Home stretch',
    length: 7 * BAR,
    slope: -0.06,
    turn: -0.45,
    teaches: 'The last time round. Everything, mixed and three beats apart, opening with a file of young Psittacosaurus crossing the trail. Then a clear bar, and the edge.',
    rows: [
      { at: past(2), kind: 'crossing' },
      { at: past(2, 4), kind: 'arch' },
      { at: past(3, 3), kind: 'boulder', lanes: [0], also: [{ kind: 'tree', lanes: [1] }] },
      { at: past(4, 2), kind: 'log' },
      { at: past(5, 1), kind: 'tree', lanes: [-1] },
      { at: past(5, 4), kind: 'creek' },
      { at: past(6, 3), kind: 'arch' },
    ],
    amber: [line(1, 2, 2, 0), arc(2, 1, 0), line(2, 3, 2.5, 0, true), line(3, 2, 2, -1), arc(4, 2, -1), line(4, 4, 2.5, 0), arc(5, 4, 0), line(6, 2, 3, 0, true), line(7, 1, 4, 0)],
    retry: at(5), // miss the catch at the edge and the run picks up again from here: the top of bar 37, six seconds back
    finds: [{ at: at(5, 2) + 2, lane: -1, n: 3, risk: 'Dart back in behind the tree, grab it, and still jump the creek.' }],
  },
  {
    id: 'edge',
    name: 'The edge',
    length: BAR,
    slope: -0.02,
    turn: 0.2,
    teaches: 'The trail runs out over the valley, and bar 40 is the egg\'s dash for the edge: the whole band on the one chord that wants to go home. Swipe up to dive and catch it, and the music lands.',
    // The egg waits 9 m short of the edge, and sets off when the runner is 3.2 m behind it. That
    // puts the runner half a meter into the bar, and the catch, 1.94 s later, on the next downbeat.
    hints: [{ at: 3.7, text: 'Swipe up!' }],
    rows: [],
    amber: [],
    edge: 12.7, // where the ground ends
  },
];

export const MOVE = { boulder: 'around', tree: 'around', log: 'jump', creek: 'jump', crossing: 'jump', arch: 'slide', hollow: 'slide' };
export const KIND_NAME = {
  boulder: 'boulder',
  tree: 'tree',
  log: 'fallen log',
  creek: 'creek',
  crossing: 'young Psittacosaurus crossing',
  arch: 'propped trunk',
  hollow: 'hollow log',
};

// The chase itself. Numbers to tune by playtest; listed here so they are agreed with the layout.
export const EGG = {
  startLead: 15, // meters ahead when the chase begins
  closing: 0.13, // meters per second the runner gains while running clean and close behind
  closingFar: 0.6, // what that rises to as the egg's lead nears lostAt, so a bad patch can be won back (agreed 2026-11-16)
  bump: 3.2, // meters the egg gains per bump
  warnAt: 21,
  lostAt: 26,
};

/** Everything placed in absolute meters from the start of the chase. */
export function build() {
  let start = 0;
  const sections = [];
  const rows = [];
  const amber = [];
  const finds = [];
  const hints = [];
  const checkpoints = [];
  let power = null;
  let island = null;
  let labelsFrom = null;
  let retryFrom = null;
  let end = 0;
  for (const sec of SECTIONS) {
    const s0 = start;
    sections.push({ ...sec, start: s0, end: s0 + sec.length });
    for (const r of sec.rows) {
      const parts = [{ kind: r.kind, lanes: r.lanes ?? [-1, 0, 1] }, ...(r.also ?? [])];
      rows.push({ s: s0 + r.at, kind: r.kind, move: MOVE[r.kind], parts, branch: r.branch ?? null, onlyFor: r.onlyFor ?? null, section: sec.id });
    }
    for (const a of sec.amber) {
      if ('arc' in a) {
        // five pieces a meter apart, from where the jump takes off to where it comes down, highest in the middle
        for (let i = -2; i <= 2; i++) amber.push({ s: s0 + a.arc + i, lane: a.lane, lift: 0.34 + Math.cos((i / 2) * (Math.PI / 2)) * 0.6 });
      } else {
        for (let s = a.from; s <= a.to + 0.01; s += 2) amber.push({ s: s0 + s, lane: a.lane, lift: a.low ? 0.26 : 0.34 });
      }
    }
    for (const f of sec.finds ?? []) finds.push({ ...f, s: s0 + f.at, section: sec.id });
    for (const h of sec.hints ?? []) hints.push({ s: s0 + h.at, text: h.text });
    if (sec.checkpoint !== undefined) checkpoints.push(s0 + sec.checkpoint);
    if (sec.power) power = { ...sec.power, s: s0 + sec.power.at };
    if (sec.island) island = [s0 + sec.island[0], s0 + sec.island[1]];
    if (sec.labels !== undefined) labelsFrom = s0 + sec.labels;
    if (sec.retry !== undefined) retryFrom = s0 + sec.retry;
    if (sec.edge !== undefined) end = s0 + sec.edge;
    start += sec.length;
  }
  rows.sort((a, b) => a.s - b.s);
  amber.sort((a, b) => a.s - b.s);
  const chaseEnd = sections[sections.length - 1].start; // where the last shelf begins
  return { sections, rows, amber, finds, hints, checkpoints, power, island, labelsFrom, retryFrom, end, chaseEnd, total: start };
}

const blocked = (row) => [...new Set(row.parts.flatMap((p) => p.lanes))];

/** The checks the brief asks for, worked out from the data. */
export function check(level = build()) {
  const out = [];
  const gap = (list) => {
    let best = { d: Infinity, a: null, b: null };
    for (let i = 1; i < list.length; i++) {
      const d = list[i].s - list[i - 1].s;
      if (d < best.d) best = { d, a: list[i - 1], b: list[i] };
    }
    return best;
  };
  const main = level.rows.filter((r) => !r.onlyFor && r.branch !== 'left');
  const hard = level.rows.filter((r) => !r.onlyFor && r.branch !== 'right');
  const g1 = gap(main);
  const g2 = gap(hard);
  out.push({ rule: 'At least 1.4 s between moves, easy side', value: `${g1.d} m, ${(g1.d / SPEED).toFixed(2)} s`, ok: g1.d / SPEED >= 1.4 });
  out.push({ rule: 'At least 1.4 s between moves, hard side', value: `${g2.d} m, ${(g2.d / SPEED).toFixed(2)} s`, ok: g2.d / SPEED >= 1.4 });
  const drops = level.sections.filter((s) => s.drop);
  const onDrop = level.rows.filter((r) => drops.some((d) => r.s >= d.start - 0.01 && r.s <= d.end + 0.01));
  out.push({ rule: 'Nothing but amber on the two steep drops', value: `${onDrop.length} obstacles`, ok: onDrop.length === 0 });
  for (const d of drops) {
    const next = level.rows.find((r) => r.s > d.end);
    if (next) out.push({ rule: `First obstacle after the ${d.name.toLowerCase()}`, value: `${(next.s - d.end).toFixed(0)} m past its foot, in view all the way down`, ok: next.s - d.end >= 10 });
  }
  const firstOf = (move) => level.rows.find((r) => r.move === move);
  for (const [text, move] of [['Swipe left or right', 'around'], ['Swipe up to jump', 'jump'], ['Swipe down to slide', 'slide']]) {
    const h = level.hints.find((x) => x.text === text);
    const r = firstOf(move);
    out.push({ rule: `"${text}" hint before the first one`, value: `${((r.s - h.s) / SPEED).toFixed(1)} s ahead`, ok: (r.s - h.s) / SPEED >= 1.4 });
  }
  // ---- the music's grid
  const onBeat = (s) => Math.abs(s / BEAT - Math.round(s / BEAT)) < 1e-6;
  const offBeat = level.rows.filter((r) => !onBeat(r.s - (r.kind === 'hollow' ? 4 : 2)));
  out.push({ rule: 'Every swipe falls on a beat (the obstacle 2 m on)', value: offBeat.length ? `${offBeat.length} do not` : `all ${level.rows.length}`, ok: offBeat.length === 0 });
  const odd = level.sections.filter((s) => s.edge === undefined && s.length % BAR !== 0);
  out.push({ rule: 'Every section is a whole number of bars', value: odd.length ? odd.map((s) => s.name).join(', ') : `${level.chaseEnd / BAR} bars of chase`, ok: odd.length === 0 });
  const offGrid = level.amber.filter((a) => Math.abs(a.s - Math.round(a.s)) > 1e-6 || (a.lift < 0.4 && Math.round(a.s) % 2 !== 0));
  out.push({ rule: 'Amber on the eighths, and over a jump on the sixteenths', value: offGrid.length ? `${offGrid.length} pieces off the grid` : `all ${level.amber.length}`, ok: offGrid.length === 0 });
  const lines = level.sections.flatMap((s) => s.amber.filter((a) => !('arc' in a)).map((a) => s.start + a.from));
  const late = lines.filter((s) => !onBeat(s));
  out.push({ rule: 'Every line of amber starts on a beat', value: late.length ? `${late.length} do not` : `all ${lines.length}`, ok: late.length === 0 });
  const dashAt = level.end - 9 - 3.2;
  out.push({ rule: "The egg's dash begins with the last bar of the loop", value: `${dashAt.toFixed(1)} m, ${(dashAt % (8 * BAR)).toFixed(1)} m into the loop (bar 8 begins at ${7 * BAR})`, ok: dashAt % (8 * BAR) >= 7 * BAR && dashAt % (8 * BAR) < 7 * BAR + 1 });
  out.push({ rule: 'A missed catch retries from the top of a bar', value: `${level.retryFrom} m, bar ${level.retryFrom / BAR + 1}`, ok: level.retryFrom % BAR === 0 });
  for (let i = 1; i < level.hints.length; i++) {
    const d = (level.hints[i].s - level.hints[i - 1].s) / SPEED;
    if (d < 2.8) out.push({ rule: 'Hints never overlap', value: `${d.toFixed(1)} s apart`, ok: false });
  }
  out.push({ rule: 'Hints never overlap (each shows 2.8 s)', value: `closest two are ${Math.min(...level.hints.slice(1).map((h, i) => (h.s - level.hints[i].s) / SPEED)).toFixed(0)} s apart`, ok: true });
  return out;
}

export function stats(level = build()) {
  const main = level.rows.filter((r) => !r.onlyFor && r.branch !== 'left');
  const hard = level.rows.filter((r) => !r.onlyFor && r.branch !== 'right');
  const fork = level.sections.find((s) => s.island);
  const inFork = (a) => fork && a.s >= fork.start && a.s < level.island[1];
  return {
    chase: level.chaseEnd,
    seconds: level.chaseEnd / SPEED,
    movesEasy: main.length + 1, // + picking a side
    movesHard: hard.length + 1,
    amber: level.amber.length,
    amberLeft: level.amber.filter((a) => inFork(a) && a.lane === -1).length,
    amberRight: level.amber.filter((a) => inFork(a) && a.lane === 1).length,
    // the most a run can take: every piece but those on the fork's poorer side
    amberBest: level.amber.length - Math.min(level.amber.filter((a) => inFork(a) && a.lane === -1).length, level.amber.filter((a) => inFork(a) && a.lane === 1).length),
    bars: level.chaseEnd / BAR,
    dashAt: level.end - 9 - 3.2,
    drop: level.sections.reduce((sum, s) => sum + s.length * -s.slope, 0),
  };
}

/** The lane the egg takes past a row it has to go around: an open lane without amber if there is one. */
export function eggLane(level, row) {
  const open = [-1, 0, 1].filter((l) => !blocked(row).includes(l));
  const quiet = open.filter((l) => !level.amber.some((a) => a.lane === l && Math.abs(a.s - row.s) < 4));
  const pick = quiet.length ? quiet : open;
  const from = Math.sin(row.s * 0.13) * 0.36;
  return pick.reduce((best, l) => (Math.abs(l * LANE - from) < Math.abs(best * LANE - from) ? l : best), pick[0] ?? 0);
}
