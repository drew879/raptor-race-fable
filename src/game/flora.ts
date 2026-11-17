// The forest along a whole course. Plants are laid out in 13 m chunks, and each chunk can be
// shown at four levels of detail, picked by how far ahead of the runner it is. Within a level,
// plants far off to the side get a lighter model too: they are mostly hidden by nearer ones.
//
// How it is drawn matters more than how much is drawn. A phone's browser pays for every
// separate draw call, far more than for triangles, so each model is drawn once for the whole
// view (one call per part of a model) from a list of where its copies stand. The lists are
// refilled only when a chunk changes level, a few times every 13 m.

import * as THREE from 'three';
import { materialFor, SHADOW_LAYER, type Kit } from '../world/assets';
import { rng } from '../world/noise';
import type { Terrain } from '../world/terrain';

const CHUNK = 13;
const VIEW_AHEAD = 178;
const VIEW_BEHIND = 5; // the camera sits 2.6 m behind the runner; nothing further back can be seen

interface Plant {
  kind: 'conifer' | 'ginkgo' | 'treefern' | 'fern' | 'horsetail' | 'rock';
  variant: number;
  position: THREE.Vector3;
  yaw: number;
  scale: number;
  tint: THREE.Color;
  nearTrail: boolean;
  offset: number; // |u|
}

/** Ready-made placement data for every copy of one model in one chunk at one level. */
interface Slab {
  n: number;
  mats: Float32Array; // 16 numbers per copy
  cols: Float32Array; // 3 numbers per copy
}

interface Chunk {
  s0: number;
  s1: number;
  /** For each level, the slabs by model name. */
  levels: Map<string, Slab>[];
  /** The level on show, or -1 when out of sight. */
  shown: number;
}

/** One model drawn for the whole view: its parts share one list of placements. */
interface Batch {
  meshes: THREE.InstancedMesh[];
  mats: THREE.InstancedBufferAttribute;
  cols: THREE.InstancedBufferAttribute;
  /** How many placements are in the list, and how many of them are near enough to cast into the shadow map. */
  n: number;
  near: number;
}

// model heights, so swapping detail levels keeps each tree the same size
const CONIFER_H = [17, 22];
const GINKGO_H = [9, 11];
const TREEFERN_H = [3.0, 4.2];

const LEVELS = 4;
/** Plants further ahead than this can't reach the shadow map (it covers about 41 m ahead; the list is rebuilt every 13 m). */
const SHADOW_REACH = 58;
/** Which level of detail a chunk shows, from how far ahead of the runner it starts. */
const levelFor = (ahead: number) => (ahead < 13 ? 0 : ahead < 52 ? 1 : ahead < 104 ? 2 : 3);

function modelFor(p: Plant, level: number): { name: string; scale: number } | null {
  const hi = level === 0 && p.nearTrail;
  switch (p.kind) {
    case 'conifer': {
      // full-detail conifers are costly, so only the row right beside the trail gets them
      if (hi && p.offset < 6.5) return { name: p.variant ? 'conifer_b' : 'conifer_a', scale: p.scale };
      const scale = (p.scale * CONIFER_H[p.variant]) / 19;
      if (level <= 1) return { name: p.offset > 16 ? 'conifer_far' : 'conifer_lo', scale };
      if (level === 2) return { name: p.offset > 20 ? 'conifer_dist' : 'conifer_far', scale };
      return { name: 'conifer_dist', scale };
    }
    case 'ginkgo': {
      if (hi) return { name: p.variant ? 'ginkgo_b' : 'ginkgo_a', scale: p.scale };
      const scale = (p.scale * GINKGO_H[p.variant]) / 10;
      return { name: level >= 2 || p.offset > 16 ? 'ginkgo_far' : 'ginkgo_lo', scale };
    }
    case 'treefern': {
      if (hi && p.offset < 6) return { name: p.variant ? 'treefern_b' : 'treefern_a', scale: p.scale };
      if (level === 3) return null;
      const scale = (p.scale * TREEFERN_H[p.variant]) / 3.6;
      return { name: level === 2 || (level === 1 && p.offset > 6) ? 'treefern_far' : 'treefern_lo', scale };
    }
    case 'fern':
      // undergrowth thins out with distance: far away only the trail's edge is planted
      if (level === 3) return null;
      if (level === 1 && p.offset > 8) return null;
      if (level === 2 && p.offset > 3.6) return null;
      if (level === 0) return { name: p.offset < 6 ? 'fern_lo' : 'fern_far', scale: p.scale };
      if (level === 1) return { name: p.offset < 4 ? 'fern_lo' : 'fern_far', scale: p.scale };
      return { name: 'fern_far', scale: p.scale };
    case 'horsetail':
      if (level >= 2) return null;
      return { name: p.variant ? 'horsetail_b' : 'horsetail_a', scale: p.scale };
    case 'rock':
      if (level >= 2) return null;
      return { name: ['rock_a', 'rock_b', 'rock_c'][p.variant], scale: p.scale };
  }
}

export interface FloraOptions {
  length: number;
  vistas: [number, number][];
  /** Trail distances of obstacles, so scenery never crowds them. */
  keepClear: number[];
  seed?: number;
}

export class Flora {
  readonly group = new THREE.Group();
  private chunks: Chunk[] = [];
  private batches = new Map<string, Batch>();

  constructor(terrain: Terrain, trees: Kit, small: Kit, opts: FloraOptions) {
    const rnd = rng(opts.seed ?? 20261116);
    const inVista = (s: number) => opts.vistas.some(([a, b]) => s >= a && s <= b);
    const nearObstacle = (s: number) => opts.keepClear.some((o) => Math.abs(o - s) < 5);
    const tint = (spread: number) => {
      const v = 1 + (rnd() - 0.5) * spread;
      return new THREE.Color(v * (1 + (rnd() - 0.5) * spread * 0.4), v, v * (1 + (rnd() - 0.5) * spread * 0.4));
    };
    const leftBands = [-3.4, -6.8, -11.5, -17, -24, -33];
    const rightBands = [3.6, 7.6, 12.5, 19, 27, 37];
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const size3 = new THREE.Vector3();

    for (let s0 = -52; s0 < opts.length + 60; s0 += CHUNK) {
      const plants: Plant[] = [];
      const add = (kind: Plant['kind'], variant: number, s: number, u: number, scale: number, spread: number, sink: number) => {
        plants.push({
          kind,
          variant,
          position: terrain.place(s, u, -sink * scale),
          yaw: rnd() * Math.PI * 2,
          scale,
          tint: tint(spread),
          nearTrail: Math.abs(u) < 9,
          offset: Math.abs(u),
        });
      };
      for (let s = s0; s < s0 + CHUNK - 0.01; s += CHUNK / 2.5) {
        for (const band of [...leftBands, ...rightBands]) {
          const u = band + (rnd() - 0.5) * Math.abs(band) * 0.35;
          const ss = s + (rnd() - 0.5) * 4.5;
          const pick = rnd();
          const keep = rnd() < (Math.abs(band) > 15 ? 0.55 : 0.8);
          const variant = rnd() < 0.5 ? 0 : 1;
          const size = rnd();
          if (!keep || Math.abs(u) < 3.0) continue;
          const near = Math.abs(u) < 9;
          const open = inVista(ss) && u > 0; // the valley side stays low where the view opens
          if (near && pick < 0.3) add('treefern', variant, ss, u, 0.85 + size * 0.5, 0.2, 0.1);
          else if (open) continue;
          else if (pick < (u > 0 ? 0.46 : 0.36)) add('ginkgo', variant, ss, u, 0.8 + size * 0.5, 0.18, 0.15);
          else add('conifer', variant, ss, u, 0.8 + size * 0.55, 0.16, 0.2);
        }
      }
      const ferns = Math.round(CHUNK * 2.1);
      for (let i = 0; i < ferns; i++) {
        const s = s0 + rnd() * CHUNK;
        const off = 1.55 + Math.pow(rnd(), 1.9) * 15;
        const u = (rnd() < 0.5 ? -1 : 1) * off;
        // small beside the trail, so fronds never reach into a lane
        add('fern', 0, s, u, (off < 2.6 ? 0.55 : 0.7) + rnd() * (off < 2.6 ? 0.35 : 0.9), 0.3, 0.02);
      }
      if (rnd() < 0.38) {
        const cs = s0 + rnd() * CHUNK;
        const side = rnd() < 0.5 ? -1 : 1;
        for (let i = 0; i < 5; i++) {
          add('horsetail', rnd() < 0.5 ? 0 : 1, cs + (rnd() - 0.5) * 3.4, side * (1.75 + rnd() * 1.4), 0.8 + rnd() * 0.7, 0.2, 0.02);
        }
      }
      for (let i = 0; i < 5; i++) {
        const s = s0 + rnd() * CHUNK;
        const u = (rnd() < 0.5 ? -1 : 1) * (1.4 + Math.pow(rnd(), 1.5) * 13);
        const size = 0.5 + rnd() * 1.1;
        const variant = Math.floor(rnd() * 3);
        // nothing bulky beside the trail, and nothing crowding an obstacle: obstacles must read alone
        if (Math.abs(u) < 3.2 && (size > 0.9 || nearObstacle(s))) continue;
        add('rock', variant, s, u, size, 0.15, 0.12);
      }

      // work out, once, where every copy of every model stands at each level
      const levels: Map<string, Slab>[] = [];
      for (let level = 0; level < LEVELS; level++) {
        const lists = new Map<string, { p: Plant; scale: number }[]>();
        for (const p of plants) {
          const m = modelFor(p, level);
          if (!m) continue;
          let list = lists.get(m.name);
          if (!list) lists.set(m.name, (list = []));
          list.push({ p, scale: m.scale });
        }
        const slabs = new Map<string, Slab>();
        for (const [name, list] of lists) {
          const mats = new Float32Array(list.length * 16);
          const cols = new Float32Array(list.length * 3);
          list.forEach(({ p, scale }, i) => {
            m4.compose(p.position, q.setFromAxisAngle(up, p.yaw), size3.setScalar(scale)).toArray(mats, i * 16);
            p.tint.toArray(cols, i * 3);
          });
          slabs.set(name, { n: list.length, mats, cols });
        }
        levels.push(slabs);
      }
      this.chunks.push({ s0, s1: s0 + CHUNK, levels, shown: -1 });
    }

    // the most copies of each model ever on show at once, found by walking the whole course
    const most = new Map<string, number>();
    for (let s = -60; s < opts.length + 60; s += 1) {
      const now = new Map<string, number>();
      for (const c of this.chunks) {
        const level = this.levelOf(c, s);
        if (level < 0) continue;
        for (const [name, slab] of c.levels[level]) now.set(name, (now.get(name) ?? 0) + slab.n);
      }
      for (const [name, n] of now) most.set(name, Math.max(most.get(name) ?? 0, n));
    }

    for (const [name, room] of most) {
      const kit = name.startsWith('fern') || name.startsWith('horsetail') || name.startsWith('rock') ? small : trees;
      const parts = kit.get(name);
      if (!parts) throw new Error(`No model named ${name}`);
      const mats = new THREE.InstancedBufferAttribute(new Float32Array(room * 16), 16);
      const cols = new THREE.InstancedBufferAttribute(new Float32Array(room * 3), 3);
      mats.setUsage(THREE.DynamicDrawUsage);
      cols.setUsage(THREE.DynamicDrawUsage);
      const meshes = parts.map((part) => {
        const mesh = new THREE.InstancedMesh(part.geometry, materialFor(part.role), room);
        // every part of the model reads the same list of placements
        mesh.instanceMatrix = mats;
        mesh.instanceColor = cols;
        mesh.count = 0;
        mesh.visible = false;
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.name = name;
        // high canopy shade is painted as dappled light; trunks and low plants cast real shadows
        if (part.role !== 'foliage_conifer' && part.role !== 'foliage_ginkgo') mesh.layers.enable(SHADOW_LAYER);
        this.group.add(mesh);
        return mesh;
      });
      this.batches.set(name, { meshes, mats, cols, n: 0, near: 0 });
    }
  }

  /**
   * The sun's shadow map only covers the ground near the runner, but each model is one list of
   * placements for the whole view. Without this, every refresh of the map pushed the far
   * forest's trunks through the graphics chip for nothing. Call with true before drawing the
   * shadow map and false after.
   */
  shadowPass(on: boolean) {
    for (const batch of this.batches.values()) {
      for (const mesh of batch.meshes) mesh.count = on ? batch.near : batch.n;
    }
  }

  /** The level a chunk shows for a runner at s, or -1 when it is out of sight. */
  private levelOf(c: Chunk, playerS: number): number {
    const ahead = c.s0 - playerS;
    return c.s1 - playerS > -VIEW_BEHIND && ahead < VIEW_AHEAD ? levelFor(ahead) : -1;
  }

  /** Show the chunks around the runner at the right level of detail. */
  update(playerS: number) {
    let changed = false;
    for (const c of this.chunks) {
      const level = this.levelOf(c, playerS);
      if (level !== c.shown) {
        c.shown = level;
        changed = true;
      }
    }
    if (!changed) return;
    for (const [name, batch] of this.batches) {
      let n = 0;
      let near = -1;
      for (const c of this.chunks) {
        if (c.shown < 0) continue;
        // chunks come in trail order, so everything near the runner is at the front of the list
        if (near < 0 && c.s0 - playerS > SHADOW_REACH) near = n;
        const slab = c.levels[c.shown].get(name);
        if (!slab) continue;
        (batch.mats.array as Float32Array).set(slab.mats, n * 16);
        (batch.cols.array as Float32Array).set(slab.cols, n * 3);
        n += slab.n;
      }
      batch.n = n;
      batch.near = near < 0 ? n : near;
      for (const mesh of batch.meshes) {
        mesh.count = n;
        mesh.visible = n > 0;
      }
      if (n === 0) continue;
      batch.mats.clearUpdateRanges();
      batch.mats.addUpdateRange(0, n * 16);
      batch.mats.needsUpdate = true;
      batch.cols.clearUpdateRanges();
      batch.cols.addUpdateRange(0, n * 3);
      batch.cols.needsUpdate = true;
    }
  }
}
