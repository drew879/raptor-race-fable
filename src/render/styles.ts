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
  /** fade: outlines on the scenery thin out between these two distances in meters (omit for none). */
  line: { strength: number; width: number; sensitivity: number; wobble: number; color: string; fade?: [number, number] };
  paper: { grain: number; size: number; pool: number };
  final: [number, number, number];
  roles: Partial<Record<Role, RoleLook>>;
  ui: { ink: string; panel: string; accent: string; text: string };
}

export const STYLES: Style[] = [
  {
    // Halfway between the first inked look (A+, now retired) and B. The paint is B's: deeper color, softer light, thicker mist.
    // The ink is A's, but kept for what is close and for the things you play with (the runner,
    // the egg, amber, obstacles). The forest beyond about 45 m is paint alone.
    id: 'paintjournal',
    tab: 'AB',
    name: 'Painted Journal',
    blurb: "B's deep paint, A's ink on what matters",
    sun: { color: '#ffd9a0', power: 1.29 },
    skyAmb: '#abc5cf',
    groundAmb: '#939677',
    shadeTint: '#b4cdf0',
    band: [0.44, 0.13, 0.25, 0.32],
    fog: { color: '#93bfb8', sun: '#ffd28e', density: 0.028, base: -38, falloff: 0.04, max: 0.945, haze: 0.0039, glowPower: 4.5, glow: 0.98, ridgeMist: 1.0 },
    dapple: [0.84, 0.2, 0.095, 0.58],
    brush: [0.19, 0.43, 0.16, 0],
    grade: [1.09, 1.02, 1.18],
    sky: { zenith: '#69a6b8', horizon: '#f6e1ac', glow: '#ffd595', params: [2.05, 6, 0.9, 0.45] },
    mist: 0.58,
    shafts: { amount: 0.46, color: '#ffe1a1' },
    line: { strength: 0.66, width: 0.78, sensitivity: 0.032, wobble: 1.0, color: '#3a2a20', fade: [14, 46] },
    paper: { grain: 0.09, size: 1.8, pool: 0.1 },
    final: [1.03, 1.05, 0.2],
    roles: {
      ridge: { tint: '#779f9c', val: 1.02 },
      feather: { val: 1.18 },
      bark: { val: 1.02 },
    },
    ui: { ink: '#33241b', panel: '#f3e8d2', accent: '#e39a2d', text: '#33241b' },
  },
  {
    // B with the journal kept where it counts. The world is B's paint, untouched: same color,
    // same soft light and mist, no outlines on the forest. The living things and the things
    // you play with (the runner, the egg, amber, obstacles) are drawn in a thin warm ink line,
    // as if sketched into the painting, and a little paper tooth sits over everything.
    // Menus and pages are journal paper.
    id: 'inkdiorama',
    tab: 'B+',
    name: 'Inked Diorama',
    blurb: "B's painted world, with the animals drawn in ink",
    sun: { color: '#ffd9a0', power: 1.3 },
    skyAmb: '#a3c0cc',
    groundAmb: '#8b9272',
    shadeTint: '#b3d0f0',
    band: [0.42, 0.2, 0.3, 0.35],
    fog: { color: '#7fb5b0', sun: '#ffcf85', density: 0.03, base: -38, falloff: 0.04, max: 0.94, haze: 0.0036, glowPower: 4.5, glow: 1.0, ridgeMist: 1.0 },
    dapple: [0.85, 0.2, 0.13, 0.58],
    brush: [0.17, 0.5, 0.14, 0],
    grade: [1.12, 1.0, 1.2],
    sky: { zenith: '#5a9db0', horizon: '#f6dfa6', glow: '#ffd08a', params: [2.0, 6, 0.95, 0.5] },
    mist: 0.6,
    shafts: { amount: 0.5, color: '#ffdf9c' },
    line: { strength: 0.6, width: 0.72, sensitivity: 0.034, wobble: 0.9, color: '#3d2c22', fade: [0, 0.01] },
    paper: { grain: 0.07, size: 1.7, pool: 0.06 },
    final: [1.04, 1.06, 0.3],
    roles: {
      ridge: { tint: '#6f9a98' },
      feather: { val: 1.15 },
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
    shafts: { amount: 0.5, color: '#ffdf9c' },
    line: { strength: 0, width: 1, sensitivity: 0.03, wobble: 0, color: '#000000' },
    paper: { grain: 0.05, size: 1.6, pool: 0 },
    final: [1.04, 1.06, 0.3],
    roles: {
      ridge: { tint: '#6f9a98' },
      feather: { val: 1.15 },
    },
    ui: { ink: '#16211f', panel: '#16211f', accent: '#f2a93b', text: '#f6ecd6' },
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
  world.uLineFade.value.set(...(style.line.fade ?? [1e5, 1e6]));
  // these two are used in display space by the finishing pass
  postUniforms.uLineColor.value.copy(lin(style.line.color)).convertLinearToSRGB();
  postUniforms.uPaper.value.set(style.paper.grain, style.paper.size, 0, style.paper.pool);
  postUniforms.uFinal.value.set(style.final[0], style.final[1], style.final[2], 0);

  applyRoleLooks(style.roles);
}
