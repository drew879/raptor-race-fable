// The things the opening and the ending need that the chase does not: the nest with its
// clutch, the true-shaped egg and its two halves, and the chick.
//
// What is from the fossils (relatives of Caudipteryx; no Caudipteryx nest is known): eggs laid
// in pairs in a ring, long axes pointing in toward the middle and tilted up at the inner,
// blunter end, part buried; the parent sitting in the middle with its arms over them.

import * as THREE from 'three';
import { HeroRig, type HeroState } from '../hero/rig';
import { paintMaterial } from '../render/paint';
import { loadSkinned, materialFor, type Kit } from '../world/assets';
import { fbm, smoothstep } from '../world/noise';
import type { Terrain } from '../world/terrain';

import chickUrl from '../assets/models/chick.glb?url';

/** Meters. How long an egg is drawn in the nest and in the parent's care. (No Caudipteryx egg is known; its relatives' eggs suggest about 8 cm.) */
export const SCENE_EGG = 0.09;
/** The chick model is built a little large; a hatchling has to have fitted in that egg. */
const CHICK_SIZE = 0.75;
/** The chick's legs against the parent's, as built in art/hero.py. */
const CHICK_LEGS = 0.145;

/** Where our egg lies in the ring: the angle round from straight down the trail (to the right is positive) and how far out. It is on the left, the side the opening is seen from. */
export const OUR_EGG = { angle: THREE.MathUtils.degToRad(-66), r: 0.29 };
const TILT = THREE.MathUtils.degToRad(40);
const UP = new THREE.Vector3(0, 1, 0);

/** How high the mound stands at a distance r from its middle, round at angle a. */
export function nestHeight(r: number, a: number): number {
  const rim = Math.exp(-(((r - 0.43) / 0.14) ** 2));
  return 0.085 * rim * (0.8 + 0.4 * fbm(a * 2.3, 7.1)) + 0.006;
}

/**
 * An egg's turn in the nest's own frame (x across to the right, y up, z back up the trail):
 * its long axis points in toward the middle, tilted up at the inner end.
 */
export function slotTurn(angle: number, out = new THREE.Quaternion()): THREE.Quaternion {
  const axis = new THREE.Vector3(-Math.sin(angle) * Math.cos(TILT), Math.sin(TILT), Math.cos(angle) * Math.cos(TILT));
  return out.setFromUnitVectors(UP, axis);
}

export interface Nest {
  group: THREE.Group;
  /** Trail position and lift of an egg lying in the ring at this angle. */
  slot(angle: number, r?: number): { s: number; u: number; lift: number };
}

/** A scraped ring of earth with a clutch of eggs in it, one place left empty for ours. */
export function makeNest(terrain: Terrain, props: Kit, s0: number, u0: number, basis: THREE.Quaternion): Nest {
  const group = new THREE.Group();
  const R = 0.72;
  const rings = 12;
  const seg = 36;
  const pos: number[] = [];
  const paint: number[] = [];
  const index: number[] = [];
  const dry = new THREE.Color('#9a8156');
  const damp = new THREE.Color('#6d5a3e');
  const litter = new THREE.Color('#8b7a3c');
  const moss = new THREE.Color('#5d6f33');
  const c = new THREE.Color();
  const v = new THREE.Vector3();
  for (let i = 0; i <= rings; i++) {
    const r = (i / rings) ** 0.85 * R;
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      const edge = smoothstep(R * 0.86, R, r);
      // tucked under the ground at its outer edge, so there is no seam to see
      const lift = nestHeight(r, a) * (1 - edge) - 0.02 * edge + (fbm(r * 9 + 3, a * 3.1) - 0.5) * 0.014 * (1 - edge);
      terrain.place(s0 + Math.cos(a) * r, u0 + Math.sin(a) * r, lift, v);
      pos.push(v.x, v.y, v.z);
      const rim = Math.exp(-(((r - 0.43) / 0.16) ** 2));
      c.copy(damp).lerp(dry, rim * (0.6 + 0.4 * fbm(a * 3.7, r * 11)));
      c.lerp(litter, smoothstep(0.58, 0.74, fbm(r * 17 + 9, a * 7.3)) * 0.7);
      c.lerp(moss, smoothstep(R * 0.7, R, r) * 0.6);
      paint.push(c.r, c.g, c.b, 0.62 + 0.38 * rim);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * seg + j;
      const b = i * seg + ((j + 1) % seg);
      index.push(a, b, a + seg, b, b + seg, a + seg);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aPaint', new THREE.Float32BufferAttribute(paint, 4));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  const mound = new THREE.Mesh(geo, materialFor('rock'));
  mound.frustumCulled = false;
  group.add(mound);

  const slot = (angle: number, r = OUR_EGG.r) => ({
    s: s0 + Math.cos(angle) * r,
    u: u0 + Math.sin(angle) * r,
    // part buried: the outer, narrower end is down in the earth
    lift: nestHeight(r, angle) + SCENE_EGG * 0.2,
  });

  // the clutch: five pairs round the ring, with one egg's place left for ours
  const shell = eggMaterial(0);
  const eggGeo = props.get('egg_true')?.[0]?.geometry;
  const turn = new THREE.Quaternion();
  const pair = THREE.MathUtils.degToRad(11.5);
  for (let k = 0; k < 5; k++) {
    for (const side of [-1, 1]) {
      const angle = OUR_EGG.angle - pair + (k * Math.PI * 2) / 5 + side * pair;
      if (k === 0 && side === 1) continue; // ours
      if (!eggGeo) continue;
      const egg = new THREE.Mesh(eggGeo, shell);
      const at = slot(angle, OUR_EGG.r + (fbm(k * 3.1, side * 1.7) - 0.5) * 0.03);
      egg.position.copy(terrain.place(at.s, at.u, at.lift));
      egg.quaternion.copy(basis).multiply(slotTurn(angle + (fbm(k * 5.3, side) - 0.5) * 0.25, turn));
      egg.scale.setScalar(SCENE_EGG * 0.9);
      group.add(egg);
    }
  }
  return { group, slot };
}

/** An egg shell material of its own, so its cracks and glow can differ from the chase egg's. */
export function eggMaterial(crack: number): THREE.ShaderMaterial {
  const mat = paintMaterial('egg');
  mat.uniforms.uCrack.value = crack;
  mat.uniforms.uGlow.value.set('#2a9c90');
  mat.uniforms.uEggNear.value = 1;
  mat.side = THREE.FrontSide;
  return mat;
}

/** The true-shaped egg and the two pieces it breaks into, one unit long each; the caller sizes and places them. */
export function makeShell(props: Kit) {
  const whole = eggMaterial(0.5);
  const broken = eggMaterial(0);
  broken.side = THREE.DoubleSide;
  const mesh = (name: string, mat: THREE.ShaderMaterial) => {
    const group = new THREE.Group();
    for (const part of props.get(name) ?? []) group.add(new THREE.Mesh(part.geometry, mat));
    group.visible = false;
    return group;
  };
  return { egg: mesh('egg_true', whole), cup: mesh('eggshell_cup', broken), cap: mesh('eggshell_cap', broken), whole };
}

export interface Chick {
  group: THREE.Group;
  rig: HeroRig;
  state: HeroState;
  size: number;
}

/** The chick is a big download and is not needed until the very end, so it is fetched on the side. */
export function loadChick(): Promise<Chick> {
  return loadSkinned(chickUrl, false).then((model) => {
    if (model.eye) model.eye.uniforms.uLid.value.set(0.05, 0.04, 0.035);
    const group = new THREE.Group();
    group.add(model.root);
    group.visible = false;
    return {
      group,
      rig: new HeroRig(model, CHICK_LEGS),
      state: { phase: 0, speed: 0, run: 0, air: 0, airTilt: 0, slide: 0, lean: 0 },
      size: CHICK_SIZE,
    };
  });
}
