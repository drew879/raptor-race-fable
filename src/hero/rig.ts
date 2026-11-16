// Poses the hero's skeleton in code. There are no baked animations: the run cycle is a
// function of distance travelled, so the feet keep time with the ground at any speed,
// and jump and slide blend in on top.
//
// Angles for the legs are "from straight down, positive = forward", the same convention
// the Blender script uses to build the model, so poses can be reasoned about in one place.

import * as THREE from 'three';
import type { SkinnedModel } from '../world/assets';

const DEG = Math.PI / 180;
const FEMUR = 0.13;
const TIBIA = 0.2;
const META = 0.13;
const TOE = 0.076;
/** Rest pose of a leg, matching REST_LEG in art/hero.py. */
const REST_LEG = [26, -34, 18, 88];

type Leg = [number, number, number, number];

/** One stride of one leg, eight evenly spaced poses: femur, tibia, metatarsus, toes (degrees). */
const RUN_CYCLE: Leg[] = [
  [48, -8, 28, 82], // foot lands ahead
  [26, -38, 14, 90], // weight over the foot
  [2, -50, -12, 78], // pushing back
  [-18, -52, -48, 20], // toe-off
  [-14, -70, -112, -100], // foot kicks up behind
  [22, -72, -80, -80], // tucked, passing under the body
  [52, -45, -20, -10], // swinging forward
  [62, -14, 26, 55], // reaching for the ground
];
const TUCK: Leg = [42, -76, -38, -30]; // in the air
const TUCK_BACK: Leg = [20, -80, -70, -60];
const CROUCH: Leg = [78, -96, 58, 86]; // sliding low

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t3);
}

function runLeg(phase: number, out: Leg): Leg {
  const n = RUN_CYCLE.length;
  const x = (((phase % 1) + 1) % 1) * n;
  const i = Math.floor(x);
  const t = x - i;
  for (let k = 0; k < 4; k++) {
    out[k] = catmull(
      RUN_CYCLE[(i + n - 1) % n][k],
      RUN_CYCLE[i % n][k],
      RUN_CYCLE[(i + 1) % n][k],
      RUN_CYCLE[(i + 2) % n][k],
      t,
    );
  }
  return out;
}

function mixLeg(a: Leg, b: Leg, w: number, out: Leg): Leg {
  for (let k = 0; k < 4; k++) out[k] = a[k] + (b[k] - a[k]) * w;
  return out;
}

/** How far below the hip the lowest part of the foot hangs, for leg angles in degrees. */
function legDrop(leg: Leg): number {
  const [a1, a2, a3, a4] = leg.map((d) => d * DEG);
  const foot = FEMUR * Math.cos(a1) + TIBIA * Math.cos(a2) + META * Math.cos(a3);
  const toe = foot + TOE * Math.cos(a4);
  return Math.max(foot, toe) + 0.012;
}

interface Joint {
  bone: THREE.Bone;
  restLocal: THREE.Quaternion;
  restWorld: THREE.Quaternion;
  restWorldInv: THREE.Quaternion;
}

export interface HeroState {
  /** Stride phase, 0..1 per full stride (two steps). Advance it with distance travelled. */
  phase: number;
  /** 0 = standing, 1 = full run. */
  run: number;
  /** 0..1, how much the airborne pose takes over. */
  air: number;
  /** -1..1, rising (+) or falling (-) while airborne. Tips the body. */
  airTilt: number;
  /** 0..1, how much the slide pose takes over. */
  slide: number;
  /** -1..1, leaning into a lane change (+ = moving right). */
  lean: number;
}

export class HeroRig {
  readonly root: THREE.Object3D;
  /** Meters the hips sit above their rest height this frame. The game adds jump height on top. */
  hipLift = 0;
  private joints = new Map<string, Joint>();
  private hipsRestY: number;
  private restDrop = legDrop(REST_LEG as Leg);
  private tmpQ = new THREE.Quaternion();
  private tmpQ2 = new THREE.Quaternion();
  private legL: Leg = [0, 0, 0, 0];
  private legR: Leg = [0, 0, 0, 0];

  constructor(model: SkinnedModel) {
    this.root = model.root;
    this.root.updateMatrixWorld(true);
    const rootInv = new THREE.Quaternion();
    this.root.getWorldQuaternion(rootInv).invert();
    for (const [name, bone] of model.bones) {
      const restWorld = new THREE.Quaternion();
      bone.getWorldQuaternion(restWorld).premultiply(rootInv);
      this.joints.set(name, {
        bone,
        restLocal: bone.quaternion.clone(),
        restWorld,
        restWorldInv: restWorld.clone().invert(),
      });
    }
    this.hipsRestY = this.joint('hips').bone.position.y;
  }

  private joint(name: string): Joint {
    const j = this.joints.get(name);
    if (!j) throw new Error(`Hero has no bone named ${name}`);
    return j;
  }

  /** Turn a joint away from rest. The rotation is given in hero space (X right, Y up, -Z forward)
   *  and rides along with whatever the parent bones are doing. */
  private turn(name: string, pitch = 0, yaw = 0, roll = 0) {
    const j = this.joint(name);
    const q = this.tmpQ.identity();
    if (yaw) q.multiply(this.tmpQ2.setFromAxisAngle(Y, yaw));
    if (pitch) q.multiply(this.tmpQ2.setFromAxisAngle(X, pitch));
    if (roll) q.multiply(this.tmpQ2.setFromAxisAngle(Z, roll));
    // express that hero-space rotation in the bone's own rest frame
    j.bone.quaternion.copy(j.restLocal).multiply(j.restWorldInv).multiply(q).multiply(j.restWorld);
  }

  private poseLeg(sfx: 'L' | 'R', leg: Leg, hipsPitch: number, splay: number) {
    const d = leg.map((v, i) => (v - REST_LEG[i]) * DEG);
    const side = sfx === 'L' ? -1 : 1;
    // each joint turns by the change in its angle relative to the segment above it
    this.turn('thigh' + sfx, d[0] - hipsPitch, 0, side * splay);
    this.turn('shin' + sfx, d[1] - d[0]);
    this.turn('meta' + sfx, d[2] - d[1]);
    this.turn('toes' + sfx, d[3] - d[2]);
  }

  pose(s: HeroState) {
    const TAU = Math.PI * 2;
    const run = s.run * (1 - s.slide);
    const grounded = 1 - s.air;

    // ---- legs
    runLeg(s.phase, this.legL);
    runLeg(s.phase + 0.5, this.legR);
    mixLeg(REST_LEG as Leg, this.legL, run, this.legL);
    mixLeg(REST_LEG as Leg, this.legR, run, this.legR);
    if (s.air > 0) {
      mixLeg(this.legL, TUCK, s.air, this.legL);
      mixLeg(this.legR, TUCK_BACK, s.air, this.legR);
    }
    if (s.slide > 0) {
      mixLeg(this.legL, CROUCH, s.slide, this.legL);
      mixLeg(this.legR, CROUCH, s.slide * 0.92, this.legR);
    }

    // ---- hips: the lower foot stays on the ground, which gives the run its bounce for free
    const drop = Math.max(legDrop(this.legL), legDrop(this.legR));
    let lift = drop - this.restDrop;
    const minLift = 0.15 - this.restDrop; // belly on the ground
    if (s.slide > 0) lift = Math.max(lift, minLift);
    this.hipLift = lift;
    const hips = this.joint('hips');
    hips.bone.position.y = this.hipsRestY + lift;

    // Sign convention for pitch (rotation about the hero's right side): positive swings a
    // hanging leg forward, which is the same turn that lifts the nose. So nose-down is negative.
    const swing = Math.sin(s.phase * TAU);
    const bounce = Math.cos(s.phase * TAU * 2);
    const hipsPitch = (run * -7 + s.airTilt * 11 * s.air + s.slide * -3) * DEG;
    const hipsYaw = swing * 5 * DEG * run * grounded + s.lean * -10 * DEG;
    const hipsRoll = (Math.cos(s.phase * TAU) * 3 * run * grounded + s.lean * 14) * DEG;
    this.turn('hips', hipsPitch, hipsYaw, -hipsRoll);

    this.poseLeg('L', this.legL, hipsPitch, s.slide * 0.25);
    this.poseLeg('R', this.legR, hipsPitch, s.slide * 0.25);

    // ---- spine, neck and head: the neck reaches forward at speed and lies low in a slide,
    // while the head stays level and steady, like a running bird's
    const reach = run * 10 + s.slide * 46 - s.air * 4;
    const chestPitch = s.slide * -8 * DEG;
    const neck1 = -(reach + bounce * 2 * run) * DEG;
    const neck2 = -(reach * 0.5 - bounce * 2 * run) * DEG;
    this.turn('chest', chestPitch, -hipsYaw * 0.5, hipsRoll * 0.4);
    this.turn('neck1', neck1, 0, 0);
    this.turn('neck2', neck2, s.lean * 8 * DEG, 0);
    const level = -(hipsPitch + chestPitch + neck1 + neck2);
    this.turn('head', level * 0.85 + (run * -4 + s.air * 3) * DEG, s.lean * 10 * DEG, hipsRoll * -0.6);

    // ---- tail: counters the hips, lifts in the air, lies flat in a slide (up is negative)
    const tailPitch = (bounce * 3 * run - run * 3 - s.air * 14 + s.slide * 7) * DEG - hipsPitch * 0.5;
    this.turn('tail1', tailPitch, -hipsYaw * 0.9 + swing * -4 * DEG * run, 0);
    this.turn('tail2', tailPitch * 0.8, swing * -6 * DEG * run + s.lean * 8 * DEG, 0);

    // ---- arms: fans held out for balance, spread wide in the air, swept back in a slide
    for (const sfx of ['L', 'R'] as const) {
      const side = sfx === 'L' ? -1 : 1;
      const beat = Math.sin(s.phase * TAU * 2 + (side > 0 ? 0.6 : 0));
      const lift = (run * 8 + beat * 5 * run + s.air * 30 - s.slide * 4) * DEG;
      const sweep = (run * 6 + s.air * 14 + s.slide * 16) * DEG;
      this.turn('arm' + sfx, 0, -side * sweep, side * lift);
      this.turn('hand' + sfx, 0, -side * sweep * 0.5, side * lift * 0.5);
    }
  }
}
