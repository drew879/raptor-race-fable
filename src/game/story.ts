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
import { instances, loadSkinned, materialFor, type Kit, type Placement } from '../world/assets';
import { fbm, rng, smoothstep } from '../world/noise';
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

/**
 * How high the nest's earth stands at a distance r from its middle, round at angle a. A ring
 * scraped up by the parent: steep on the inside, easing away on the outside, higher here and
 * lower there, all clods and hollows, with the marks of its feet raked down the outer slope
 * and a floor trodden flat inside.
 */
export function nestHeight(plan: NestPlan, r: number, a: number): number {
  const d = r - plan.rim;
  const crest = Math.exp(-((d / (d < 0 ? 0.11 : 0.2)) ** 2));
  const x = Math.cos(a) * r;
  const y = Math.sin(a) * r;
  let h = 0.105 * crest * (0.72 + 0.56 * fbm(a * 2.3, 7.1));
  h += (fbm(x * 8 + 3, y * 8) - 0.5) * 0.034 * (0.3 + crest);
  h += (fbm(x * 21 + 5, y * 21) - 0.5) * 0.013;
  const raked = smoothstep(0.02, 0.12, d) * (1 - smoothstep(0.2, 0.36, d));
  h += Math.sin(a * 34 + fbm(a * 3, r * 4) * 6) * 0.007 * raked;
  h -= 0.014 * (1 - smoothstep(0, plan.ring * 0.8, r));
  return (h + 0.01) * (1 - smoothstep(plan.reach * 0.86, plan.reach, r));
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
 * downhill side, where the parent steps out, and ours is perched on the rim there. Round it
 * lies what the forest drops: twigs, ginkgo leaves, pebbles turned up by the scraping.
 */
export function makeNest(terrain: Terrain, props: Kit, small: Kit, s0: number, u0: number, basis: THREE.Quaternion, eggLength: number): Nest {
  const plan = nestPlan(eggLength);
  const group = new THREE.Group();
  const rnd = rng(3003);
  const R = plan.reach;
  const v = new THREE.Vector3();
  const c = new THREE.Color();
  /** A point on the nest's surface, `lift` above it. */
  const surface = (r: number, a: number, lift = 0, out = new THREE.Vector3()) =>
    terrain.place(s0 + Math.cos(a) * r, u0 + Math.sin(a) * r, nestHeight(plan, r, a) + lift, out);

  // ---- the earth
  {
    const rings = 40;
    const seg = 112;
    const pos: number[] = [];
    const paint: number[] = [];
    const index: number[] = [];
    const pale = new THREE.Color('#b59c6b');
    const dry = new THREE.Color('#957b52');
    const damp = new THREE.Color('#5d4a34');
    const dark = new THREE.Color('#43362a');
    const litter = new THREE.Color('#8a742f');
    const moss = new THREE.Color('#5d6f33');
    for (let i = 0; i <= rings; i++) {
      const r = (i / rings) ** 0.8 * R;
      for (let j = 0; j < seg; j++) {
        const a = (j / seg) * Math.PI * 2;
        const edge = smoothstep(R * 0.86, R, r);
        // tucked under the ground at its outer edge, so there is no seam to see
        surface(r, a, -0.03 * edge, v);
        pos.push(v.x, v.y, v.z);
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        const d = r - plan.rim;
        const crest = Math.exp(-((d / (d < 0 ? 0.12 : 0.22)) ** 2));
        // dry and pale along the crest where it has been in the sun, darker and damper down inside
        c.copy(damp).lerp(dry, smoothstep(0.1, 0.7, crest + 0.3 * fbm(x * 5, y * 5)));
        c.lerp(pale, crest * smoothstep(0.45, 0.75, fbm(x * 11 + 2, y * 11)));
        // clods throw small shadows; fresh-turned earth is darker
        c.lerp(dark, smoothstep(0.52, 0.3, fbm(x * 21 + 5, y * 21)) * 0.55);
        c.lerp(dark, 0.35 * (1 - smoothstep(0, plan.ring * 0.75, r)));
        c.lerp(litter, smoothstep(0.6, 0.76, fbm(x * 15 + 9, y * 15 + 4)) * 0.6);
        c.lerp(moss, smoothstep(R * 0.7, R, r) * (0.45 + 0.4 * fbm(x * 4, y * 4 + 8)));
        paint.push(c.r, c.g, c.b, 0.5 + 0.5 * crest + (fbm(x * 21 + 5, y * 21) - 0.5) * 0.3);
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
  }

  // ---- what lies on it: twigs and fallen ginkgo leaves, as one mesh
  {
    const pos: number[] = [];
    const paint: number[] = [];
    const index: number[] = [];
    const p0 = new THREE.Vector3();
    const p1 = new THREE.Vector3();
    const side = new THREE.Vector3();
    const up = new THREE.Vector3();
    const along = new THREE.Vector3();
    const push = (p: THREE.Vector3, col: THREE.Color, shade: number) => {
      pos.push(p.x, p.y, p.z);
      paint.push(col.r, col.g, col.b, shade);
      return pos.length / 3 - 1;
    };
    const barks = ['#4f3d2a', '#6b5539', '#7d6848', '#3f3124'].map((h) => new THREE.Color(h));
    // twigs: on the crest and down the outer slope, lying every which way
    for (let n = 0; n < 34; n++) {
      const a = rnd() * Math.PI * 2;
      const r = plan.rim - 0.1 + rnd() * (R - plan.rim + 0.05);
      const length = 0.12 + rnd() * rnd() * 0.42;
      const turn = rnd() * Math.PI;
      const half = length / 2 / Math.max(r, 0.2);
      // its two ends on the surface: along a chord through (r, a), turned by `turn`
      const ax = Math.cos(a) * r;
      const ay = Math.sin(a) * r;
      const dx = Math.cos(a + turn) * length * 0.5;
      const dy = Math.sin(a + turn) * length * 0.5;
      const ra = Math.hypot(ax - dx, ay - dy);
      const rb = Math.hypot(ax + dx, ay + dy);
      const thick = 0.005 + rnd() * 0.008;
      surface(ra, Math.atan2(ay - dy, ax - dx), thick * 0.9, p0);
      surface(rb, Math.atan2(ay + dy, ax + dx), thick * 0.6, p1);
      void half;
      along.subVectors(p1, p0).normalize();
      side.crossVectors(along, UP).normalize();
      up.crossVectors(side, along);
      const col = barks[Math.floor(rnd() * barks.length)];
      const first = pos.length / 3;
      for (const [p, rad] of [[p0, thick], [p1, thick * 0.45]] as const) {
        for (let k = 0; k < 5; k++) {
          const ang = (k / 5) * Math.PI * 2;
          v.copy(p).addScaledVector(side, Math.cos(ang) * rad).addScaledVector(up, Math.sin(ang) * rad);
          push(v, col, 0.7 + 0.3 * Math.sin(ang));
        }
      }
      for (let k = 0; k < 5; k++) {
        const k2 = (k + 1) % 5;
        index.push(first + k, first + 5 + k, first + k2, first + k2, first + 5 + k, first + 5 + k2);
      }
    }
    // ginkgo leaves: small fans, gold and yellow-green and brown, on the earth and in the moss round it
    const leafs = ['#c9a437', '#d8b84a', '#9aa23c', '#8a6a34', '#b8892f'].map((h) => new THREE.Color(h));
    for (let n = 0; n < 46; n++) {
      const a = rnd() * Math.PI * 2;
      const r = n < 8 ? rnd() * plan.ring * 0.7 : plan.rim - 0.12 + rnd() * (R - plan.rim + 0.5);
      const size = 0.028 + rnd() * 0.022;
      surface(r, a, 0.006 + rnd() * 0.006, p0);
      // the lie of the ground under it, so it lies flat on a slope
      surface(r + 0.03, a, 0.006, p1);
      along.subVectors(p1, p0).normalize();
      surface(r, a + 0.03 / Math.max(r, 0.15), 0.006, p1);
      side.subVectors(p1, p0).normalize();
      up.crossVectors(side, along).normalize();
      if (up.y < 0) up.negate();
      const spin = rnd() * Math.PI * 2;
      const fx = along.clone().multiplyScalar(Math.cos(spin)).addScaledVector(side, Math.sin(spin));
      const fy = new THREE.Vector3().crossVectors(up, fx);
      const col = leafs[Math.floor(rnd() * leafs.length)];
      const stem = push(p0.clone().addScaledVector(fx, -size * 0.5), col, 0.85);
      const curl = (rnd() - 0.3) * 0.5;
      let prev = -1;
      for (let k = 0; k <= 6; k++) {
        // a fan a little over a half-circle wide, with a notch in the middle of its outer edge
        const t = k / 6;
        const ang = (t - 0.5) * 2.2;
        const reach = size * (1 - 0.16 * Math.exp(-(((t - 0.5) / 0.09) ** 2)));
        v.copy(p0).addScaledVector(fx, Math.cos(ang) * reach - size * 0.5).addScaledVector(fy, Math.sin(ang) * reach).addScaledVector(up, curl * size * Math.abs(t - 0.5));
        const i = push(v, col, 1);
        if (prev >= 0) index.push(stem, prev, i, stem, i, prev); // both faces, so it shows however it fell
        prev = i;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aPaint', new THREE.Float32BufferAttribute(paint, 4));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
    geo.setIndex(index);
    geo.computeVertexNormals();
    const litter = new THREE.Mesh(geo, materialFor('rock'));
    litter.frustumCulled = false;
    group.add(litter);
  }

  // ---- pebbles turned up by the scraping, and ferns round the back and the valley side
  // (the uphill side is where the opening is watched from, and the downhill side is the way out)
  {
    const dress: Record<string, Placement[]> = { rock_c: [], rock_a: [], fern_a: [], fern_b: [], fern_c: [] };
    for (let n = 0; n < 40; n++) {
      const a = rnd() * Math.PI * 2;
      const r = plan.rim - 0.14 + rnd() * (R - plan.rim + 0.25);
      dress.rock_c.push({ position: surface(r, a, -0.004), yaw: rnd() * 6.28, scale: 0.035 + rnd() * rnd() * 0.11 });
    }
    for (const [deg, out, name, scale] of [
      [58, 0.2, 'fern_b', 0.6], [84, 0.45, 'fern_a', 0.8], [104, 0.15, 'fern_c', 0.55], [128, 0.5, 'fern_a', 0.7], [150, 0.2, 'fern_b', 0.75],
      [176, 0.55, 'fern_c', 0.7], [200, 0.25, 'fern_a', 0.65], [222, 0.5, 'fern_b', 0.6], [70, 0.75, 'rock_a', 0.5], [165, 0.8, 'rock_a', 0.42],
    ] as const) {
      const a = THREE.MathUtils.degToRad(deg + (rnd() - 0.5) * 8);
      dress[name].push({ position: surface(R + out, a, name === 'rock_a' ? -0.06 : 0), yaw: rnd() * 6.28, scale });
    }
    for (const [name, list] of Object.entries(dress)) if (small.has(name) && list.length) group.add(instances(small, name, list, name !== 'rock_c'));
  }

  // ---- the clutch: four pairs round the sides and the back
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
      surface(r, angle, eggLength * 0.03, egg.position);
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
