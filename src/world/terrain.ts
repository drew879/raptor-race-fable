// The ground: a ribbon of hillside that follows the trail. The hill climbs on the left
// and falls away on the right, so the right side opens onto the valley.
// Everything is placed in trail space: s = distance along the trail, u = meters to the right.

import * as THREE from 'three';
import { paintMaterial } from '../render/paint';
import { fbm, smoothstep, vnoise } from './noise';
import type { Track } from './track';

export interface TerrainOptions {
  halfWidth: number; // half the width of the runnable trail
  upSlope: number; // rise per meter on the uphill side
  downSlope: number; // fall per meter on the valley side
}

const hex = (h: string) => new THREE.Color(h);
const EARTH_DARK = hex('#7a5a3e');
const EARTH = hex('#a07c56');
const EARTH_PALE = hex('#c5a073');
const LITTER = hex('#6b4f34');
const MOSS_DARK = hex('#3c5627');
const MOSS = hex('#5f8233');
const MOSS_LIGHT = hex('#8fa843');
const SOIL = hex('#4a3a2a');

export class Terrain {
  readonly track: Track;
  readonly opts: TerrainOptions;
  /** One material for all the ground, so its settings (like the lane hints) are set in one place. */
  readonly material = paintMaterial('ground');

  constructor(track: Track, opts: Partial<TerrainOptions> = {}) {
    this.track = track;
    this.opts = { halfWidth: 1.05, upSlope: 0.4, downSlope: 0.5, ...opts };
  }

  /** Height of the ground relative to the trail's centerline at (s, u). */
  profile(s: number, u: number): number {
    const W = this.opts.halfWidth;
    const a = Math.abs(u);
    let y = (vnoise(s * 0.9, u * 1.3) - 0.5) * 0.025;
    if (a <= W) {
      y -= 0.035 * (1 - (a / W) ** 2);
      return y;
    }
    const d = a - W;
    y += 0.13 * smoothstep(0, 0.55, d); // a soft mossy lip along both edges
    const vary = 0.75 + 0.5 * fbm(s * 0.03, u < 0 ? 3.1 : 9.7);
    if (u < 0) {
      y += Math.pow(Math.max(d - 0.25, 0), 1.06) * this.opts.upSlope * vary;
    } else {
      y -= Math.pow(Math.max(d - 1.3, 0), 1.08) * this.opts.downSlope * vary;
    }
    y += (fbm(s * 0.06, u * 0.06) - 0.5) * 3.0 * smoothstep(1.5, 12, d);
    y += (vnoise(s * 0.33, u * 0.33) - 0.5) * 0.45 * smoothstep(0.3, 3, d);
    return y;
  }

  /** World position of a point in trail space, sitting on the ground plus an optional lift. */
  place(s: number, u: number, lift = 0, out = new THREE.Vector3()): THREE.Vector3 {
    const t = this.track.sample(s);
    out.copy(t.pos).addScaledVector(t.right, u);
    out.y += this.profile(s, u) + lift;
    return out;
  }

  normalAt(s: number, u: number): THREE.Vector3 {
    const p = this.place(s, u);
    const ps = this.place(s + 0.3, u).sub(p);
    const pu = this.place(s, u + 0.3).sub(p);
    return pu.cross(ps).normalize();
  }

  buildMesh(s0: number, s1: number, reach = 70): THREE.Mesh {
    const W = this.opts.halfWidth;
    // columns: fine across the trail, widening toward the edges of the world
    const us: number[] = [];
    for (let i = 0; i <= 12; i++) us.push(-W + (2 * W * i) / 12);
    let step = 0.22;
    for (let u = W + step; u < reach; u += step) {
      us.push(u);
      us.unshift(-u);
      step = Math.min(step * 1.22, 7);
    }
    const ds = 1.0;
    const rows = Math.ceil((s1 - s0) / ds) + 1;
    const cols = us.length;
    const pos = new Float32Array(rows * cols * 3);
    const paint = new Float32Array(rows * cols * 4);
    const uv = new Float32Array(rows * cols * 2);
    const p = new THREE.Vector3();
    const c = new THREE.Color();
    for (let r = 0; r < rows; r++) {
      const s = s0 + r * ds;
      for (let k = 0; k < cols; k++) {
        const u = us[k];
        this.place(s, u, 0, p);
        const i = r * cols + k;
        pos.set([p.x, p.y, p.z], i * 3);
        const a = Math.abs(u);
        const n1 = fbm(s * 0.25, u * 0.5 + 40);
        const n2 = vnoise(s * 1.7, u * 1.7);
        let onTrail = 1 - smoothstep(W - 0.15, W + 0.35, a + (n2 - 0.5) * 0.3);
        if (onTrail > 0.02) {
          // worn pale down the middle, darker and damper toward the edges
          const worn = 1 - smoothstep(0.1, W, a);
          c.copy(EARTH_DARK).lerp(EARTH, 0.35 + 0.65 * n1).lerp(EARTH_PALE, worn * (0.35 + 0.4 * n2));
        }
        const floorMix = fbm(s * 0.12, u * 0.12 + 7);
        const floor = new THREE.Color().copy(MOSS_DARK).lerp(MOSS, floorMix * 1.3).lerp(MOSS_LIGHT, smoothstep(0.55, 0.8, n1) * 0.7);
        floor.lerp(LITTER, smoothstep(0.5, 0.75, vnoise(s * 0.45 + 9, u * 0.45)) * 0.75);
        floor.lerp(SOIL, smoothstep(6, 30, a) * 0.35);
        if (onTrail > 0.02) c.lerp(floor, 1 - onTrail);
        else c.copy(floor);
        paint.set([c.r, c.g, c.b, onTrail], i * 4);
        // the ground shader reads trail coordinates from here: meters across, meters along
        uv.set([u, s], i * 2);
      }
    }
    const index: number[] = [];
    for (let r = 0; r < rows - 1; r++) {
      for (let k = 0; k < cols - 1; k++) {
        const a = r * cols + k;
        const b = a + 1;
        const d = a + cols;
        const e = d + 1;
        index.push(a, b, d, b, e, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aPaint', new THREE.BufferAttribute(paint, 4));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(index);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.frustumCulled = false;
    mesh.name = 'terrain';
    mesh.userData.rows = rows;
    mesh.userData.cols = cols;
    mesh.userData.s0 = s0;
    return mesh;
  }

  /**
   * The same ground cut into lengths of trail, so the parts behind the camera or far out of
   * sight are never drawn. Built as one piece first, so shading runs unbroken across the cuts.
   */
  buildSections(s0: number, s1: number, sectionLength = 26, reach = 70): THREE.Group {
    const whole = this.buildMesh(s0, s1, reach);
    const rows = whole.userData.rows as number;
    const cols = whole.userData.cols as number;
    const src = whole.geometry;
    const group = new THREE.Group();
    group.name = 'terrain';
    for (let r0 = 0; r0 < rows - 1; r0 += sectionLength) {
      const r1 = Math.min(rows - 1, r0 + sectionLength);
      const count = r1 - r0 + 1;
      const geo = new THREE.BufferGeometry();
      for (const name of ['position', 'normal', 'aPaint', 'uv']) {
        const a = src.getAttribute(name) as THREE.BufferAttribute;
        const size = a.itemSize;
        const slice = (a.array as Float32Array).slice(r0 * cols * size, (r1 + 1) * cols * size);
        geo.setAttribute(name, new THREE.BufferAttribute(slice, size));
      }
      const index: number[] = [];
      for (let r = 0; r < count - 1; r++) {
        for (let k = 0; k < cols - 1; k++) {
          const a = r * cols + k;
          index.push(a, a + 1, a + cols, a + 1, a + cols + 1, a + cols);
        }
      }
      geo.setIndex(index);
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, this.material);
      mesh.userData.s0 = s0 + r0;
      mesh.userData.s1 = s0 + r1;
      group.add(mesh);
    }
    src.dispose();
    return group;
  }
}
