// The forest along a whole course, planted in chunks. Each chunk exists at four levels of
// detail and shows one of them, picked by how far ahead of the runner it is. Within a level,
// plants far off to the side get a lighter model too: they are mostly hidden by nearer ones.

import * as THREE from 'three';
import { instances, type Kit, type Placement } from '../world/assets';
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

interface Chunk {
  s0: number;
  s1: number;
  levels: THREE.Group[];
}

// model heights, so swapping detail levels keeps each tree the same size
const CONIFER_H = [17, 22];
const GINKGO_H = [9, 11];
const TREEFERN_H = [3.0, 4.2];

const LEVELS = 4;
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

      const levels: THREE.Group[] = [];
      for (let level = 0; level < LEVELS; level++) {
        const lists = new Map<string, Placement[]>();
        for (const p of plants) {
          const m = modelFor(p, level);
          if (!m) continue;
          let list = lists.get(m.name);
          if (!list) lists.set(m.name, (list = []));
          list.push({ position: p.position, yaw: p.yaw, scale: m.scale, tint: p.tint });
        }
        const g = new THREE.Group();
        for (const [name, list] of lists) {
          const kit = name.startsWith('fern') || name.startsWith('horsetail') || name.startsWith('rock') ? small : trees;
          // high canopy shade is painted as dappled light; trunks and low plants cast real shadows
          const casts = (role: string) => level < 2 && role !== 'foliage_conifer' && role !== 'foliage_ginkgo';
          const inst = instances(kit, name, list, casts);
          for (const child of inst.children) {
            const mesh = child as THREE.InstancedMesh;
            mesh.computeBoundingSphere();
            mesh.frustumCulled = true;
          }
          g.add(inst);
        }
        g.visible = false;
        levels.push(g);
        this.group.add(g);
      }
      this.chunks.push({ s0, s1: s0 + CHUNK, levels });
    }
  }

  /** Show the chunks around the runner at the right level of detail. */
  update(playerS: number) {
    for (const c of this.chunks) {
      const ahead = c.s0 - playerS;
      const visible = c.s1 - playerS > -VIEW_BEHIND && ahead < VIEW_AHEAD;
      const level = levelFor(ahead);
      for (let i = 0; i < LEVELS; i++) c.levels[i].visible = visible && i === level;
    }
  }
}
