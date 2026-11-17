// A creek: a ribbon of running water laid over the ground from the hill on the left, across the
// trail, and away down the valley side on the right. It follows the terrain, so it reads as one
// stream passing through, and its water visibly flows downhill.

import * as THREE from 'three';
import { instances, materialFor, SHADOW_LAYER, type Kit, type Placement } from './assets';
import { rng } from './noise';
import type { Terrain } from './terrain';

const WATER = new THREE.Color('#5cc3d6');
const WATER_PALE = new THREE.Color('#a5e4e6');

/** Half the creek's width on the trail, in meters along the trail. */
export const CREEK_HALF = 0.6;

/**
 * Build one creek crossing the trail at s, from uFrom (meters across, negative = uphill) to uTo.
 * `small` is the kit its bank stones come from.
 */
export function makeCreek(terrain: Terrain, small: Kit, s: number, uFrom = -15, uTo = 15, seed = 7): THREE.Group {
  const group = new THREE.Group();
  group.name = 'creek';
  const rnd = rng(Math.round(s * 31 + seed));
  const step = 0.45;
  const n = Math.ceil((uTo - uFrom) / step);
  const pos: number[] = [];
  const paint: number[] = [];
  const detail: number[] = [];
  const index: number[] = [];
  const p = new THREE.Vector3();
  const centerAt = (u: number) => s + 0.16 * Math.sin(u * 0.7 + seed);
  const halfAt = (u: number) => CREEK_HALF * (1 + 0.14 * Math.sin(u * 1.3 + 1) + 0.25 * Math.min(1, Math.max(0, (Math.abs(u) - 1.2) / 4)));
  for (let i = 0; i <= n; i++) {
    const u = uFrom + ((uTo - uFrom) * i) / n;
    const c = centerAt(u);
    const h = halfAt(u);
    const along = u - uFrom; // meters downstream
    for (const [k, across] of [[-1, -1], [0, 0], [1, 1]] as const) {
      terrain.place(c + k * h, u, k === 0 ? 0.03 : 0.045, p);
      pos.push(p.x, p.y, p.z);
      const col = k === 0 ? WATER : WATER_PALE;
      paint.push(col.r, col.g, col.b, 1);
      // packed as the paint shader reads detail: kind 1, across in -1..1, and distance along
      // (stored flipped, as a model's would be)
      detail.push(4 + across, 1 - along);
    }
    if (i < n) {
      const a = i * 3;
      index.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aPaint', new THREE.Float32BufferAttribute(paint, 4));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((n + 1) * 3 * 2), 2));
  geo.setAttribute('uv1', new THREE.Float32BufferAttribute(detail, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  const water = new THREE.Mesh(geo, materialFor('water'));
  water.frustumCulled = false;
  water.renderOrder = 1;
  group.add(water);

  // stones along both banks: pebbles where it crosses the trail, bigger ones off in the forest
  const stones: Placement[] = [];
  for (const side of [-1, 1]) {
    for (let u = uFrom + 0.3; u < uTo - 0.2; ) {
      const onTrail = Math.abs(u) < 1.4;
      const size = onTrail ? 0.2 + rnd() * 0.1 : 0.45 + rnd() * 0.55;
      const at = terrain.place(centerAt(u) + side * (halfAt(u) + 0.1 + size * 0.14), u, -0.03 * size);
      stones.push({ position: at, yaw: rnd() * 6.28, scale: size });
      u += size * (onTrail ? 0.7 : 0.9) + rnd() * 0.5;
    }
  }
  const rocks = instances(small, 'rock_c', stones, true);
  for (const child of rocks.children) child.layers.enable(SHADOW_LAYER);
  group.add(rocks);
  return group;
}
