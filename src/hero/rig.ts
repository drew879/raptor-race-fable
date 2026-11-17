// Poses the hero's skeleton in code. There are no baked animations: the run cycle is a
// function of distance travelled, so the feet keep time with the ground at any speed,
// and jump and slide blend in on top.
//
// Stride length grows with speed the way it does in running animals, so a faster run means
// longer strides more than quicker steps. Each foot is planted for about the same distance
// of ground at any speed; the faster the run, the longer the float between footfalls.
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

const GRAVITY = 9.81;
/** Standing hip height in meters, from art/hero.py. */
const HIP_HEIGHT = 0.45;
/** Strides run this much longer than the trackway estimate, so the legs read clearly at speed. */
const STRIDE_STRETCH = 1.15;
/** Meters of ground that pass under the hips while one foot is planted: touchdown to toe-off. */
const CONTACT = 0.57;
/** How high the hips rise in the float between footfalls. */
const FLOAT_HEIGHT = 0.025;

/** Meters per full stride (two steps) at a given speed. This is the rule used to read speed from
 *  fossil trackways (Alexander 1976), stride / hip height = 2.3 * (speed² / (g * hip height))^0.3,
 *  with a little added length. */
export function strideLength(speed: number): number {
  const froude = Math.max(speed, 0.05) ** 2 / (GRAVITY * HIP_HEIGHT);
  return STRIDE_STRETCH * 2.3 * HIP_HEIGHT * Math.pow(froude, 0.3);
}

type Leg = [number, number, number, number];

/** One stride of one leg, eight poses: femur, tibia, metatarsus, toes (degrees). The first four
 *  are the foot on the ground, the last four are the swing. The planted toes cover CONTACT meters
 *  between the first pose and the fourth, in three even parts, so a planted foot does not slide. */
const RUN_CYCLE: Leg[] = [
  [60, 3, 36, 78], // touchdown, foot well ahead
  [43, -35, 20, 97], // weight over the foot, leg a little folded
  [-7, -58, 3, 75], // pushing back, heel rising
  [-36, -58, -34, 18], // toe-off, leg stretched out behind
  [-16, -74, -112, -100], // foot kicks up behind
  [50, -40, -80, -70], // folded, passing under the body
  [85, -50, -5, 15], // knee driving forward, foot held clear of the ground
  [80, 0, 30, 65], // unfolding toward the ground
];
/** The share of RUN_CYCLE spent on the ground (poses 0 to 3 of 8). */
const STANCE = 3 / 8;
const TUCK: Leg = [42, -76, -38, -30]; // in the air
const TUCK_BACK: Leg = [20, -80, -70, -60];
const CROUCH: Leg = [78, -96, 58, 86]; // sliding low
// Sitting the way a bird does: knee forward beside the body, ankle on the ground behind it,
// and the long foot bone lying flat along the ground under the belly.
const SIT: Leg = [92, -46, 88, 90];

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t3);
}

/** Leg pose at a point in the stride. `duty` is the share of the stride this foot spends planted;
 *  the swing takes the rest, so a short duty gives a quick push and a long reach forward. */
function runLeg(phase: number, duty: number, out: Leg): Leg {
  const n = RUN_CYCLE.length;
  const p = ((phase % 1) + 1) % 1;
  const x = (p < duty ? (p / duty) * STANCE : STANCE + ((p - duty) / (1 - duty)) * (1 - STANCE)) * n;
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
  /** Stride phase, 0..1 per full stride (two steps). Advance it by distance / strideLength(speed). */
  phase: number;
  /** Ground speed in meters per second. Sets how long each foot stays planted. */
  speed: number;
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
  /** 0..1, settled down on folded legs with the arms spread, as on a nest. */
  sit?: number;
  /** Where the head is turned, in radians: yaw (+ = to its right) and pitch (+ = up). */
  lookYaw?: number;
  lookPitch?: number;
  /** 0..1, how far the beak is open. */
  beak?: number;
  /** 0..1, eyes closing. */
  blink?: number;
  /** Seconds, for breathing and other small idle movement. Leave out to hold still. */
  idle?: number;
  /** 0..1, recoiling from a bump: rears back, neck drawn in, arms and fans thrown wide. */
  flinch?: number;
  /** 0..1, "Fan out": arms held wide with the hand fans fully open and the tail fan lifted. */
  fan?: number;
}

/** A natural blink for a clock in seconds: shut for about a tenth of a second every few seconds. */
export function blinkAt(time: number, seed = 0): number {
  const period = 3.4;
  const n = Math.floor(time / period + seed);
  // each blink falls at its own moment inside its window, and now and then there are two
  const r = Math.abs(Math.sin(n * 127.1 + seed * 311.7) * 43758.5453) % 1;
  const t = (time + seed * period) % period - (0.4 + r * 2.4);
  const one = (x: number) => (x > 0 && x < 0.16 ? Math.sin((x / 0.16) * Math.PI) : 0);
  return Math.min(1, one(t) * 1.25 + (r > 0.7 ? one(t - 0.3) * 1.25 : 0));
}

export class HeroRig {
  readonly root: THREE.Object3D;
  /** Meters the hips sit above their rest height this frame. The game adds jump height on top. */
  hipLift = 0;
  private joints = new Map<string, Joint>();
  private hipsRestY: number;
  private restDrop = legDrop(REST_LEG as Leg);
  private toeOffDrop = legDrop(RUN_CYCLE[3]);
  private touchdownDrop = legDrop(RUN_CYCLE[0]);
  private tmpQ = new THREE.Quaternion();
  private tmpQ2 = new THREE.Quaternion();
  private legL: Leg = [0, 0, 0, 0];
  private legR: Leg = [0, 0, 0, 0];

  /**
   * `scale`: the legs' size against the parent's (the chick's are the same shape, smaller),
   * so the same poses keep its feet on the ground.
   */
  constructor(
    private model: SkinnedModel,
    private scale = 1,
  ) {
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

  private has(name: string): boolean {
    return this.joints.has(name);
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
    const sit = s.sit ?? 0;
    const flinch = s.flinch ?? 0;
    const fan = s.fan ?? 0;
    const run = s.run * (1 - s.slide) * (1 - sit);
    const grounded = 1 - s.air;
    const breath = s.idle === undefined ? 0 : Math.sin(s.idle * 1.9);

    // ---- legs
    const duty = THREE.MathUtils.clamp(CONTACT / strideLength(s.speed), 0.2, 0.46);
    runLeg(s.phase, duty, this.legL);
    runLeg(s.phase + 0.5, duty, this.legR);
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
    if (sit > 0) {
      mixLeg(this.legL, SIT, sit, this.legL);
      mixLeg(this.legR, SIT, sit, this.legR);
    }

    // ---- hips: the lower foot stays on the ground, which gives the run its bounce for free
    const drop = Math.max(legDrop(this.legL), legDrop(this.legR));
    let lift = (drop - this.restDrop) * this.scale;
    // Between footfalls both feet are off the ground for a moment. The hips then follow a low arc
    // from their height at toe-off to their height at the next touchdown, not the dangling feet.
    const half = ((s.phase % 0.5) + 0.5) % 0.5;
    if (half > duty) {
      const f = (half - duty) / (0.5 - duty);
      const arc = this.toeOffDrop + (this.touchdownDrop - this.toeOffDrop) * f + FLOAT_HEIGHT * 4 * f * (1 - f);
      lift += Math.max(0, arc - drop) * run * grounded * this.scale;
    }
    const minLift = (0.15 - this.restDrop) * this.scale; // belly on the ground
    if (s.slide > 0 || sit > 0) lift = Math.max(lift, minLift);
    lift += breath * 0.0025 * this.scale * (1 - run);
    this.hipLift = lift;
    const hips = this.joint('hips');
    hips.bone.position.y = this.hipsRestY + lift;

    // Sign convention for pitch (rotation about the hero's right side): positive swings a
    // hanging leg forward, which is the same turn that lifts the nose. So nose-down is negative.
    const swing = Math.sin(s.phase * TAU);
    const bounce = Math.cos(s.phase * TAU * 2);
    const hipsPitch = (run * -7 + s.airTilt * 11 * s.air + s.slide * -3 + sit * 4 + flinch * 10) * DEG;
    const hipsYaw = swing * 5 * DEG * run * grounded + s.lean * -10 * DEG;
    const hipsRoll = (Math.cos(s.phase * TAU) * 3 * run * grounded + s.lean * 14) * DEG;
    this.turn('hips', hipsPitch, hipsYaw, -hipsRoll);

    this.poseLeg('L', this.legL, hipsPitch, s.slide * 0.25 + sit * 0.3);
    this.poseLeg('R', this.legR, hipsPitch, s.slide * 0.25 + sit * 0.3);

    // ---- spine, neck and head: the neck reaches forward at speed and lies low in a slide,
    // while the head stays level and steady, like a running bird's
    // sitting, the neck draws back into an S and the head comes down toward the nest
    const reach = run * 10 + s.slide * 46 - s.air * 4 - sit * 14 - flinch * 26;
    const chestPitch = s.slide * -8 * DEG + breath * 0.6 * DEG * (1 - run);
    const lookYaw = s.lookYaw ?? 0;
    const lookPitch = s.lookPitch ?? 0;
    const neck1 = -(reach + bounce * 2 * run) * DEG + lookPitch * 0.25;
    const neck2 = -(reach * 0.5 - bounce * 2 * run - sit * 30) * DEG + lookPitch * 0.3;
    this.turn('chest', chestPitch, -hipsYaw * 0.5, hipsRoll * 0.4);
    // yaw is counter-clockwise seen from above, so turning the head to its right is negative
    this.turn('neck1', neck1, -lookYaw * 0.3, 0);
    this.turn('neck2', neck2, s.lean * 8 * DEG - lookYaw * 0.35, 0);
    const level = -(hipsPitch + chestPitch + neck1 + neck2);
    this.turn(
      'head',
      level * 0.85 + (run * -4 + s.air * 3 - sit * 16) * DEG + lookPitch * 0.45 + sit * lookPitch * 0.3,
      s.lean * 10 * DEG - lookYaw * 0.35,
      hipsRoll * -0.6 - lookYaw * 0.12,
    );
    if (this.has('jaw')) this.turn('jaw', -(s.beak ?? 0) * 24 * DEG, 0, 0);
    if (this.model.eye) this.model.eye.uniforms.uBlink.value = s.blink ?? 0;

    // ---- tail: counters the hips, lifts in the air, lies flat in a slide (up is negative)
    const tailPitch = (bounce * 3 * run - run * 3 - s.air * 14 + s.slide * 7 + sit * 6 - flinch * 14 - fan * 16) * DEG - hipsPitch * 0.5;
    this.turn('tail1', tailPitch, -hipsYaw * 0.9 + swing * -4 * DEG * run, 0);
    this.turn('tail2', tailPitch * 0.8, swing * -6 * DEG * run + s.lean * 8 * DEG, 0);

    // ---- arms: fans held out for balance, spread wide in the air, swept back in a slide
    for (const sfx of ['L', 'R'] as const) {
      const side = sfx === 'L' ? -1 : 1;
      const beat = Math.sin(s.phase * TAU * 2 + (side > 0 ? 0.6 : 0));
      // sitting, the arms open out and forward, so the fans lie over the edge of the nest
      const lift = (run * 8 + beat * 5 * run * (1 - fan) + s.air * 30 - s.slide * 4 + sit * 26 + flinch * 34 + fan * 24 + breath * 0.8 * (1 - run)) * DEG;
      const sweep = (run * 6 + s.air * 14 + s.slide * 16 - sit * 30 - flinch * 12 - fan * 4) * DEG;
      this.turn('arm' + sfx, 0, -side * sweep, side * lift);
      this.turn('hand' + sfx, 0, -side * sweep * 0.5, side * lift * 0.5);
      // the hand opens the fan when it is in use and folds it back against the body at rest
      if (this.has('fan' + sfx)) {
        const open = (run * 10 + s.air * 22 + sit * 24 + flinch * 26 + fan * 44 - s.slide * 6) * DEG;
        this.turn('fan' + sfx, 0, side * open, side * open * 0.3);
      }
    }
  }
}
