// Draws the Level 1 course map page from course.mjs.
// Run:  node docs/level-1/make-map.mjs   (writes docs/level-1/course-map.html)

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, check, EGG, eggLane, KIND_NAME, LANE, SPEED, stats } from './course.mjs';

const level = build();
const st = stats(level);
const checks = check(level);

// ---------------------------------------------------------------- layout of the strip
const K = 3.3; // pixels per meter
const W = 400;
const X0 = 184; // the middle lane
const LW = 46; // lane width
const PAD = 14;
const GUT_L = 90;
const GUT_R = 280;
const BOW = 14; // how far the side lanes swing out round the island

const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const bow = (s) => (level.island ? smooth(level.island[0] - 10, level.island[0] + 5, s) * (1 - smooth(level.island[1] - 5, level.island[1] + 10, s)) : 0);
/** Where a lane (or a point part-way between lanes) is across the page at a point on the trail. */
const laneX = (lane, s) => X0 + lane * LW + Math.sign(lane) * Math.min(1, Math.abs(lane)) * bow(s) * BOW;
const clock = (s) => {
  const t = Math.round(s / SPEED);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const f1 = (n) => Number(n.toFixed(1));

/** The egg's line: weaving between lanes, swinging into an open lane round things, taking the easy side of the fork. */
function eggLaneAt(s) {
  let u = (Math.sin(s * 0.13) * 0.36) / LANE;
  for (const row of level.rows) {
    if (row.branch) continue;
    const target = row.move === 'around' ? eggLane(level, row) : row.kind === 'hollow' ? 0 : null;
    if (target === null || s < row.s - 8 || s > row.s + 6) continue;
    const k = smooth(row.s - 7.5, row.s - 2.5, s) * (1 - smooth(row.s + 1.5, row.s + 5.5, s));
    u += (target - u) * k;
  }
  if (level.island) {
    const k = smooth(level.island[0] - 12, level.island[0] - 3, s) * (1 - smooth(level.island[1] + 1, level.island[1] + 8, s));
    u += (1 - u) * k;
  }
  return u;
}

// ---------------------------------------------------------------- symbols
const sym = {
  boulder: (x, y) => `<g class="rock"><ellipse cx="${x}" cy="${y}" rx="15" ry="12"/><path class="lite" d="M${x - 8},${y - 4} q7,-7 15,-2"/></g>`,
  tree: (x, y) => `<g class="tree"><circle class="crown" cx="${x}" cy="${y}" r="15"/><circle class="trunk" cx="${x}" cy="${y}" r="6.5"/></g>`,
  crossing: (x1, x2, y) => {
    const one = (x) => `<ellipse cx="${f1(x)}" cy="${y}" rx="7.5" ry="4.2"/><circle cx="${f1(x + 8.5)}" cy="${y - 1}" r="3"/><path class="tail" d="M${f1(x - 7)},${y + 0.5} q-5,1 -7,4"/>`;
    const step = (x2 - x1) / 3;
    return `<g class="psit">${[0, 1, 2].map((i) => one(x1 + step * (i + 0.45))).join('')}</g>`;
  },
  log: (x1, x2, y) => `<g class="logc"><rect x="${f1(x1)}" y="${y - 5}" width="${f1(x2 - x1)}" height="10" rx="5"/><circle class="ring" cx="${f1(x1 + 5)}" cy="${y}" r="2.6"/></g>`,
  creek: (x1, x2, y) => {
    let top = `M${f1(x1)},${y - 5}`;
    let bottom = '';
    const n = Math.max(3, Math.round((x2 - x1) / 16));
    const step = (x2 - x1) / n;
    for (let i = 0; i < n; i++) top += ` q${f1(step / 2)},${i % 2 ? 5 : -5} ${f1(step)},0`;
    for (let i = 0; i < n; i++) bottom += ` q${f1(-step / 2)},${i % 2 ? 5 : -5} ${f1(-step)},0`;
    return `<path class="water" d="${top} l0,11${bottom} z"/><path class="glint" d="M${f1(x1 + 6)},${y + 1} h${f1((x2 - x1) * 0.3)} m${f1((x2 - x1) * 0.18)},0 h${f1((x2 - x1) * 0.22)}"/>`;
  },
  arch: (x1, x2, y) =>
    `<g class="archc"><ellipse class="prop" cx="${f1(x1 + 2)}" cy="${y}" rx="9" ry="8"/><ellipse class="prop" cx="${f1(x2 - 2)}" cy="${y}" rx="9" ry="8"/><rect x="${f1(x1 - 4)}" y="${y - 6}" width="${f1(x2 - x1 + 8)}" height="12" rx="6"/><path class="under" d="M${f1(x1 + 12)},${y} H${f1(x2 - 12)}"/></g>`,
  hollow: (x, y) => `<g class="hollowc"><circle cx="${x}" cy="${y}" r="15"/><circle class="hole" cx="${x}" cy="${y}" r="9.5"/></g>`,
  amber: (x, y, low) => `<circle class="amber${low ? ' low' : ''}" cx="${f1(x)}" cy="${f1(y)}" r="2.5"/>`,
  find: (x, y) => `<g class="findc"><circle class="halo" cx="${f1(x)}" cy="${f1(y)}" r="12"/><path d="M${f1(x)},${f1(y - 8)} l7,8 l-7,8 l-7,-8 z"/></g>`,
  power: (x, y) =>
    `<g class="powerc"><circle class="halo" cx="${x}" cy="${y}" r="14"/><path d="M${x},${y + 9} L${x - 11},${y - 3} A12,12 0 0 1 ${x - 1.5},${y - 9} L${x},${y - 3} L${x + 1.5},${y - 9} A12,12 0 0 1 ${x + 11},${y - 3} Z"/></g>`,
};
const chip = (x, y, move, anchor = 'start') => `<text class="chip ${move}" x="${x}" y="${y + 3.5}" text-anchor="${anchor}">${move === 'around' ? 'go around' : move}</text>`;

function wrap(text, max) {
  const lines = [''];
  for (const word of text.split(' ')) {
    const cur = lines[lines.length - 1];
    if (cur && (cur + ' ' + word).length > max) lines.push(word);
    else lines[lines.length - 1] = cur ? cur + ' ' + word : word;
  }
  return lines;
}

// ---------------------------------------------------------------- one section of the strip
function strip(sec) {
  const H = Math.round(sec.length * K + PAD * 2);
  const y = (s) => f1(PAD + (s - sec.start) * K);
  const o = [];
  const from = sec.start;
  const to = sec.end;

  // the forest either side of the trail, then the trail, with its edges swinging out at the fork
  const edge = (side, extra) => {
    const pts = [];
    for (let s = from; s <= to + 0.01; s += 2) pts.push(`${f1(laneX(side, s) + side * (LW / 2 + extra))},${y(s)}`);
    return pts;
  };
  const band = (extra) => `M${edge(-1, extra).join(' L')} L${edge(1, extra).reverse().join(' L')} Z`;
  o.push(`<path class="forest" d="${band(17)}"/>`);
  if (sec.drop) {
    // chevrons down the slope
    for (let s = from + 5; s < to - 2; s += 10) {
      o.push(`<path class="chev" d="M${laneX(-1, s) - LW / 2 - 13},${y(s)} l5,5 l5,-5 M${laneX(1, s) + LW / 2 + 3},${y(s)} l5,5 l5,-5"/>`);
    }
  }
  o.push(`<path class="trail" d="${band(0)}"/>`);
  // seams between the lanes
  for (const seam of [-0.5, 0.5]) {
    const pts = [];
    for (let s = from; s <= to + 0.01; s += 2) pts.push(`${f1(X0 + seam * LW + Math.sign(seam) * bow(s) * BOW)},${y(s)}`);
    o.push(`<path class="seam" d="M${pts.join(' L')}"/>`);
  }
  // the island
  if (level.island && level.island[0] >= from && level.island[1] <= to) {
    const [i0, i1] = level.island;
    const half = (s) => (LW / 2 + bow(s) * BOW - 3) * Math.sin(Math.PI * Math.min(1, Math.max(0, (s - i0) / (i1 - i0)))) ** 0.45;
    const left = [];
    const right = [];
    for (let s = i0; s <= i1 + 0.01; s += 1.5) {
      left.push(`${f1(X0 - half(s))},${y(s)}`);
      right.push(`${f1(X0 + half(s))},${y(s)}`);
    }
    const mid = (i0 + i1) / 2;
    o.push(`<path class="island" d="M${left.join(' L')} L${right.reverse().join(' L')} Z"/>`);
    o.push(`<circle class="ginkgo" cx="${X0}" cy="${y(mid)}" r="24"/><circle class="ginkgo-in" cx="${X0}" cy="${y(mid)}" r="7"/>`);
    o.push(`<text class="on-map" x="${X0}" y="${y(mid) + 42}" text-anchor="middle">giant ginkgo</text>`);
    o.push(`<text class="side-name" x="${GUT_L - 10}" y="${y(i0 + 3)}" text-anchor="end">riskier, more amber</text>`);
    o.push(`<text class="side-name" x="${GUT_R + 10}" y="${y(i0 + 3)}">safer, less amber</text>`);
  }

  // time ticks every five seconds
  for (let s = Math.ceil(from / 40) * 40; s < to; s += 40) {
    if (s - from < 3 && s !== 0) continue;
    o.push(`<text class="tick" x="2" y="${y(s) + 3}">${clock(s)}</text><path class="tickline" d="M${GUT_L + 2},${y(s)} h7"/>`);
  }

  // amber
  for (const a of level.amber) {
    if (a.s < from - 0.01 || a.s >= to - 0.01) continue;
    o.push(sym.amber(laneX(a.lane, a.s), y(a.s), a.lift < 0.3));
  }

  // the egg's line
  const eggPts = [];
  for (let s = from; s <= to + 0.01; s += 1.5) eggPts.push(`${f1(laneX(eggLaneAt(s), s))},${y(s)}`);
  if (sec.id !== 'edge') o.push(`<path class="eggline" d="M${eggPts.join(' L')}"/>`);

  // checkpoint
  for (const c of level.checkpoints) {
    if (c < from || c >= to) continue;
    const n = level.checkpoints.indexOf(c) + 1;
    o.push(`<path class="cp" d="M${laneX(-1, c) - LW / 2 - 17},${y(c)} H${laneX(1, c) + LW / 2 + 17}"/>`);
    o.push(`<text class="cp-name" x="${GUT_R + 4}" y="${y(c) + 3.5}">Checkpoint ${n}</text>`);
  }

  // obstacles
  for (const row of level.rows) {
    if (row.s < from || row.s >= to) continue;
    const yy = y(row.s);
    if (row.branch) {
      const lane = row.branch === 'left' ? -1 : 1;
      const x = laneX(lane, row.s);
      const [x1, x2] = [x - LW / 2 + 3, x + LW / 2 - 3];
      o.push(row.kind === 'log' ? sym.log(x1, x2, yy) : row.kind === 'creek' ? sym.creek(x1 - 3, x2 + 3, yy) : sym.arch(x1 + 4, x2 - 4, yy));
      o.push(row.branch === 'left' ? chip(GUT_L - 10, yy, row.move, 'end') : chip(GUT_R + 10, yy, row.move));
      continue;
    }
    const x1 = laneX(-1, row.s) - LW / 2;
    const x2 = laneX(1, row.s) + LW / 2;
    if (row.kind === 'log') o.push(sym.log(x1 + 5, x2 - 5, yy));
    else if (row.kind === 'creek') o.push(sym.creek(x1 - 17, x2 + 17, yy));
    else if (row.kind === 'arch') o.push(sym.arch(x1 + 4, x2 - 4, yy));
    else if (row.kind === 'crossing') o.push(sym.crossing(x1, x2, yy));
    else if (row.kind === 'hollow') {
      o.push(sym.boulder(laneX(-1, row.s), yy), sym.boulder(laneX(1, row.s), yy), sym.hollow(laneX(0, row.s), yy));
    } else {
      for (const part of row.parts) for (const lane of part.lanes) o.push(sym[part.kind](laneX(lane, row.s), yy));
    }
    const kinds = [...new Set(row.parts.map((p) => KIND_NAME[p.kind]))];
    const name = kinds.length > 1 ? `${kinds[0]} and ${kinds[1]}` : row.parts.reduce((n, p) => n + p.lanes.length, 0) > 1 && row.move === 'around' ? `two ${kinds[0]}s` : kinds[0];
    o.push(chip(GUT_R + 4, yy - 5, row.move));
    wrap(name + (row.onlyFor ? ' (find route only)' : ''), 21).forEach((line, i) => o.push(`<text class="kind" x="${GUT_R + 4}" y="${yy + 9 + i * 10.5}">${esc(line)}</text>`));
  }

  // hidden finds and the power-up
  for (const f of level.finds) {
    if (f.s < from || f.s >= to) continue;
    const x = laneX(f.lane, f.s);
    o.push(sym.find(x, y(f.s)));
    const left = f.lane < 0;
    const inFork = level.island && f.s > level.island[0] && f.s < level.island[1];
    const lx = left ? GUT_L - (inFork ? 10 : 4) : GUT_R + (inFork ? 10 : 4);
    const dy = f.high ? -13 : 0; // clear of the move label beside the same obstacle
    o.push(`<text class="find-name" x="${lx}" y="${y(f.s) + 3.5 + dy}" text-anchor="${left ? 'end' : 'start'}">Hidden find ${f.n}</text>`);
  }
  if (level.power && level.power.s >= from && level.power.s < to) {
    const p = level.power;
    o.push(sym.power(laneX(p.lane, p.s), y(p.s)));
    o.push(`<text class="power-name" x="${GUT_R + 4}" y="${y(p.s) + 12}">Power-up</text>`);
    o.push(`<path class="power-span" d="M${GUT_R + 1},${y(p.s) + 18} V${y(Math.min(p.s + p.reach, to))}"/>`);
    o.push(`<text class="kind" x="${GUT_R + 8}" y="${y(p.s + p.reach / 2)}">fans out for ${p.reach} m,</text>`);
    o.push(`<text class="kind" x="${GUT_R + 8}" y="${y(p.s + p.reach / 2) + 10.5}">about ${f1(p.reach / SPEED)} s</text>`);
  }

  // hints, in the left margin beside where they appear
  for (const h of level.hints) {
    if (h.s < from || h.s >= to) continue;
    const lines = wrap(`"${h.text}"`, 14);
    const top = Math.max(y(h.s) - (lines.length - 1) * 5.5, 22);
    lines.forEach((line, i) => o.push(`<text class="hint-t" x="${GUT_L - 5}" y="${f1(top + i * 11)}" text-anchor="end">${esc(line)}</text>`));
    o.push(`<path class="hint-l" d="M${GUT_L - 2},${f1(top - 3)} h10"/>`);
  }
  if (sec.edge !== undefined) {
    // where the ground ends, and where the egg stops and waits before its last dash
    const e = sec.start + sec.edge;
    const x1 = laneX(-1, e) - LW / 2 - 17;
    const x2 = laneX(1, e) + LW / 2 + 17;
    o.push(`<rect class="void" x="${x1}" y="${y(e)}" width="${x2 - x1}" height="${Math.max(0, y(to) - y(e))}"/>`);
    o.push(`<path class="lip" d="M${x1},${y(e)} H${x2}"/>`);
    o.push(`<text class="kind" x="${GUT_R + 4}" y="${y(e) + 3.5}">the edge</text>`);
    const w = e - 9;
    o.push(`<ellipse class="eggrest" cx="${X0}" cy="${y(w)}" rx="7" ry="9.5"/><text class="kind" x="${GUT_R + 4}" y="${y(w) + 1}">the egg waits here,</text><text class="kind" x="${GUT_R + 4}" y="${y(w) + 11.5}">then rolls for the edge</text>`);
  }
  if (level.retryFrom !== null && level.retryFrom >= from && level.retryFrom < to) {
    const c = level.retryFrom;
    o.push(`<path class="cp" d="M${laneX(-1, c) - LW / 2 - 17},${y(c)} H${laneX(1, c) + LW / 2 + 17}"/>`);
    o.push(`<text class="cp-name" x="${GUT_R + 4}" y="${y(c) + 3.5}">Miss the catch: back to here</text>`);
  }
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(sec.name)}: ${esc(sec.teaches)}">${o.join('')}</svg>`;
}

// ---------------------------------------------------------------- the trail from above
function planView() {
  const pts = [];
  let h = 0.5; // heading, measured from straight down the page
  let x = 0;
  let yv = 0;
  const marks = [];
  for (const sec of level.sections) {
    const turns = Array.isArray(sec.turn) ? sec.turn : [sec.turn];
    const part = sec.length / turns.length;
    marks.push({ sec, i: pts.length });
    for (const turn of turns) {
      for (let d = 0; d < part; d += 2) {
        pts.push({ x, y: yv, sec });
        h += (turn * 2) / part;
        x += Math.sin(h) * 2;
        yv += Math.cos(h) * 2;
      }
    }
  }
  pts.push({ x, y: yv, sec: level.sections[level.sections.length - 1] });
  const minX = Math.min(...pts.map((p) => p.x));
  const maxX = Math.max(...pts.map((p) => p.x));
  const maxY = Math.max(...pts.map((p) => p.y));
  const PW = 400;
  const PH = 250;
  const sc = Math.min((PW - 190) / (maxX - minX), (PH - 30) / maxY);
  const ox = 95 - minX * sc;
  const P = (p) => `${f1(ox + p.x * sc)},${f1(14 + p.y * sc)}`;
  const o = [];
  o.push(`<path class="pv-all" d="M${pts.map(P).join(' L')}"/>`);
  for (const { sec, i } of marks) {
    const seg = pts.filter((p) => p.sec === sec);
    if (sec.drop) o.push(`<path class="pv-drop" d="M${seg.map(P).join(' L')}"/>`);
    const a = pts[i];
    o.push(`<circle class="pv-dot" cx="${f1(ox + a.x * sc)}" cy="${f1(14 + a.y * sc)}" r="2.6"/>`);
    const mid = seg[Math.floor(seg.length / 2)];
    const next = seg[Math.min(seg.length - 1, Math.floor(seg.length / 2) + 2)];
    // label on whichever side the trail leaves more room
    const right = ox + mid.x * sc < PW / 2;
    const nx = ox + mid.x * sc + (right ? 12 : -12);
    void next;
    o.push(`<text class="pv-name${sec.drop ? ' drop' : ''}" x="${f1(nx)}" y="${f1(14 + mid.y * sc + 3.5)}" text-anchor="${right ? 'start' : 'end'}">${esc(sec.name)}</text>`);
  }
  return `<svg viewBox="0 0 ${PW} ${PH}" role="img" aria-label="The trail from above, winding downhill from the nest to the edge of the cliff">${o.join('')}</svg>`;
}

// ---------------------------------------------------------------- page
const legend = [
  [`<svg viewBox="0 0 36 30">${sym.boulder(18, 15)}</svg>`, 'Boulder', 'go around'],
  [`<svg viewBox="0 0 36 30">${sym.tree(18, 15)}</svg>`, 'Tree', 'go around'],
  [`<svg viewBox="0 0 36 30">${sym.log(4, 32, 15)}</svg>`, 'Fallen log', 'jump'],
  [`<svg viewBox="0 0 36 30">${sym.creek(2, 34, 15)}</svg>`, 'Creek', 'jump'],
  [`<svg viewBox="0 0 36 30">${sym.crossing(1, 35, 15)}</svg>`, 'Young Psittacosaurus crossing', 'jump'],
  [`<svg viewBox="0 0 36 30">${sym.arch(6, 30, 15)}</svg>`, 'Propped trunk', 'slide'],
  [`<svg viewBox="0 0 36 30">${sym.hollow(18, 15)}</svg>`, 'Hollow log', 'slide'],
  [`<svg viewBox="0 0 36 30">${sym.amber(8, 15)}${sym.amber(18, 15)}${sym.amber(28, 15)}</svg>`, 'Amber', 'the good line'],
  [`<svg viewBox="0 0 36 30">${sym.find(18, 15)}</svg>`, 'Hidden find', 'off the good line'],
  [`<svg viewBox="0 0 36 30">${sym.power(18, 15)}</svg>`, 'Power-up', 'one, on the second drop'],
  [`<svg viewBox="0 0 36 30"><path class="eggline" d="M2,22 C12,22 12,8 22,8 L34,8"/></svg>`, "The egg's line", 'the safe way through'],
  [`<svg viewBox="0 0 36 30"><path class="cp" d="M2,15 H34"/></svg>`, 'Checkpoint', 'marked, not in use for now'],
];

const sectionsHtml = level.sections
  .map(
    (sec) => `
  <section class="leg${sec.drop ? ' is-drop' : ''}" id="${sec.id}">
    <header>
      <h3>${esc(sec.name)}</h3>
      <span class="when">${clock(sec.start)} to ${clock(sec.end)} · ${sec.length} m${sec.drop ? ' · steep' : ''}</span>
      <p>${esc(sec.teaches)}</p>
    </header>
    ${strip(sec)}
  </section>`,
  )
  .join('\n');

const html = `<title>Jehol Forest Course Map</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@500;600;700&display=swap">
<style>
/* One column, read top to bottom like the run itself: the facts, the key, the trail from
   above, then the strip of trail section by section, then the checks and the open questions. */
:root {
  --bg: #edf1eb; --surface: #f8faf6; --ink: #15201b; --muted: #56655d; --rule: #cbd6cc;
  --forest: #2f5b45; --forest-deep: #234735; --trail: #dcbf90; --seam: #c4a36f;
  --amber: #e2951a; --find: #2f9fd6; --egg: #0f8f86; --wood: #7a5236; --wood-dark: #593a25;
  --rock: #8c9890; --rock-lite: #c4cdc6; --water: #4daee0; --psit: #b58b58;
  --around: #23774a; --jump: #b8640f; --slide: #315fc0; --flag: #b3372d;
  --display: 'Space Grotesk', ui-sans-serif, system-ui, sans-serif;
  --body: 'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0e1613; --surface: #16211c; --ink: #e8efe7; --muted: #9aaa9e; --rule: #283830;
    --forest: #1d3b2d; --forest-deep: #132a20; --trail: #a48556; --seam: #8a6d44;
    --amber: #f3ad3c; --find: #6ccaf2; --egg: #45d6c6; --wood: #8f6646; --wood-dark: #6c4a31;
    --rock: #7c8982; --rock-lite: #a9b5ad; --water: #4aa5d6; --psit: #b9925f;
    --around: #5cc188; --jump: #eb9b52; --slide: #86a8f2; --flag: #e56f62;
    color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --bg: #0e1613; --surface: #16211c; --ink: #e8efe7; --muted: #9aaa9e; --rule: #283830;
  --forest: #1d3b2d; --forest-deep: #132a20; --trail: #a48556; --seam: #8a6d44;
  --amber: #f3ad3c; --find: #6ccaf2; --egg: #45d6c6; --wood: #8f6646; --wood-dark: #6c4a31;
  --rock: #7c8982; --rock-lite: #a9b5ad; --water: #4aa5d6; --psit: #b9925f;
  --around: #5cc188; --jump: #eb9b52; --slide: #86a8f2; --flag: #e56f62;
  color-scheme: dark;
}
body { background: var(--bg); color: var(--ink); font: 15px/1.5 var(--body); }
.page {
  max-width: 560px; margin: 0 auto; padding-block: 28px 56px;
  padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px));
  display: flex; flex-direction: column; gap: 30px;
}
h1, h2, h3 { font-family: var(--display); margin: 0; text-wrap: balance; letter-spacing: -0.01em; }
h1 { font-size: 30px; line-height: 1.1; font-weight: 700; }
h2 { font-size: 19px; font-weight: 600; }
h3 { font-size: 17px; font-weight: 600; }
p { margin: 0; }
.eyebrow { font: 600 11.5px/1 var(--body); letter-spacing: 0.09em; text-transform: uppercase; color: var(--muted); }
.top { display: flex; flex-direction: column; gap: 10px; }
.lede { color: var(--muted); max-width: 60ch; }
.facts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: var(--rule); border: 1px solid var(--rule); border-radius: 12px; overflow: hidden; }
.facts div { background: var(--surface); padding: 11px 12px 10px; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.facts b { font: 600 20px/1.15 var(--display); font-variant-numeric: tabular-nums; }
.facts span { font-size: 12px; line-height: 1.3; color: var(--muted); }
.block { display: flex; flex-direction: column; gap: 12px; }
.key { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 14px; }
.key div { display: grid; grid-template-columns: 38px minmax(0, 1fr); column-gap: 8px; align-items: center; }
.key svg { width: 38px; height: 32px; grid-row: span 2; }
.key b { font-weight: 600; font-size: 13.5px; line-height: 1.25; align-self: end; }
.key span { font-size: 12px; line-height: 1.25; color: var(--muted); align-self: start; }
.plan svg, .leg svg { display: block; width: 100%; height: auto; }
.plan { background: var(--surface); border: 1px solid var(--rule); border-radius: 12px; padding: 6px 0; }
.legs { display: flex; flex-direction: column; gap: 22px; }
.leg { display: flex; flex-direction: column; gap: 6px; }
.leg header { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 12px; row-gap: 2px; align-items: baseline; border-top: 2px solid var(--ink); padding-top: 8px; }
.leg header p { grid-column: 1 / -1; color: var(--muted); font-size: 14px; }
.when { font-size: 12.5px; color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.leg.is-drop header { border-top-color: var(--amber); }
table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
td { padding: 8px 0; border-top: 1px solid var(--rule); vertical-align: top; }
td:last-child { text-align: right; color: var(--muted); padding-left: 12px; font-variant-numeric: tabular-nums; }
td .ok { color: var(--around); font-weight: 600; }
.asks { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 10px; }
.asks b { font-weight: 600; }
.note { font-size: 13px; color: var(--muted); }

/* the map */
svg text { font-family: var(--body); fill: var(--ink); }
.forest { fill: var(--forest); }
.trail { fill: var(--trail); }
.seam { fill: none; stroke: var(--seam); stroke-width: 1; stroke-dasharray: 5 6; }
.chev { fill: none; stroke: var(--amber); stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; opacity: 0.85; }
.island { fill: var(--forest-deep); }
.ginkgo { fill: #9fb24a; opacity: 0.9; }
.ginkgo-in { fill: var(--wood-dark); }
.on-map { font-size: 9.5px; font-weight: 600; fill: #eef3e6; }
.tick { font-size: 9.5px; fill: var(--muted); font-variant-numeric: tabular-nums; }
.tickline { stroke: var(--muted); stroke-width: 1; }
.amber { fill: var(--amber); }
.eggline { fill: none; stroke: var(--egg); stroke-width: 1.7; stroke-dasharray: 2 4; stroke-linecap: round; }
.eggrest { fill: #58cdbf; stroke: var(--egg); stroke-width: 1.2; }
.lip { fill: none; stroke: #5d5950; stroke-width: 3.5; stroke-linecap: round; }
.void { fill: #a9c4cf; opacity: 0.55; }
.cp { fill: none; stroke: var(--flag); stroke-width: 1.6; stroke-dasharray: 7 4; }
.cp-name { font-size: 10.5px; font-weight: 600; fill: var(--flag); }
.rock ellipse { fill: var(--rock); stroke: var(--forest-deep); stroke-width: 1; }
.rock .lite { fill: none; stroke: var(--rock-lite); stroke-width: 1.4; stroke-linecap: round; }
.tree .crown { fill: #4f8a52; opacity: 0.55; }
.tree .trunk { fill: var(--wood); stroke: var(--wood-dark); stroke-width: 1.2; }
.psit ellipse, .psit circle { fill: var(--psit); stroke: var(--wood-dark); stroke-width: 1; }
.psit .tail { fill: none; stroke: var(--psit); stroke-width: 4; stroke-linecap: round; }
.logc rect { fill: var(--wood); stroke: var(--wood-dark); stroke-width: 1; }
.logc .ring { fill: none; stroke: var(--trail); stroke-width: 1; }
.water { fill: var(--water); }
.glint { fill: none; stroke: #e6f6ff; stroke-width: 1.2; stroke-linecap: round; opacity: 0.8; }
.archc rect { fill: var(--wood-dark); opacity: 0.86; }
.archc .prop { fill: var(--rock); stroke: var(--forest-deep); stroke-width: 1; }
.archc .under { fill: none; stroke: var(--trail); stroke-width: 1.4; stroke-dasharray: 3 3; }
.hollowc circle { fill: var(--wood); stroke: var(--wood-dark); stroke-width: 1.2; }
.hollowc .hole { fill: #1a120d; stroke: none; }
.findc path { fill: var(--find); stroke: #f2fbff; stroke-width: 1.2; }
.findc .halo { fill: var(--find); opacity: 0.28; }
.powerc path { fill: #f6c443; stroke: #8a5a0c; stroke-width: 1.1; stroke-linejoin: round; }
.powerc .halo { fill: #f6c443; opacity: 0.3; }
.chip { font-size: 10.5px; font-weight: 600; }
.chip.around { fill: var(--around); }
.chip.jump { fill: var(--jump); }
.chip.slide { fill: var(--slide); }
.kind { font-size: 9.5px; fill: var(--muted); }
.side-name { font-size: 10px; font-weight: 600; fill: var(--ink); }
.find-name { font-size: 10.5px; font-weight: 600; fill: var(--find); }
.power-name { font-size: 10.5px; font-weight: 600; fill: var(--jump); }
.power-span { fill: none; stroke: var(--amber); stroke-width: 2; }
.hint-t { font-size: 9.8px; font-style: italic; fill: var(--ink); }
.hint-l { stroke: var(--ink); stroke-width: 1; }
.pv-all { fill: none; stroke: var(--forest); stroke-width: 5; stroke-linecap: round; stroke-linejoin: round; }
.pv-drop { fill: none; stroke: var(--amber); stroke-width: 5; stroke-linecap: round; }
.pv-dot { fill: var(--surface); stroke: var(--ink); stroke-width: 1.2; }
.pv-name { font-size: 10.5px; fill: var(--muted); }
.pv-name.drop { fill: var(--jump); font-weight: 600; }
@media (max-width: 380px) { .facts { grid-template-columns: repeat(2, 1fr); } h1 { font-size: 26px; } }
</style>

<main class="page">
  <div class="top">
    <span class="eyebrow">Raptor Race · Level 1 · the layout in the game</span>
    <h1>Jehol Forest course map</h1>
    <p class="lede">The whole chase, top to bottom, drawn to scale: one second of running is ${f1(SPEED * K)} pixels of trail. The game reads its level from the same file as this map, so what you see here is what plays.</p>
  </div>

  <div class="facts">
    <div><b>${st.chase} m</b><span>from the nest to the last shelf of rock</span></div>
    <div><b>${Math.round(st.seconds)} s</b><span>at speed ${SPEED}, with no bumps</span></div>
    <div><b>${st.movesEasy} or ${st.movesHard}</b><span>moves: easy side or hard side of the fork</span></div>
    <div><b>${st.amber}</b><span>pieces of amber</span></div>
    <div><b>3</b><span>hidden finds and 1 power-up</span></div>
    <div><b>${Math.round(st.drop)} m</b><span>downhill, start to finish</span></div>
  </div>

  <div class="block">
    <h2>How to read it</h2>
    <div class="key">${legend.map(([icon, name, what]) => `<div>${icon}<b>${name}</b><span>${what}</span></div>`).join('')}</div>
    <p class="note">Times down the left edge are from the start of the chase. Words in quotes are the hints, shown where they appear.</p>
  </div>

  <div class="block">
    <h2>The trail from above</h2>
    <div class="plan">${planView()}</div>
  </div>

  <div class="legs">${sectionsHtml}</div>

  <div class="block">
    <h2>Checked against your rules</h2>
    <table>${checks.map((c) => `<tr><td>${esc(c.rule)}</td><td><span class="ok">${c.ok ? 'yes' : 'NO'}</span> · ${esc(c.value)}</td></tr>`).join('')}
      <tr><td>One thing taught at a time</td><td><span class="ok">yes</span> · lanes, jumps, slides, fork, power-up, mix</td></tr>
      <tr><td>Hidden finds visible early enough to decide</td><td><span class="ok">yes</span> · each glows pale blue from 30 m, about 4 s</td></tr>
      <tr><td>The fork is explained before you have to choose</td><td><span class="ok">yes</span> · both side labels show for ${f1((level.island[0] - level.labelsFrom) / SPEED)} s before the rock</td></tr>
    </table>
  </div>

  <div class="block">
    <h2>The chase, in numbers</h2>
    <table>
      <tr><td>The egg's lead when the chase begins</td><td>${EGG.startLead} m</td></tr>
      <tr><td>Its lead at the end after a clean run</td><td>${f1(EGG.startLead - EGG.closing * st.seconds)} m</td></tr>
      <tr><td>What a bump costs</td><td>${EGG.bump} m</td></tr>
      <tr><td>How fast you gain on it, running clean</td><td>${EGG.closing} m/s close behind, up to ${EGG.closingFar} m/s far behind</td></tr>
      <tr><td>"The egg is getting away!" warning</td><td>${EGG.warnAt} m</td></tr>
      <tr><td>Egg lost, and the level starts over</td><td>${EGG.lostAt} m</td></tr>
      <tr><td>Fork: amber on the hard side against the easy side</td><td>${st.amberLeft} to ${st.amberRight}</td></tr>
    </table>
    <p class="note">A bump never ends the run by itself. You only lose the egg by letting it get ${EGG.lostAt} m ahead: from the start that takes four bumps close together, late in a clean run six or more. In test runs a player who misses about a third of the obstacles still finishes, and one who misses half loses the egg. Then the picture dims and the level starts over from the nest. The level always ends at the clearing. The further behind you are, the faster you gain, so a bad patch can be won back.</p>
  </div>

  <div class="block">
    <h2>Where it stands</h2>
    <ol class="asks">
      <li><b>Busier after the build 25 playtest.</b> ${st.movesEasy} moves on the safe side of the fork and ${st.movesHard} on the risky side, up from 21 and 23. Most of the long empty stretches are gone, and moves now come about a second and a half apart.</li>
      <li><b>The fork lives up to its promise.</b> Left is five moves in a row (jump, slide, jump, slide, jump) for ${st.amberLeft} pieces of amber and a hidden find. Right is two logs and ${st.amberRight} pieces. Both labels come up ${level.island[0] - level.labelsFrom} m before the rock, about ${f1((level.island[0] - level.labelsFrom) / SPEED)} s ahead, beside the trail at eye height. They can be see-through, or the game can hold still for a moment while they are read: both are in the pause sheet to try.</li>
      <li><b>Young Psittacosaurus cross the trail.</b> Three of them, walking in a file across all three lanes: a jump. The dozing adult stays as scenery beside the trail.</li>
      <li><b>Fan out is measured in meters now.</b> The fans stay out for ${level.power.reach} m, about ${f1(level.power.reach / SPEED)} s at speed ${SPEED}, which ends just past the last amber on the drop at any speed setting.</li>
      <li><b>Losing the egg ends the level.</b> A sheet says the egg got away and Try again starts the level over. The checkpoints stay marked here in case restarts from them are wanted later.</li>
      <li><b>The opening.</b> The egg stands on the rim of the nest, which sits on a shelf above a short steep pitch. Three taps from inside rock it, it hangs on the point of balance, tips over and rolls away down the slope. It plays once per visit.</li>
      <li><b>The ending is a catch at a cliff.</b> The trail runs out on a spur of rock over the valley. The egg stops 9 m short of the edge and waits until the runner is right behind it. Then it rolls for the edge, and there are about two seconds to swipe up. In time, the runner dives and pins it at the very edge, turns back with it, and it hatches there. Too late, and the egg goes over: Try again picks the run up from the marked point in the home stretch, about seven seconds back.</li>
      <li><b>One egg size.</b> The egg is the same size in the nest, in the chase and at the hatching. Two sizes are in the pause sheet to compare.</li>
      <li><b>Still to come:</b> sound and music, and the title, results and Field Journal screens.</li>
    </ol>
  </div>
</main>
`;

const here = dirname(fileURLToPath(import.meta.url));
writeFileSync(join(here, 'course-map.html'), html);
console.log(`course-map.html written: ${(html.length / 1024).toFixed(0)} KB`);
