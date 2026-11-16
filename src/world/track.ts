// The trail's centerline. A level is a list of segments (length, turn, slope); this turns
// them into a smooth 3D path and answers "where is distance s, offset u?" for everything else.
// Forward starts as -Z, right is +X, up is +Y.

import * as THREE from 'three';

export interface Segment {
  length: number; // meters
  turn?: number; // total heading change over the segment, radians, positive = right
  slope?: number; // slope at the END of the segment, radians, negative = downhill
}

export interface TrackSample {
  pos: THREE.Vector3;
  tan: THREE.Vector3;
  right: THREE.Vector3; // horizontal
  heading: number;
  slope: number;
}

const STEP = 0.5;

export class Track {
  readonly length: number;
  private pts: THREE.Vector3[] = [];
  private headings: number[] = [];
  private slopes: number[] = [];

  constructor(segments: Segment[], startSlope = 0) {
    let heading = 0;
    let slope = startSlope;
    const pos = new THREE.Vector3();
    this.push(pos, heading, slope);
    for (const seg of segments) {
      const n = Math.max(1, Math.round(seg.length / STEP));
      const h0 = heading;
      const s0 = slope;
      const h1 = heading + (seg.turn ?? 0);
      const s1 = seg.slope ?? slope;
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const ease = t * t * (3 - 2 * t);
        // heading changes at an eased rate so bends flow into each other
        heading = h0 + (h1 - h0) * ease;
        slope = s0 + (s1 - s0) * ease;
        const ds = seg.length / n;
        pos.x += Math.sin(heading) * Math.cos(slope) * ds;
        pos.y += Math.sin(slope) * ds;
        pos.z -= Math.cos(heading) * Math.cos(slope) * ds;
        this.push(pos, heading, slope);
      }
    }
    this.length = (this.pts.length - 1) * STEP;
  }

  private push(p: THREE.Vector3, heading: number, slope: number) {
    this.pts.push(p.clone());
    this.headings.push(heading);
    this.slopes.push(slope);
  }

  sample(s: number): TrackSample {
    const x = THREE.MathUtils.clamp(s / STEP, 0, this.pts.length - 1.0001);
    const i = Math.floor(x);
    const f = x - i;
    const pos = this.pts[i].clone().lerp(this.pts[i + 1], f);
    // let the path run on straight past either end, so scenery can extend beyond it
    const over = s < 0 ? s : s > this.length ? s - this.length : 0;
    const heading = this.headings[i] + (this.headings[i + 1] - this.headings[i]) * f;
    const slope = this.slopes[i] + (this.slopes[i + 1] - this.slopes[i]) * f;
    const tan = new THREE.Vector3(
      Math.sin(heading) * Math.cos(slope),
      Math.sin(slope),
      -Math.cos(heading) * Math.cos(slope),
    );
    if (over !== 0) pos.addScaledVector(tan, over);
    const right = new THREE.Vector3(Math.cos(heading), 0, Math.sin(heading));
    return { pos, tan, right, heading, slope };
  }
}
