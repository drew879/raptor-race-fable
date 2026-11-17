// The end of the trail: a shelf of mossy rock that runs out over the valley and stops.
// The ground itself falls away there (course.ts); this is the rock that makes it an edge.

import * as THREE from 'three';
import { instances, materialFor, type Kit, type Placement } from '../world/assets';
import { fbm, smoothstep } from '../world/noise';
import type { Terrain } from '../world/terrain';

/** How far back from the edge the rock begins. */
export const SHELF_LENGTH = 17;
/** Half the width of the spur of rock the trail runs out on: wide where it leaves the hillside, narrow at its end. */
export const spurHalf = (s: number, lip: number): number =>
  3.3 + 1.1 * (1 - smoothstep(lip - 12, lip, s)) + 6.6 * (1 - smoothstep(lip - 30, lip - 12, s));

export function makeOverlook(terrain: Terrain, small: Kit, lip: number): THREE.Group {
  const group = new THREE.Group();
  const from = lip - SHELF_LENGTH;
  const pos: number[] = [];
  const paint: number[] = [];
  const index: number[] = [];
  const rockA = new THREE.Color('#6b675d');
  const rockB = new THREE.Color('#948d7c');
  const rockDark = new THREE.Color('#45423c');
  const moss = new THREE.Color('#5f8233');
  const mossLight = new THREE.Color('#8aa345');
  const c = new THREE.Color();
  const v = new THREE.Vector3();
  // the way the trail points as it runs out, level: the rock's nose and its face are built along it
  const fwd = terrain.track.sample(lip - 0.5).tan.clone().setY(0).normalize();
  const cols = 31;
  const stops: number[] = [];
  for (let s = from; s < lip - 0.4; s += 0.7) stops.push(s);
  stops.push(lip, lip + 0.38);

  // the top
  stops.forEach((s, i) => {
    const on = Math.min(s, lip);
    // (wider than the spur itself, so the rock goes over its sides and some way down them)
    const w = spurHalf(on, lip) + 2.6;
    const back = smoothstep(from, from + 3.5, on); // it rises out of the ground at its back
    for (let j = 0; j < cols; j++) {
      const a = (j / (cols - 1)) * 2 - 1;
      const u = a * w;
      const edge = 1 - smoothstep(0.8, 1, Math.abs(a));
      const rough = smoothstep(1.15, 2.1, Math.abs(u)); // flat and smooth where the runner goes
      let h = (0.02 + (0.05 + 0.2 * fbm(on * 0.7 + 5, u * 0.7)) * rough) * back * edge - 0.07 * (1 - back * edge);
      // the worn earth of the trail shows down the middle until the last few steps, which are bare rock
      h -= 0.09 * (1 - rough) * (1 - smoothstep(lip - 4.5, lip - 2.5, on));
      if (i === stops.length - 1) h -= 0.07 + 0.08 * fbm(u * 0.9, 4.4); // the nose rounds over
      terrain.place(on, u, h, v);
      if (s > lip) v.addScaledVector(fwd, (s - lip) * (0.7 + 0.6 * fbm(u * 0.8, 8.8)));
      pos.push(v.x, v.y, v.z);
      c.copy(rockA).lerp(rockB, fbm(on * 0.9, u * 0.9 + 3));
      const green = smoothstep(0.4, 0.62, fbm(on * 0.42 + 11, u * 0.42)) * (0.45 + 0.5 * rough);
      c.lerp(moss, green * 0.9).lerp(mossLight, green * smoothstep(0.55, 0.8, fbm(on * 1.3, u * 1.3 + 7)) * 0.5);
      paint.push(c.r, c.g, c.b, 0.72 + 0.28 * edge);
    }
    if (i > 0) {
      for (let j = 0; j < cols - 1; j++) {
        const p00 = (i - 1) * cols + j;
        const p10 = i * cols + j;
        index.push(p00, p00 + 1, p10, p00 + 1, p10 + 1, p10);
      }
    }
  });

  // the face: from the nose straight down, in steps, bulging and stained
  const nose = (stops.length - 1) * cols;
  const drops = [0.5, 1.3, 2.8, 5, 8.5, 13, 20];
  drops.forEach((d, k) => {
    for (let j = 0; j < cols; j++) {
      v.set(pos[(nose + j) * 3], pos[(nose + j) * 3 + 1] - d, pos[(nose + j) * 3 + 2]);
      v.addScaledVector(fwd, (fbm(j * 0.55, d * 0.5) - 0.5) * 0.7 - 0.12 * Math.min(d, 6));
      pos.push(v.x, v.y, v.z);
      c.copy(rockA).lerp(rockDark, 0.3 + 0.5 * fbm(j * 0.8, d * 0.35)).lerp(rockB, 0.25 * fbm(j * 2.1, d * 1.7));
      c.lerp(moss, 0.5 * (1 - smoothstep(0.3, 1.6, d)) * fbm(j * 0.6, 1.3));
      paint.push(c.r, c.g, c.b, 0.62);
    }
    const upper = k === 0 ? nose : nose + k * cols;
    const lower = nose + (k + 1) * cols;
    for (let j = 0; j < cols - 1; j++) index.push(upper + j, upper + j + 1, lower + j, upper + j + 1, lower + j + 1, lower + j);
  });

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aPaint', new THREE.Float32BufferAttribute(paint, 4));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  const rock = new THREE.Mesh(geo, materialFor('rock'));
  rock.frustumCulled = false;
  group.add(rock);

  // boulders and ferns along its sides, clear of the lanes
  const dress: Record<string, Placement[]> = { rock_a: [], rock_b: [], rock_c: [], fern_a: [], fern_b: [], horsetail_a: [] };
  const put = (name: string, back: number, u: number, scale: number, lift = 0) =>
    dress[name].push({ position: terrain.place(lip - back, u, lift), yaw: back * 1.7 + u, scale });
  put('rock_b', 1.4, -2.5, 1.3, -0.05);
  put('rock_a', 2.6, 2.7, 1.5, -0.1);
  put('rock_c', 0.7, 2.4, 1.0);
  put('rock_c', 5.4, -2.9, 1.2);
  put('rock_a', 9.0, 3.1, 1.0);
  put('rock_b', 12.5, -3.4, 0.9);
  put('fern_a', 3.8, -3.0, 1.0);
  put('fern_b', 6.6, 3.2, 0.95);
  put('fern_a', 10.8, -3.6, 0.9);
  put('fern_b', 14.0, 4.2, 0.9);
  put('horsetail_a', 4.6, 3.0, 1.0);
  put('horsetail_a', 8.0, -3.3, 1.0);
  for (const [name, list] of Object.entries(dress)) if (small.has(name)) group.add(instances(small, name, list, true));
  return group;
}
