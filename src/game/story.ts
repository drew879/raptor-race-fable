// The things the opening and the ending need that the chase does not: the nest with its
// clutch, the two halves of the shell, and the chick.
//
// What is from the fossils (relatives of Caudipteryx; no Caudipteryx nest is known): eggs laid
// in pairs in a ring, long axes pointing in toward the middle and tilted up at the inner,
// blunter end, part buried; the parent sitting in the middle with its arms over them.
//
// What is not: the size. The egg is drawn one size everywhere, large enough to follow from far
// behind in the chase, so the eggs in the nest are that size too. (Drew's call after build 28:
// an egg that changed size between the nest and the chase was jarring.)

import * as THREE from 'three';
import { HeroRig, type HeroState } from '../hero/rig';
import { paintMaterial } from '../render/paint';
import { loadSkinned, materialFor, type Kit } from '../world/assets';
import { fbm, smoothstep } from '../world/noise';
import type { Terrain } from '../world/terrain';

import chickUrl from '../assets/models/chick.glb?url';

/** Half the egg's width against its length, as the model is built (art/plants.py, egg_true). */
export const EGG_WAIST = 0.226;
/** The chick model against an egg one meter long: a hatchling has to have fitted inside. */
const CHICK_PER_EGG = 0.75 / 0.09;
/** The chick's legs against the parent's, as built in art/hero.py. */
const CHICK_LEGS = 0.145;

/** Where our egg is perched: on the rim, this far round from straight down the trail (to the right is positive). */
export const OUR_ANGLE = THREE.MathUtils.degToRad(-24);
const TILT = THREE.MathUtils.degToRad(30);
const UP = new THREE.Vector3(0, 1, 0);

/** The nest's measurements for an egg of a given length: where the ring of eggs lies, where the rim stands, and how far the mound reaches. */
export function nestPlan(egg: number) {
  const ring = Math.max(0.86 * egg, 0.24 + 0.42 * egg) + 0.03;
  const rim = ring + 0.5 * egg * Math.cos(TILT) + 0.07;
  return { egg, ring, rim, reach: rim + 0.34 };
}
export type NestPlan = ReturnType<typeof nestPlan>;

/** How high the mound stands at a distance r from its middle, round at angle a. */
export function nestHeight(plan: NestPlan, r: number, a: number): number {
  const rim = Math.exp(-(((r - plan.rim) / 0.15) ** 2));
  return 0.1 * rim * (0.85 + 0.3 * fbm(a * 2.3, 7.1)) + 0.006;
}

/**
 * An egg's turn in the nest's own frame (x across to the right, y up, z back up the trail),
 * standing at angle `at` round the ring and leaning `lean` radians from upright, outward
 * (positive) or in toward the middle (negative).
 */
export function eggTurn(at: number, lean: number, out = new THREE.Quaternion()): THREE.Quaternion {
  const axis = new THREE.Vector3(Math.sin(lean) * Math.sin(at), Math.cos(lean), -Math.sin(lean) * Math.cos(at));
  return out.setFromUnitVectors(UP, axis);
}

export interface Nest {
  group: THREE.Group;
  plan: NestPlan;
}

/**
 * A scraped ring of earth with a clutch of eggs in it. The ring of eggs is open on the
 * downhill side, where the parent steps out, and ours is perched on the rim there.
 */
export function makeNest(terrain: Terrain, props: Kit, s0: number, u0: number, basis: THREE.Quaternion, eggLength: number): Nest {
  const plan = nestPlan(eggLength);
  const group = new THREE.Group();
  const R = plan.reach;
  const rings = 14;
  const seg = 40;
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
      const edge = smoothstep(R * 0.84, R, r);
      // tucked under the ground at its outer edge, so there is no seam to see
      const lift = nestHeight(plan, r, a) * (1 - edge) - 0.03 * edge + (fbm(r * 9 + 3, a * 3.1) - 0.5) * 0.014 * (1 - edge);
      terrain.place(s0 + Math.cos(a) * r, u0 + Math.sin(a) * r, lift, v);
      pos.push(v.x, v.y, v.z);
      const rim = Math.exp(-(((r - plan.rim) / 0.18) ** 2));
      c.copy(damp).lerp(dry, rim * (0.6 + 0.4 * fbm(a * 3.7, r * 11)));
      c.lerp(litter, smoothstep(0.58, 0.74, fbm(r * 17 + 9, a * 7.3)) * 0.7);
      c.lerp(moss, smoothstep(R * 0.72, R, r) * 0.6);
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

  // the clutch: four pairs round the sides and the back
  const shell = eggMaterial(0);
  const eggGeo = props.get('egg_true')?.[0]?.geometry;
  const turn = new THREE.Quaternion();
  const pair = Math.asin(Math.min(0.9, (EGG_WAIST * eggLength * 1.12) / plan.ring));
  const lean = -(Math.PI / 2 - TILT);
  for (let k = 0; k < 4; k++) {
    const mid = THREE.MathUtils.degToRad(84 + k * 64);
    for (const side of [-1, 1]) {
      if (!eggGeo) continue;
      const angle = mid + side * pair + (fbm(k * 5.3, side) - 0.5) * 0.08;
      const r = plan.ring + (fbm(k * 3.1, side * 1.7) - 0.5) * 0.03;
      const egg = new THREE.Mesh(eggGeo, shell);
      // well buried, as they were laid: only the upper, blunter end of each stands clear of the earth
      terrain.place(s0 + Math.cos(angle) * r, u0 + Math.sin(angle) * r, nestHeight(plan, r, angle) + eggLength * 0.03, egg.position);
      egg.quaternion.copy(basis).multiply(eggTurn(angle, lean + (fbm(k * 2.3, side * 4.1) - 0.5) * 0.2, turn));
      egg.scale.setScalar(eggLength * (0.94 + 0.08 * fbm(k * 7.7, side * 2.9)));
      group.add(egg);
    }
  }
  return { group, plan };
}

/** An egg shell material of its own, so its cracks and glow can differ from our egg's. */
export function eggMaterial(crack: number): THREE.ShaderMaterial {
  const mat = paintMaterial('egg');
  mat.uniforms.uCrack.value = crack;
  mat.uniforms.uGlow.value.set('#2a9c90');
  mat.uniforms.uEggNear.value = 1;
  mat.side = THREE.FrontSide;
  return mat;
}

/** The two pieces the egg breaks into, one unit long between them; the caller sizes and places them. */
export function makeShell(props: Kit) {
  const broken = eggMaterial(0);
  broken.side = THREE.DoubleSide;
  const mesh = (name: string) => {
    const group = new THREE.Group();
    for (const part of props.get(name) ?? []) group.add(new THREE.Mesh(part.geometry, broken));
    group.visible = false;
    return group;
  };
  return { cup: mesh('eggshell_cup'), cap: mesh('eggshell_cap') };
}

export interface Chick {
  group: THREE.Group;
  rig: HeroRig;
  state: HeroState;
  /** Its size for an egg of the length given. */
  size: number;
}

/** The chick is a big download and is not needed until the very end, so it is fetched on the side. */
export function loadChick(eggLength: number): Promise<Chick> {
  return loadSkinned(chickUrl, false).then((model) => {
    if (model.eye) model.eye.uniforms.uLid.value.set(0.05, 0.04, 0.035);
    const group = new THREE.Group();
    group.add(model.root);
    group.visible = false;
    return {
      group,
      rig: new HeroRig(model, CHICK_LEGS),
      state: { phase: 0, speed: 0, run: 0, air: 0, airTilt: 0, slide: 0, lean: 0 },
      size: CHICK_PER_EGG * eggLength,
    };
  });
}
