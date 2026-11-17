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
    length: 26,
    slope: -0.08,
    turn: 0,
    teaches: 'Nothing in the way. The egg pulls ahead and the amber invites a first swipe.',
    hints: [{ at: 8, text: 'Swipe left or right' }],
    rows: [],
    amber: [A(4, 10, 0), A(14, 20, 1), A(23, 26, 0)],
  },
  {
    id: 'hollow',
    name: 'Fern hollow',
    length: 100,
    slope: -0.11,
    turn: [0.5, -0.6],
    teaches: 'Lanes. Something to go around every second and a half or so, singly and in pairs.',
    rows: [
      { at: 8, kind: 'boulder', lanes: [0] },
      { at: 21, kind: 'tree', lanes: [-1] },
      { at: 34, kind: 'boulder', lanes: [0] },
      { at: 47, kind: 'tree', lanes: [1], also: [{ kind: 'boulder', lanes: [-1] }] },
      { at: 60, kind: 'boulder', lanes: [0] },
      { at: 74, kind: 'boulder', lanes: [1] },
      { at: 77, kind: 'tree', lanes: [-1], onlyFor: 'find' },
      { at: 90, kind: 'boulder', lanes: [0], also: [{ kind: 'tree', lanes: [-1] }] },
    ],
    amber: [A(3, 13, -1), A(17, 26, 0), A(30, 39, 1), A(43, 52, 0), A(56, 70, 1), A(73, 82, 0), A(86, 96, 1)],
    finds: [{ at: 66, lane: -1, n: 1, risk: 'Off the amber line. Pass the boulder on the left, grab it, then step back before the tree.' }],
  },
  {
    id: 'drop1',
    name: 'First drop',
    length: 58,
    slope: -0.3,
    turn: 0.08,
    drop: true,
    teaches: 'The trail tips over and the valley opens up. Steep and clear, with a quick slalom of amber.',
    checkpoint: 0,
    rows: [],
    amber: [A(4, 11, 0), A(14, 21, 1), A(24, 31, 0), A(34, 41, -1), A(44, 51, 0), A(54, 57, 1)],
  },
  {
    id: 'windfall',
    name: 'Windfall',
    length: 86,
    slope: -0.09,
    turn: 0.45,
    teaches: 'Jumps. Logs and creeks, with a boulder between to keep the lanes in play.',
    hints: [{ at: 1, text: 'Swipe up to jump' }],
    rows: [
      { at: 14, kind: 'log' },
      { at: 27, kind: 'log' },
      { at: 40, kind: 'creek' },
      { at: 53, kind: 'boulder', lanes: [0] },
      { at: 65, kind: 'log' },
      { at: 77, kind: 'creek' },
    ],
    amber: [A(4, 9, 0), arc(14, 0), arc(27, -1), arc(40, 0), A(48, 58, 1), arc(65, 1), arc(77, 0), A(82, 85, 0)],
  },
  {
    id: 'giants',
    name: 'Under the giants',
    length: 78,
    slope: -0.12,
    turn: -0.6,
    teaches: 'Slides. Two propped trunks and the hollow log, then a jump and a slide back to back.',
    hints: [{ at: 2, text: 'Swipe down to slide' }],
    rows: [
      { at: 15, kind: 'arch' },
      { at: 28, kind: 'arch' },
      { at: 42, kind: 'hollow', lanes: [0] },
      { at: 56, kind: 'log' },
      { at: 68, kind: 'arch' },
    ],
    amber: [A(10, 20, 0, true), A(23, 33, -1, true), A(37, 46, 0, true), arc(56, 0), A(63, 73, 1, true)],
  },
  {
    id: 'fork',
    name: 'The old ginkgo',
    length: 108,
    slope: -0.08,
    turn: 0.3,
    teaches: 'The fork. Left is riskier and richer: five moves in a row. Right is safer: two easy jumps.',
    checkpoint: 0,
    labels: 0, // the two side labels show from here until the rock
    island: [30, 92],
    rows: [
      { at: 39, kind: 'log', branch: 'left' },
      { at: 50.5, kind: 'arch', branch: 'left' },
      { at: 62, kind: 'creek', branch: 'left' },
      { at: 73.5, kind: 'arch', branch: 'left' },
      { at: 85, kind: 'log', branch: 'left' },
      { at: 50, kind: 'log', branch: 'right' },
      { at: 73, kind: 'log', branch: 'right' },
    ],
    amber: [
      A(4, 28, -1), arc(39, -1), A(46, 54, -1, true), arc(62, -1), A(69, 77, -1, true), arc(85, -1), A(89, 91, -1),
      A(8, 8, 1), A(16, 16, 1), A(24, 24, 1), arc(50, 1), A(60, 60, 1), A(66, 66, 1), arc(73, 1), A(82, 82, 1),
      A(96, 106, 0),
    ],
    finds: [{ at: 62, lane: -1, n: 2, high: true, risk: 'On the risky side, at the top of the jump over the creek.' }],
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
    power: { at: 4, lane: 0, reach: 50 }, // the fans stay out for this many meters: to just past the last amber
    rows: [],
    amber: [A(10, 52, -1), A(10, 52, 0), A(10, 52, 1)],
  },
  {
    id: 'home',
    name: 'Home stretch',
    length: 94,
    slope: -0.06,
    turn: -0.45,
    teaches: 'Everything, mixed. It opens with a file of young Psittacosaurus crossing the trail.',
    rows: [
      { at: 10, kind: 'crossing' },
      { at: 22, kind: 'arch' },
      { at: 34, kind: 'boulder', lanes: [0], also: [{ kind: 'tree', lanes: [1] }] },
      { at: 46, kind: 'log' },
      { at: 58, kind: 'tree', lanes: [-1] },
      { at: 78, kind: 'creek' },
      { at: 90, kind: 'arch' },
    ],
    amber: [arc(10, 0), A(17, 27, 0, true), A(30, 39, -1), arc(46, -1), A(52, 55, -1), A(60, 72, 0), arc(78, 0), A(85, 93, 0, true)],
    retry: 49, // miss the catch at the edge and the run picks up again from here, about ten seconds back
    finds: [{ at: 66, lane: -1, n: 3, risk: 'Dart back in behind the tree, grab it, and still jump the creek.' }],
  },
  {
    id: 'edge',
    name: 'The edge',
    length: 30,
    slope: -0.02,
    turn: 0.2,
    teaches: 'The trail runs out on a shelf of rock over the valley. The egg stops, then rolls for the edge. Swipe up to dive and catch it.',
    hints: [{ at: 13, text: 'Swipe up!' }], // where the egg sets off again, 9 m short of the edge
    rows: [],
    amber: [A(1, 9, 0)],
    edge: 22, // where the ground ends
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
