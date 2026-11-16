// Style directions. Each one is a complete set of values for the paint shader, the sky,
// the soft effects and the finishing pass. The geometry never changes between them.

import * as THREE from 'three';
import { applyRoleLooks, world, type Role, type RoleLook } from './paint';
import { postUniforms } from './post';
import { skyUniforms } from '../world/sky';
import { fxUniforms } from '../world/fx';

export interface Style {
  id: string;
  tab: string; // short label on the picker
  name: string;
  blurb: string;
  sun: { color: string; power: number };
  skyAmb: string;
  groundAmb: string;
  shadeTint: string;
  band: [number, number, number, number];
  fog: { color: string; sun: string; density: number; base: number; falloff: number; max: number; haze: number; glowPower: number; glow: number; ridgeMist: number };
  dapple: [number, number, number, number];
  brush: [number, number, number, number];
  grade: [number, number, number];
  sky: { zenith: string; horizon: string; glow: string; params: [number, number, number, number] };
  mist: number;
  shafts: { amount: number; color: string };
  line: { strength: number; width: number; sensitivity: number; wobble: number; color: string };
  paper: { grain: number; size: number; edge: number; pool: number; color: string };
  final: [number, number, number];
  roles: Partial<Record<Role, RoleLook>>;
  ui: { ink: string; panel: string; accent: string; text: string };
}

export const STYLES: Style[] = [
  {
    id: 'journal',
    tab: 'A',
    name: 'Field Journal',
    blurb: 'Ink line and watercolor wash on paper',
    sun: { color: '#fff0cc', power: 1.0 },
    skyAmb: '#d2e1e3',
    groundAmb: '#b5af97',
    shadeTint: '#c6cdf2',
    band: [0.5, 0.05, 0.1, 0.25],
    fog: { color: '#e4ead9', sun: '#fff1cf', density: 0.02, base: -40, falloff: 0.035, max: 0.96, haze: 0.0052, glowPower: 5, glow: 0.7, ridgeMist: 1.05 },
    dapple: [0.7, 0.2, 0.05, 0.6],
    brush: [0.24, 0.32, 0.22, 0],
    grade: [0.95, 1.1, 1.05],
    sky: { zenith: '#a8cbd6', horizon: '#f4eddb', glow: '#fff0cc', params: [2.4, 7, 0.5, 0.2] },
    mist: 0.45,
    shafts: { amount: 0.22, color: '#fff3d0' },
    line: { strength: 0.9, width: 0.9, sensitivity: 0.028, wobble: 1.2, color: '#3b2a20' },
    paper: { grain: 0.2, size: 1.9, edge: 0.5, pool: 0.18, color: '#f3ead8' },
    final: [1.0, 1.0, 0.0],
    roles: {
      foliage_conifer: { tint: '#f2ffe8', sat: 0.9, val: 1.15 },
      foliage_fern: { val: 1.1 },
      bark: { val: 1.15, sat: 0.9 },
      ground: { val: 1.1 },
      ridge: { tint: '#a9c4b6', val: 1.2 },
      feather: { val: 1.25 },
    },
    ui: { ink: '#3b2a20', panel: '#f3ead8', accent: '#e39a2d', text: '#3b2a20' },
  },
  {
    // A's ink line, paper and crisp washes, lit like B: low golden sun, cooler and deeper shade,
    // blue-green mist that warms toward the sun.
    id: 'goldjournal',
    tab: 'A+',
    name: 'Golden Journal',
    blurb: "A's ink and paper, B's morning sun",
    sun: { color: '#ffd9a0', power: 1.28 },
    skyAmb: '#b3cad2',
    groundAmb: '#9b9b7d',
    shadeTint: '#b6cbf0',
    band: [0.46, 0.07, 0.2, 0.3],
    fog: { color: '#a6c9c0', sun: '#ffd596', density: 0.026, base: -38, falloff: 0.04, max: 0.95, haze: 0.0042, glowPower: 4.5, glow: 0.95, ridgeMist: 1.0 },
    dapple: [0.82, 0.2, 0.06, 0.58],
    brush: [0.22, 0.36, 0.2, 0],
    grade: [1.06, 1.04, 1.15],
    sky: { zenith: '#78afc0', horizon: '#f6e2b2', glow: '#ffd9a0', params: [2.1, 6, 0.85, 0.4] },
    mist: 0.55,
    shafts: { amount: 0.5, color: '#ffe2a6' },
    line: { strength: 0.9, width: 0.9, sensitivity: 0.028, wobble: 1.2, color: '#33241b' },
    paper: { grain: 0.17, size: 1.9, edge: 0.5, pool: 0.18, color: '#f3e8d2' },
    final: [1.02, 1.04, 0.1],
    roles: {
      ridge: { tint: '#7fa5a0', val: 1.05 },
      feather: { val: 1.2 },
      bark: { val: 1.05 },
    },
    ui: { ink: '#33241b', panel: '#f3e8d2', accent: '#e39a2d', text: '#33241b' },
  },
  {
    id: 'diorama',
    tab: 'B',
    name: 'Painted Diorama',
    blurb: 'Gouache shapes, golden light, deep mist',
    sun: { color: '#ffd9a0', power: 1.3 },
    skyAmb: '#a3c0cc',
    groundAmb: '#8b9272',
    shadeTint: '#b3d0f0',
    band: [0.42, 0.2, 0.3, 0.35],
    fog: { color: '#7fb5b0', sun: '#ffcf85', density: 0.03, base: -38, falloff: 0.04, max: 0.94, haze: 0.0036, glowPower: 4.5, glow: 1.0, ridgeMist: 1.0 },
    dapple: [0.85, 0.2, 0.13, 0.58],
    brush: [0.15, 0.5, 0.12, 0],
    grade: [1.12, 1.0, 1.2],
    sky: { zenith: '#5a9db0', horizon: '#f6dfa6', glow: '#ffd08a', params: [2.0, 6, 0.95, 0.5] },
    mist: 0.6,
    shafts: { amount: 0.6, color: '#ffdf9c' },
    line: { strength: 0, width: 1, sensitivity: 0.03, wobble: 0, color: '#000000' },
    paper: { grain: 0.05, size: 1.6, edge: 0, pool: 0, color: '#f3ead8' },
    final: [1.04, 1.06, 0.3],
    roles: {
      ridge: { tint: '#6f9a98' },
      feather: { val: 1.15 },
    },
    ui: { ink: '#16211f', panel: '#16211f', accent: '#f2a93b', text: '#f6ecd6' },
  },
  {
    id: 'inkmist',
    tab: 'C',
    name: 'Ink and Mist',
    blurb: 'Ridges stacked in mist, color saved for amber and egg',
    sun: { color: '#fff4dc', power: 0.9 },
    skyAmb: '#cdd6d0',
    groundAmb: '#aeb0a0',
    shadeTint: '#cfd6de',
    band: [0.5, 0.09, 0.2, 0.3],
    fog: { color: '#e7e6d8', sun: '#f7efd9', density: 0.05, base: -34, falloff: 0.045, max: 0.975, haze: 0.0085, glowPower: 4, glow: 0.6, ridgeMist: 0.86 },
    dapple: [0.6, 0.2, 0.12, 0.62],
    brush: [0.3, 0.75, 0.3, 0],
    grade: [0.52, 1.02, 0.9],
    sky: { zenith: '#d3d9d0', horizon: '#f1ecdc', glow: '#fff4dc', params: [1.8, 5, 0.35, 0.15] },
    mist: 0.85,
    shafts: { amount: 0.12, color: '#fff6e0' },
    line: { strength: 0.78, width: 0.95, sensitivity: 0.04, wobble: 1.7, color: '#1d2125' },
    paper: { grain: 0.24, size: 2.2, edge: 0.4, pool: 0.12, color: '#f1ecdc' },
    final: [1.0, 1.14, 0.0],
    roles: {
      egg: { sat: 2.1, val: 1.05 },
      feather: { sat: 1.7, val: 1.2 },
      foliage_ginkgo: { sat: 1.25 },
      ridge: { tint: '#7d8f8a', sat: 0.6 },
      bark: { val: 0.62, sat: 0.4 },
      foliage_conifer: { val: 0.8, sat: 0.8 },
      foliage_fern: { sat: 1.1 },
      ground: { val: 1.05, sat: 0.9 },
    },
    ui: { ink: '#23272b', panel: '#f1ecdc', accent: '#e39a2d', text: '#23272b' },
  },
];

const lin = (hex: string) => new THREE.Color(hex);

export function applyStyle(style: Style) {
  world.uSunColor.value.copy(lin(style.sun.color)).multiplyScalar(style.sun.power);
  world.uSkyAmb.value.copy(lin(style.skyAmb));
  world.uGroundAmb.value.copy(lin(style.groundAmb));
  world.uShadeTint.value.copy(lin(style.shadeTint));
  world.uBand.value.set(...style.band);
  world.uFogColor.value.copy(lin(style.fog.color));
  world.uFogSun.value.copy(lin(style.fog.sun));
  world.uFog.value.set(style.fog.density, style.fog.base, style.fog.falloff, style.fog.max);
  world.uHaze.value.set(style.fog.haze, style.fog.glowPower, style.fog.glow, style.fog.ridgeMist);
  world.uDapple.value.set(...style.dapple);
  world.uBrush.value.set(...style.brush);
  world.uGrade.value.set(style.grade[0], style.grade[1], style.grade[2], 0);

  skyUniforms.uZenith.value.copy(lin(style.sky.zenith));
  skyUniforms.uHorizon.value.copy(lin(style.sky.horizon));
  skyUniforms.uSunGlow.value.copy(lin(style.sky.glow));
  skyUniforms.uSkyParams.value.set(...style.sky.params);

  fxUniforms.uMistAmount.value = style.mist;
  fxUniforms.uShaftAmount.value = style.shafts.amount;
  fxUniforms.uShaftColor.value.copy(lin(style.shafts.color));

  postUniforms.uLine.value.set(style.line.strength, style.line.width, style.line.sensitivity, style.line.wobble);
  // these two are used in display space by the finishing pass
  postUniforms.uLineColor.value.copy(lin(style.line.color)).convertLinearToSRGB();
  postUniforms.uPaper.value.set(style.paper.grain, style.paper.size, style.paper.edge, style.paper.pool);
  postUniforms.uPaperColor.value.copy(lin(style.paper.color)).convertLinearToSRGB();
  postUniforms.uFinal.value.set(style.final[0], style.final[1], style.final[2], 0);

  applyRoleLooks(style.roles);
}
