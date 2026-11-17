// The end of the trail: a spur of rock that runs out over the valley and stops. The ground
// itself falls away ahead and to both sides (course.ts and Terrain's `spur`); this gives the
// spur its rock walls, the stones and plants along its top, and the forest far below.
//
// The worn earth of the trail runs right to the edge, where it is cut off: that is what makes
// it a cliff. (Drew, after build 30: "render the trail right up to the edge so that it looks
// like a dramatic cliff".)

import * as THREE from 'three';
import { instances, materialFor, type Kit, type Placement } from '../world/assets';
import { fbm, rng, smoothstep } from '../world/noise';
import type { Terrain } from '../world/terrain';

/** Half the width of the spur the trail runs out on: wide where it leaves the hillside, narrow at its end. */
export const spurHalf = (s: number, lip: number): number =>
  3.3 + 1.1 * (1 - smoothstep(lip - 12, lip, s)) + 6.6 * (1 - smoothstep(lip - 30, lip - 12, s));

export function makeOverlook(terrain: Terrain, small: Kit, trees: Kit, lip: number): THREE.Group {
  const group = new THREE.Group();
  const rnd = rng(630);
  const base = terrain.track.sample(lip - 0.5);
  const fwd = base.tan.clone().setY(0).normalize();
  const right = base.right.clone();

  // ---- the walls: from the rim straight down, in courses of rock, all the way round the end
  const rim: { p: THREE.Vector3; out: THREE.Vector3 }[] = [];
  const BACK = 16;
  const addRim = (s: number, u: number, os: number, ou: number) =>
    rim.push({ p: terrain.place(Math.min(s, lip), u, 0.02), out: fwd.clone().multiplyScalar(os).addScaledVector(right, ou).normalize() });
  for (let s = lip - BACK; s < lip - 0.3; s += 0.8) addRim(s, -spurHalf(s, lip), 0, -1);
  const tip = spurHalf(lip, lip);
  for (let k = 0; k <= 14; k++) {
    // round the two corners of the end
    const a = (k / 14) * 2 - 1;
    const corner = smoothstep(0.72, 1, Math.abs(a));
    addRim(lip, a * tip, 1 - corner * 0.8, Math.sign(a) * corner);
  }
  for (let s = lip - 0.4; s > lip - BACK; s -= 0.8) addRim(s, spurHalf(s, lip), 0, 1);

  const pos: number[] = [];
  const paint: number[] = [];
  const index: number[] = [];
  const rockA = new THREE.Color('#6f6a5e');
  const rockB = new THREE.Color('#9a927f');
  const rockDark = new THREE.Color('#403d37');
  const moss = new THREE.Color('#5f8233');
  const c = new THREE.Color();
  const v = new THREE.Vector3();
  const drops = [0, 0.35, 0.9, 1.8, 3.2, 5.2, 8, 12, 18, 26];
  rim.forEach((r, j) => {
    drops.forEach((d, k) => {
      // each course of rock stands out or back a little from the one above, and the whole wall leans in under the top
      const ledge = (fbm(j * 0.45, k * 1.7) - 0.5) * 0.9 * Math.min(1, d);
      const overhang = k === 0 ? 0.28 + 0.2 * fbm(j * 0.7, 3.3) : 0.22 - 0.07 * Math.min(d, 7);
      v.copy(r.p).addScaledVector(r.out, overhang + ledge);
      v.y -= d + (k > 0 ? (fbm(j * 0.6, k * 2.9) - 0.5) * 0.35 : 0);
      pos.push(v.x, v.y, v.z);
      // pale where the light catches a course's face, dark in the cracks between, stained and mossy near the top
      const band = 0.5 + 0.5 * Math.sin(d * 3.1 + fbm(j * 0.3, 1.1) * 5);
      c.copy(rockA).lerp(rockB, band * 0.7 + 0.3 * fbm(j * 1.3, d * 0.9)).lerp(rockDark, smoothstep(0.55, 0.85, fbm(j * 0.9 + 4, d * 1.6)) * 0.7);
      c.lerp(moss, (1 - smoothstep(0.2, 1.3, d)) * (0.35 + 0.5 * fbm(j * 0.5, 9.1)));
      paint.push(c.r, c.g, c.b, k === 0 ? 1 : 0.55 + 0.25 * band);
    });
    if (j > 0) {
      for (let k = 0; k < drops.length - 1; k++) {
        const a = (j - 1) * drops.length + k;
        const b = j * drops.length + k;
        index.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aPaint', new THREE.Float32BufferAttribute(paint, 4));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  const wallMat = materialFor('rock');
  const walls = new THREE.Mesh(geo, wallMat);
  walls.frustumCulled = false;
  group.add(walls);

  // ---- along the top: stones at the rim and beside the trail, ferns and horsetails in the moss
  const dress: Record<string, Placement[]> = { rock_a: [], rock_b: [], rock_c: [], fern_a: [], fern_b: [], fern_c: [], horsetail_a: [] };
  const put = (name: string, s: number, u: number, scale: number, lift = 0) =>
    dress[name].push({ position: terrain.place(s, u, lift), yaw: rnd() * 6.28, scale });
  // the two corners of the end, and a broken line of stones along each side's rim
  put('rock_a', lip - 0.7, -tip + 0.5, 1.15, -0.12);
  put('rock_b', lip - 0.9, tip - 0.45, 1.0, -0.1);
  put('rock_c', lip - 0.45, -1.75, 0.5, -0.03);
  put('rock_c', lip - 0.4, 1.9, 0.42, -0.03);
  for (let s = lip - 26; s < lip - 1.5; s += 1.1 + rnd() * 1.6) {
    for (const side of [-1, 1]) {
      const half = spurHalf(s, lip);
      const roll = rnd();
      const u = side * (half - 0.25 - rnd() * 0.5);
      if (roll < 0.45) put(roll < 0.2 ? 'rock_a' : roll < 0.33 ? 'rock_b' : 'rock_c', s, u, 0.45 + rnd() * 0.75, -0.06);
      // and between the rim and the trail, low growth and loose stones
      const inner = side * (1.45 + rnd() * Math.max(0.2, half - 2.1));
      const pick = rnd();
      if (pick < 0.3) put('fern_a', s + rnd(), inner, 0.45 + rnd() * 0.45);
      else if (pick < 0.52) put('fern_b', s + rnd(), inner, 0.45 + rnd() * 0.4);
      else if (pick < 0.66) put('fern_c', s + rnd(), inner, 0.4 + rnd() * 0.4);
      else if (pick < 0.8) put('horsetail_a', s + rnd(), inner, 0.7 + rnd() * 0.5);
      else put('rock_c', s + rnd(), inner, 0.14 + rnd() * 0.22, -0.01);
    }
  }
  // pebbles on the trail itself near the end, too small to be in anyone's way
  for (let i = 0; i < 16; i++) put('rock_c', lip - 0.3 - rnd() * 9, (rnd() - 0.5) * 2.4, 0.04 + rnd() * 0.06);
  for (const [name, list] of Object.entries(dress)) if (small.has(name) && list.length) group.add(instances(small, name, list, true));

  // ---- far below: the tops of the valley's forest, so the drop has a bottom
  if (trees.has('conifer_dist')) {
    const far: Placement[] = [];
    const foot = terrain.place(lip, 0, 0);
    for (let i = 0; i < 90; i++) {
      const out = 14 + rnd() * rnd() * 330;
      const side = (rnd() - 0.5) * (120 + out * 1.1);
      const p = foot.clone().addScaledVector(fwd, out).addScaledVector(right, side);
      p.y -= 50 + smoothstep(10, 200, out) * 22 + rnd() * 7;
      far.push({ position: p, yaw: rnd() * 6.28, scale: 0.95 + rnd() * 0.6 });
    }
    group.add(instances(trees, 'conifer_dist', far, false));
  }
  return group;
}
