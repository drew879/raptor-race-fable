// Level 1, Jehol Forest: the proposed course, as data. This is the plan Drew signs off on.
// The map page is drawn from it (make-map.mjs), and once it is approved the game's level file
// is ported from it, so what was agreed is what gets built.
//
// Distances are meters along the trail from where the chase begins. Inside a section,
// positions are measured from the section's start. Lanes are -1 (left), 0, 1 (right).

export const SPEED = 8; // meters per second
export const LANE = 0.68;

const A = (from, to, lane, low = false) => ({ from, to, lane, low }); // a line of amber
const arc = (at, lane) => ({ arc: at, lane }); // amber in an arc over a jump

export const SECTIONS = [
  {
    id: 'nest',
    name: 'Off the nest',
    length: 34,
    slope: -0.08,
    turn: 0,
    teaches: 'Nothing in the way. The egg pulls ahead and the amber invites a first swipe.',
    hints: [{ at: 14, text: 'Swipe left or right' }],
    rows: [],
    amber: [A(6, 14, 0), A(18, 26, 1), A(30, 34, 0)],
  },
  {
    id: 'hollow',
    name: 'Fern hollow',
    length: 110,
    slope: -0.11,
    turn: [0.5, -0.6],
    teaches: 'Lanes. One thing to go around at a time, then two.',
    rows: [
      { at: 10, kind: 'boulder', lanes: [0] },
      { at: 24, kind: 'tree', lanes: [-1] },
      { at: 38, kind: 'boulder', lanes: [0] },
      { at: 52, kind: 'tree', lanes: [1], also: [{ kind: 'boulder', lanes: [-1] }] },
      { at: 66, kind: 'boulder', lanes: [0] },
      { at: 84, kind: 'tree', lanes: [-1], onlyFor: 'find' },
      { at: 98, kind: 'tree', lanes: [-1], also: [{ kind: 'tree', lanes: [1] }] },
    ],
    amber: [A(0, 2, 0), A(5, 15, -1), A(19, 29, 0), A(33, 43, 1), A(47, 57, 0), A(61, 90, 1), A(94, 106, 0)],
    finds: [{ at: 73, lane: -1, n: 1, risk: 'Off the amber line. Pass the boulder on the left, grab it, then step back before the tree.' }],
  },
  {
    id: 'drop1',
    name: 'First drop',
    length: 65,
    slope: -0.3,
    turn: 0.08,
    drop: true,
    teaches: 'The trail tips over and the valley opens up. Steep and clear: amber only.',
    checkpoint: 0,
    rows: [],
    amber: [A(4, 14, 0), A(18, 28, 1), A(32, 42, 0), A(46, 58, -1)],
  },
  {
    id: 'windfall',
    name: 'Windfall',
    length: 85,
    slope: -0.09,
    turn: 0.45,
    teaches: 'Jumps. Two logs, the first creek, then a boulder and a log in a row.',
    hints: [{ at: 3, text: 'Swipe up to jump' }],
    rows: [
      { at: 17, kind: 'log' },
      { at: 31, kind: 'log' },
      { at: 47, kind: 'creek' },
      { at: 63, kind: 'boulder', lanes: [0] },
      { at: 75, kind: 'log' },
    ],
    amber: [A(5, 11, 0), arc(17, 0), arc(31, -1), A(38, 41, 0), arc(47, 0), A(57, 68, 1), arc(75, 1), A(80, 84, 1)],
  },
  {
    id: 'giants',
    name: 'Under the giants',
    length: 75,
    slope: -0.12,
    turn: -0.6,
    teaches: 'Slides. Two propped trunks, then the hollow log: the only way is through it.',
    hints: [{ at: 4, text: 'Swipe down to slide' }],
    rows: [
      { at: 18, kind: 'arch' },
      { at: 32, kind: 'arch' },
      { at: 48, kind: 'hollow', lanes: [0] },
    ],
    amber: [A(13, 23, 0, true), A(27, 37, -1, true), A(44, 52, 0, true), A(56, 70, 0)],
  },
  {
    id: 'fork',
    name: 'The old ginkgo',
    length: 80,
    slope: -0.08,
    turn: 0.3,
    teaches: 'The fork. The trail splits around a giant ginkgo on a rock. Left is harder and richer; right is easy.',
    checkpoint: 0,
    hints: [{ at: 0, text: 'The trail splits! Pick a side' }],
    island: [17, 65],
    rows: [
      { at: 27, kind: 'log', branch: 'left' },
      { at: 39, kind: 'arch', branch: 'left' },
      { at: 51, kind: 'creek', branch: 'left' },
      { at: 39, kind: 'log', branch: 'right' },
    ],
    amber: [
      A(4, 16, -1), A(19, 23, -1), arc(27, -1), A(31, 33, -1), A(35, 43, -1, true), A(45, 47, -1), arc(51, -1), A(55, 63, -1),
      A(8, 8, 1), A(12, 12, 1), A(21, 21, 1), A(29, 29, 1), arc(39, 1), A(49, 49, 1), A(57, 57, 1),
      A(68, 78, 0),
    ],
    finds: [{ at: 51, lane: -1, n: 2, high: true, risk: 'On the hard side, at the top of the jump over the creek.' }],
  },
  {
    id: 'drop2',
    name: 'Second drop',
    length: 55,
    slope: -0.28,
    turn: -0.1,
    drop: true,
    teaches: 'The power-up, on a steep clear pitch with amber in all three lanes.',
    checkpoint: 0,
    hints: [{ at: 2, text: 'Fan out! Catch it all' }],
    power: { at: 4, lane: 0, lasts: 7.5 }, // long enough to reach the last row of amber on the drop
    rows: [],
    amber: [A(10, 52, -1), A(10, 52, 0), A(10, 52, 1)],
  },
  {
    id: 'home',
    name: 'Home stretch',
    length: 80,
    slope: -0.06,
    turn: -0.45,
    teaches: 'Everything, mixed, at the same unhurried spacing.',
    rows: [
      { at: 12, kind: 'psittaco', lanes: [0] },
      { at: 26, kind: 'log' },
      { at: 40, kind: 'arch' },
      { at: 52, kind: 'tree', lanes: [1] },
      { at: 72, kind: 'creek' },
    ],
    amber: [A(6, 18, -1), arc(26, -1), A(35, 45, 0, true), A(47, 58, -1), arc(72, 0), A(77, 80, 0)],
    finds: [{ at: 60, lane: 1, n: 3, risk: 'Dart in behind the tree, grab it, and still jump the creek.' }],
  },
  {
    id: 'clearing',
    name: 'The clearing',
    length: 30,
    slope: -0.02,
    turn: 0.2,
    teaches: 'The egg slows on the moss. Swipe up to scoop it. Then the hatching.',
    hints: [{ at: 2, text: 'Swipe up to scoop the egg!' }],
    rows: [],
    amber: [A(1, 9, 0)],
    rest: 16, // where the egg comes to rest
  },
];

export const MOVE = { boulder: 'around', tree: 'around', psittaco: 'around', log: 'jump', creek: 'jump', arch: 'slide', hollow: 'slide' };
export const KIND_NAME = {
  boulder: 'boulder',
  tree: 'tree',
  psittaco: 'dozing Psittacosaurus',
  log: 'fallen log',
  creek: 'creek',
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
        // five pieces spread over the 4.5 m a jump covers at this speed, highest in the middle
        for (let i = -2; i <= 2; i++) amber.push({ s: s0 + a.arc + i * 1.12, lane: a.lane, lift: 0.34 + Math.cos((i / 2) * (Math.PI / 2)) * 0.6 });
      } else {
        for (let s = a.from; s <= a.to + 0.01; s += 2) amber.push({ s: s0 + s, lane: a.lane, lift: a.low ? 0.26 : 0.34 });
      }
    }
    for (const f of sec.finds ?? []) finds.push({ ...f, s: s0 + f.at, section: sec.id });
    for (const h of sec.hints ?? []) hints.push({ s: s0 + h.at, text: h.text });
    if (sec.checkpoint !== undefined) checkpoints.push(s0 + sec.checkpoint);
    if (sec.power) power = { ...sec.power, s: s0 + sec.power.at };
    if (sec.island) island = [s0 + sec.island[0], s0 + sec.island[1]];
    if (sec.rest !== undefined) end = s0 + sec.rest;
    start += sec.length;
  }
  rows.sort((a, b) => a.s - b.s);
  amber.sort((a, b) => a.s - b.s);
  const chaseEnd = sections[sections.length - 1].start; // where the clearing begins
  return { sections, rows, amber, finds, hints, checkpoints, power, island, end, chaseEnd, total: start };
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
  const inFork = (a) => level.island && a.s > level.island[0] - 14 && a.s < level.island[1];
  return {
    chase: level.chaseEnd,
    seconds: level.chaseEnd / SPEED,
    movesEasy: main.length + 1, // + picking a side
    movesHard: hard.length + 1,
    amber: level.amber.length,
    amberLeft: level.amber.filter((a) => inFork(a) && a.lane === -1).length,
    amberRight: level.amber.filter((a) => inFork(a) && a.lane === 1).length,
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
