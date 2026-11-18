// The rough playable run: one runner, one trail, an egg to chase.
// Everything that moves is driven from here; the world pieces come from src/world.

import * as THREE from 'three';
import { setReloadGuard } from '../app/build';
import { Sound } from '../audio/sound';
import { blinkAt, HeroRig, strideLength, type HeroState } from '../hero/rig';
import type { Lookdev } from '../lookdev/scene';
import { paintMaterial, world } from '../render/paint';
import { SunShadow } from '../render/shadow';
import type { Style } from '../render/styles';
import { instance, instances, loadKit, loadSkinned, materialFor, SHADOW_LAYER, type Placement } from '../world/assets';
import { makeContactShadow, makeGlow, makeGlowField, makeLeaf, makeMistField, makeShaftField } from '../world/fx';
import { makeCreek } from '../world/creek';
import { fbm, rng, smoothstep } from '../world/noise';
import { makeRidges, makeSky, makeVolcano } from '../world/sky';
import { Terrain } from '../world/terrain';
import { Track } from '../world/track';
import { AMBER, bowAt, CHECKPOINTS, DEFAULT_SPEED, END_S, FINDS, FORK, FORK_LABELS_FROM, HINTS, LANE, RETRY_S, laneMap, laneU, OBSTACLES, POWER, SEGMENTS, START_SLOPE, VISTAS, type Obstacle } from './course';
import { Flora } from './flora';
import { makeHud } from './hud';
import { makeOverlook, spurHalf } from './overlook';
import { listenForMoves, type Move } from './input';
import { EGG_WAIST, eggTurn, loadChick, makeNest, makeShell, nestHeight, OUR_ANGLE, type Chick } from './story';

import treesUrl from '../assets/models/flora_trees.glb?url';
import smallUrl from '../assets/models/flora_small.glb?url';
import propsUrl from '../assets/models/props.glb?url';
import heroUrl from '../assets/models/caudipteryx.glb?url';
import animalsUrl from '../assets/models/animals.glb?url';

export interface RunHooks {
  styles: Style[];
  styleIndex(): number;
  pickStyle(index: number): void;
  /** A short note on how sharp the picture is being drawn right now. */
  quality?(): string;
  /** Times a few frames and says what one costs right now. Slow to answer, so it is asked for after the pause sheet is up. */
  speedNow?(): Promise<string>;
}

/** The run, plus a few handles the speed test uses to switch parts of the picture off. */
export interface RunView extends Lookdev {
  debug: {
    st: { s: number; eggS: number; paused: boolean; started: boolean };
    forest: THREE.Object3D;
    setShadows(on: boolean): void;
  };
}

const START_S = 3;
const JUMP_HEIGHT = 0.72;
const JUMP_TIME = 0.56;
const GRAVITY = (8 * JUMP_HEIGHT) / (JUMP_TIME * JUMP_TIME);
const JUMP_V = (GRAVITY * JUMP_TIME) / 2;
const SLIDE_TIME = 0.62;
/**
 * How long the egg is, in meters. It is one size everywhere, in the nest, in the chase and in
 * the parent's care, so it never seems to change. (The real egg was probably about 8 cm long;
 * ours is drawn large so it can be followed from far behind.) Drew tried 34 and 45 cm in build
 * 30 and chose 34: the larger read better in the chase but was "too comically large next to
 * the dinosaur in the nest".
 */
const EGG_LEN = 0.34;
const EGG_R = EGG_WAIST * EGG_LEN; // half its width
const EGG_HALF = 0.5 * EGG_LEN; // half its length
const EGG_G = 9.5;
/**
 * How the egg travels. Lively: tumbling at changing angles, each bounce depending on how it
 * lands. Wild: Lively, and it shows off: it shivers before a hop and flips over the log, jinks
 * late and hard round trees, shoots out from under arches, and throws in big bounces and quick
 * side-steps when the trail is clear. Wilder: all of that turned up, and now and then it lands
 * on its end and spins like a top, and it surges ahead and drops back.
 */
export const EGG_MODES = ['Lively', 'Wild', 'Berserk'];
/** The side of the fork the egg takes (-1 is left, the harder and richer one), and the side a runner is put on if it meets the rock head-on. */
const EGG_FORK = -1;
const EASY_SIDE = 1;

// how far along the trail each kind of obstacle can catch you
const DEPTH: Record<Obstacle['kind'], number> = { log: 0.3, arch: 0.45, boulder: 0.42, tree: 0.26, creek: 0.6, hollow: 1.7, crossing: 0.32 };
// Obstacles are solid. A runner that meets one stops where its body touches it (its head and
// chest reach well ahead of its hips, so that is short of the obstacle's middle by FACE), then
// gets past by the move it should have made and is set down CLEAR beyond the middle.
const FACE: Record<Obstacle['kind'], number> = { log: 0.5, arch: 0.74, boulder: 0.74, tree: 0.54, creek: 0.5, hollow: 2.44, crossing: 0.5 };
const CLEAR: Record<Obstacle['kind'], number> = { log: 0.8, arch: 1.0, boulder: 0.75, tree: 0.6, creek: 0.9, hollow: 2.3, crossing: 0.8 };
const goAround = (kind: Obstacle['kind']) => kind === 'boulder' || kind === 'tree';
const jumps = (kind: Obstacle['kind']) => kind === 'log' || kind === 'creek' || kind === 'crossing';
const slides = (kind: Obstacle['kind']) => kind === 'arch' || kind === 'hollow';
const IMPACT_TIME = 0.18;
const RECOVER_TIME = 0.5;
/** How much further ahead the egg gets for each bump, in meters. */
const BUMP_COST = 3.2;
// The egg never touches an obstacle. It hops logs (the chick kicks), stays down under arches,
// and swings into an open lane round trees and boulders.
const HOP_HALF = 2.3; // meters either side of a log that a hop covers
const HOP_HEIGHT = 0.85;
const HOP_HEIGHT_WILD = 1.25;
const HOP_HEIGHT_WILDER = 1.6;
// The chase: how far ahead the egg starts, the nearest it lets you get, and when it is getting away.
const START_LEAD = 15;
const MIN_LEAD = 4.8;
const WARN_LEAD = 21;
const MAX_LEAD = 26; // let it get this far ahead and the egg is lost
/**
 * What "Try again" does once the egg is lost. Drew's call after build 26: the level starts over
 * ("just reappearing at an arbitrary spot behind where you were seems too generous"). He may
 * want designated checkpoints later, so the checkpoint restart is kept and this switches it on.
 */
const LOST_RESTART = 'start' as 'start' | 'checkpoint';
/**
 * The opening, in seconds from "Run!". Three taps from inside rock the egg where it stands on
 * the nest's downhill rim, each harder than the last. The third brings it up to the very point
 * of balance (teeter). It hangs there, then goes over, slowly at first, and comes down on the
 * slope below the rim (roll): from there the chase's own rules roll it, gathering speed. The
 * parent gets up (stand) and gives chase (run); the view swings in behind (camFrom to camTo);
 * swipes count from go; the egg stays on the ground until bounce.
 */
const INTRO = { taps: [0.6, 1.4, 2.2], teeter: 2.2 + Math.PI / 28, roll: 3.61, stand: 3.5, run: 4.9, go: 5.9, camFrom: 4.35, camTo: 5.8, bounce: 5.6, end: 6.6 };
/** How the egg stands on the rim: leaning in a little (radians from upright, outward positive), how much further over each tap leaves it, and how far each rocks it. */
const PERCH = { lean: -0.35, creep: [0.05, 0.07, 0], rock: [0.14, 0.2, 0.26], bury: 0.14 };
/** The ending, a step at a time. The chase; the last shelf; the egg's dash for the edge; the dive; the egg held at the edge; turning back from it; the hatching; the journal card; the results. Or the miss. */
const END = { chase: 0, shelf: 1, dash: 2, dive: 3, caught: 4, turn: 5, hatch: 6, card: 7, results: 8, miss: 9 } as const;
/**
 * The trail runs out at END_S, where the ground stops. The egg comes to a stop `park` meters
 * short of that and waits until the runner is `near` behind it. Then one more kick from inside
 * sends it for the edge at `v0` meters a second, gathering `a` more each second: the dash. A
 * swipe up before the dash is over is a dive, which starts when the egg is `dive` meters from
 * where it will be caught, `catch` short of the edge, and comes down on it there. The last
 * `slowFrom` meters run in slow motion. A swipe with less than `late` meters to go is too late.
 */
const FINALE = { park: 9, near: 3.2, v0: 2.6, a: 5.2, catch: 0.4, dive: 2.6, late: 0.8, slowFrom: 4.6, slow: 0.5 };
const PARK_S = END_S - FINALE.park;
/** Where the egg starts being reeled in for the ending. From here on it cannot be lost: the catch is the test. */
const REEL_FROM = PARK_S - 78;
const CATCH_S = END_S - FINALE.catch;
/** How far in front of its hips the parent holds the egg, how far back from the edge they settle, and how long turning round takes. */
const HOLD = 0.3 + EGG_LEN * 0.55;
/** At the catch it is pinned further out, beyond the beak, so the head is never in it. */
const CATCH_HOLD = HOLD + 0.22;
const SETTLE_BACK = 1.3;
const TURN_TIME = 1.15;
/** The hatching, in seconds from when the parent has settled: taps, the top coming off, and the journal card. */
const HATCH = { taps: [0.5, 1.05, 1.5], pop: 2.0, card: 5.0 };
const LOW_HALF = 1.4; // meters either side of an arch where it stays on the ground
const SETTLE = 7.5; // meters before either where it stops bouncing, so it arrives on the ground

interface Bump {
  kind: 'log' | 'arch' | 'around' | 'hollow';
  t: number;
  /** Where the hips stop, where the recovery ends, and the sideways start and finish. */
  faceS: number;
  exitS: number;
  u0: number;
  toLane: number;
}

export async function buildRun(ui: HTMLElement, stage: HTMLElement, hooks: RunHooks): Promise<RunView> {
  const [trees, small, props, animals, heroModel] = await Promise.all([
    loadKit(treesUrl),
    loadKit(smallUrl),
    loadKit(propsUrl),
    loadKit(animalsUrl),
    loadSkinned(heroUrl),
  ]);

  const query = new URLSearchParams(location.search);
  const testing = query.has('nopause'); // test runs only
  const noLose = query.has('nolose'); // test runs only: the egg can't be lost
  // test runs start on the chase and scoop by themselves, unless asked for the scenes
  const playIntro = !testing || query.has('intro');
  const autoScoop = testing && !query.has('ending');
  const sound = new Sound();
  sound.origin = START_S;
  sound.span = END_S - START_S;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, 0.46, 0.3, 2500);
  const track = new Track(SEGMENTS, START_SLOPE);
  const creekAt = OBSTACLES.filter((o) => o.kind === 'creek').map((o) => o.s);
  // the ground knows where the lanes swing apart at the fork and where creeks cut through its edges
  const terrain = new Terrain(track, { laneMap, creeks: creekAt, spur: { lip: END_S, half: (s) => spurHalf(s, END_S) } });
  const rnd = rng(77);

  // ---------------------------------------------------------------- sky and far scenery
  // The sun sits ahead and to the valley side of the trail's overall direction.
  const overall = track.sample(track.length).pos.clone().sub(track.sample(0).pos).setY(0).normalize();
  const bearing = Math.atan2(overall.x, -overall.z);
  const az = bearing + THREE.MathUtils.degToRad(40);
  const el = THREE.MathUtils.degToRad(29);
  world.uSunDir.value.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
  const sun = world.uSunDir.value;

  scene.add(makeSky());
  const eye0 = terrain.place(START_S, 0, 1.45);
  const far = new THREE.Group();
  far.add(
    makeRidges(eye0, [
      { radius: 250, base: eye0.y - 22, amp: 9, freq: 5, color: '#24443a', trees: 5, seed: 3, mist: 0.42 },
      { radius: 400, base: eye0.y - 10, amp: 15, freq: 4, color: '#284a42', trees: 5, seed: 11, mist: 0.58 },
      { radius: 590, base: eye0.y + 8, amp: 24, freq: 3.2, color: '#2d4e4b', trees: 4, seed: 23, mist: 0.7 },
      { radius: 870, base: eye0.y + 38, amp: 34, freq: 2.6, color: '#335456', trees: 0, seed: 37, mist: 0.79 },
      { radius: 1320, base: eye0.y + 95, amp: 52, freq: 2.2, color: '#3a5c62', trees: 0, seed: 51, mist: 0.86 },
    ]),
  );
  const volcano = makeVolcano(eye0, bearing + THREE.MathUtils.degToRad(10), 1950, 400, '#3b5a66', 0.72);
  far.add(volcano);
  scene.add(far);

  // All the mist is one draw call and all the sun shafts another. Sheets are listed from the
  // farthest to the nearest: the volcano's plume, the valley's layers, then the trail's own mist.
  const mist = makeMistField(16);
  mist.mesh.renderOrder = 2;
  scene.add(mist.mesh);
  const summit = volcano.userData.summit as THREE.Vector3;
  const drift = volcano.userData.side as THREE.Vector3;
  const plume: THREE.Vector3[] = [];
  for (let i = 0; i < 4; i++) {
    const p = summit.clone().addScaledVector(drift, -40 - i * 95);
    p.y += 30 + i * 34;
    plume.push(p);
    mist.set(i, 190 + i * 70, 70 + i * 22, 40 + i * 9.7, '#6b7480', 0.5 - i * 0.07);
  }

  // ---------------------------------------------------------------- ground and forest
  const ground = terrain.buildMesh(-40, track.length + 40);
  scene.add(ground);
  // three worn tracks with a broken seam of moss between them, so the lanes read without painted lines
  terrain.material.uniforms.uLanes.value.set(LANE, 1, 0.08, 0);
  const flora = new Flora(terrain, trees, small, {
    length: END_S - 1,
    vistas: VISTAS,
    keepClear: OBSTACLES.map((o) => o.s),
    keepOut: (ps, pu) =>
      Math.abs(pu) - bowAt(ps) < 1.5 ||
      creekAt.some((c) => Math.abs(c - ps) < 1.2) ||
      Math.hypot(ps - START_S, pu) < 2.7 || // (room round the nest)
      ps > END_S - 19 || // (and nothing grows on the rock at the end, or where the ground falls away beside it)
      (ps > END_S - 27 && Math.abs(pu) > spurHalf(ps, END_S) - 1),
  });
  scene.add(flora.group);
  scene.add(makeOverlook(terrain, small, trees, END_S));

  const basisAt = (s: number, follow = 1): THREE.Quaternion => {
    const t = track.sample(s);
    const fwd = t.tan.clone();
    fwd.y *= follow;
    fwd.normalize();
    const z = fwd.clone().negate();
    const y = new THREE.Vector3().crossVectors(z, t.right).normalize();
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(t.right, y, z));
  };

  // ---------------------------------------------------------------- obstacles
  const byModel: Record<string, Placement[]> = { log: [], arch: [], boulder: [], lane_tree: [], hollow_log: [] };
  /** The dozing Psittacosaurus: its body lies still, its head is on a pivot at the base of the neck. */
  const sleepers: { s: number; u: number; group: THREE.Group; neck: THREE.Group; up: number; startled: number }[] = [];
  /** A young Psittacosaurus in pieces the game moves: body, head on its neck, four legs (front pair first). */
  interface Young {
    group: THREE.Group;
    neck: THREE.Group;
    legs: THREE.Group[];
  }
  /** Each file of young ones crossing the trail. fled: seconds since the runner blundered into them. */
  const crossings: { s: number; young: Young[]; fled: number }[] = [];
  for (const o of OBSTACLES) {
    // in the fork an obstacle sits in its own side's lane; elsewhere logs and arches span the trail
    const mid = o.branch ? laneU(o.branch, o.s) : 0;
    if (o.kind === 'log' || o.kind === 'arch') {
      byModel[o.kind].push({ position: terrain.place(o.s, mid, 0), yaw: 0, scale: 1, tilt: basisAt(o.s) });
    } else if (o.kind === 'creek') {
      // it comes down the hill on the left and runs away into the valley on the right; in the
      // fork it meets the island and goes under it
      scene.add(makeCreek(terrain, small, o.s, o.branch === 1 ? 0.2 : -15, o.branch === -1 ? -0.2 : 15));
    } else if (o.kind === 'hollow') {
      byModel.hollow_log.push({ position: terrain.place(o.s, laneU(o.lanes[0], o.s), 0), yaw: 0, scale: 1, tilt: basisAt(o.s) });
    } else if (o.kind === 'crossing') {
      // a file of three young Psittacosaurus walking across the trail, and an adult dozing in
      // the ferns on the side they come from
      const young: Young[] = [];
      for (let i = 0; i < 3; i++) {
        const group = new THREE.Group();
        group.add(instance(animals, 'young_body'));
        const neck = new THREE.Group();
        neck.position.set(0, 0.25, -0.22); // as built in art/psittaco.py
        neck.add(instance(animals, 'young_head'));
        group.add(neck);
        const legs = ([[-0.055, 0.19, -0.14, 'young_leg_f'], [0.055, 0.19, -0.14, 'young_leg_f'], [-0.065, 0.2, 0.1, 'young_leg_h'], [0.065, 0.2, 0.1, 'young_leg_h']] as const).map(
          ([x, y, z, name]) => {
            const leg = new THREE.Group();
            leg.position.set(x, y, z);
            leg.add(instance(animals, name));
            group.add(leg);
            return leg;
          },
        );
        group.scale.setScalar(1.15);
        scene.add(group);
        young.push({ group, neck, legs });
      }
      crossings.push({ s: o.s, young, fled: 0 });
      const group = new THREE.Group();
      const zu = -3.3;
      group.position.copy(terrain.place(o.s - 2.5, zu, 0));
      group.quaternion.copy(basisAt(o.s - 2.5, 0)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -0.8));
      group.add(instance(animals, 'psittaco_body'));
      const neck = new THREE.Group();
      neck.position.set(0, 0.15, -0.4); // the base of its neck, as built in art/psittaco.py
      neck.add(instance(animals, 'psittaco_head'));
      group.add(neck);
      scene.add(group);
      sleepers.push({ s: o.s - 2.5, u: zu, group, neck, up: 0, startled: 0 });
    } else {
      for (const lane of o.lanes) {
        const upright = basisAt(o.s, 0); // boulders and trees stand straight on a slope
        byModel[o.kind === 'tree' ? 'lane_tree' : 'boulder'].push({
          position: terrain.place(o.s, laneU(lane, o.s), -0.04),
          yaw: 0,
          scale: o.kind === 'tree' ? 1 : 0.92 + rnd() * 0.12,
          tilt: upright.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28)),
        });
      }
    }
  }

  // The fork: a long rib of mossy rock stands where the middle lane was, with a giant ginkgo on
  // it. The side lanes swing out round it and come back together beyond.
  if (FORK) {
    const pos: number[] = [];
    const paint: number[] = [];
    const index: number[] = [];
    const across = [-1, -0.88, -0.5, 0, 0.5, 0.88, 1];
    const high = [0, 0.66, 0.96, 1, 0.96, 0.66, 0];
    const rockA = new THREE.Color('#5e5b54');
    const rockB = new THREE.Color('#8f897b');
    const moss = new THREE.Color('#5f8233');
    const c = new THREE.Color();
    const v = new THREE.Vector3();
    let r = 0;
    for (let ps = FORK.from - 0.4; ps <= FORK.to + 0.4; ps += 0.8, r++) {
      const t = (ps - FORK.from) / (FORK.to - FORK.from);
      const ends = smoothstep(-0.01, 0.09, t) * (1 - smoothstep(0.91, 1.01, t));
      const half = Math.max(0, LANE / 2 + bowAt(ps) - 0.44) * ends; // it stops short of the side lanes
      const tall = (0.55 + 0.35 * fbm(ps * 0.21, 3.3)) * ends; // low enough to see the other side over it
      for (let k = 0; k < across.length; k++) {
        const pu = across[k] * half * (1 + 0.12 * (fbm(ps * 0.6, k * 2.1) - 0.5));
        terrain.place(ps, pu, high[k] * tall + (k > 0 && k < 6 ? (fbm(ps * 1.3, k * 5.7) - 0.5) * 0.3 * ends : 0), v);
        pos.push(v.x, v.y, v.z);
        c.copy(rockA).lerp(rockB, fbm(ps * 0.9, k * 3.3)).lerp(moss, smoothstep(0.7, 1.0, high[k]) * (0.5 + 0.5 * fbm(ps * 0.5, k + 9)));
        paint.push(c.r, c.g, c.b, 0.55 + 0.45 * high[k]);
      }
      if (r > 0) {
        for (let k = 0; k < across.length - 1; k++) {
          const a = (r - 1) * across.length + k;
          const b = a + across.length;
          index.push(a, a + 1, b, a + 1, b + 1, b);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aPaint', new THREE.Float32BufferAttribute(paint, 4));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
    geo.setIndex(index);
    geo.computeVertexNormals();
    const island = new THREE.Mesh(geo, materialFor('rock'));
    island.frustumCulled = false;
    island.layers.enable(SHADOW_LAYER);
    scene.add(island);
    // the giant ginkgo, with ferns and boulders along the rock
    const mid = (FORK.from + FORK.to) / 2;
    const ginkgo = instance(trees, 'ginkgo_a');
    ginkgo.position.copy(terrain.place(mid, 0, 0.45));
    ginkgo.scale.setScalar(1.45);
    scene.add(ginkgo);
    const dress = (name: string, ps: number, pu: number, lift: number, size: number, kit = small) => {
      const g = instance(kit, name);
      g.position.copy(terrain.place(ps, pu, lift));
      g.rotation.y = ps * 1.7;
      g.scale.setScalar(size);
      scene.add(g);
    };
    dress('rock_b', FORK.from + 2.2, 0, 0.1, 0.8);
    dress('fern_a', FORK.from + 9, 0.1, 0.6, 1.0);
    dress('fern_b', mid - 9, -0.2, 0.65, 0.9);
    dress('rock_a', mid + 7, 0.1, 0.5, 0.9);
    dress('fern_c', mid + 13, 0.2, 0.6, 1.1);
    dress('treefern_a', FORK.to - 9, 0, 0.45, 0.8, trees);
    dress('rock_b', FORK.to - 2.4, 0, 0.1, 0.7);
  }
  for (const [name, list] of Object.entries(byModel)) scene.add(instances(props, name, list, true));

  // ---------------------------------------------------------------- amber
  // One draw call for the amber and one for its glow. Only the pieces near the runner are in
  // the list at any moment; it is refilled as the runner moves from one batch of trail to the next.
  const AMBER_BATCH = 40; // meters of trail per batch
  const amberPos = AMBER.map((a) => terrain.place(a.s, laneU(a.lane, a.s), a.lift));
  const batchStart: number[] = []; // the first piece of each batch, then one past the last piece
  for (let first = 0; first < AMBER.length; ) {
    batchStart.push(first);
    let end = first;
    while (end < AMBER.length && AMBER[end].s < AMBER[first].s + AMBER_BATCH) end++;
    first = end;
  }
  batchStart.push(AMBER.length);
  const amberMesh = instances(props, 'amber', amberPos.map((position) => ({ position, yaw: 0, scale: 0.19 })), false).children[0] as THREE.InstancedMesh;
  amberMesh.frustumCulled = false;
  const amberGlow = makeGlowField(AMBER.length, '#ffb347', 0.4);
  scene.add(amberMesh, amberGlow);
  const m4 = new THREE.Matrix4();
  const qI = new THREE.Quaternion();
  const v3 = new THREE.Vector3();
  let shownFrom = 0; // pieces shownFrom up to (not including) shownTo are in the list
  let shownTo = 0;
  const flyAt = new THREE.Vector3();
  const putAmber = (i: number) => {
    let size = collected[i] ? 0 : 1;
    let at = amberPos[i];
    if (!collected[i] && fly[i] > 0) {
      // swept toward the runner, quick at first, shrinking as it arrives
      const k = 1 - (1 - fly[i]) ** 2;
      at = flyAt.copy(amberPos[i]).lerp(chest, k);
      size = 1 - 0.55 * k;
    }
    amberMesh.setMatrixAt(i - shownFrom, m4.compose(at, qI, v3.setScalar(0.19 * size)));
    amberGlow.setMatrixAt(i - shownFrom, m4.compose(at, qI, v3.setScalar(0.8 * size)));
    amberMesh.instanceMatrix.needsUpdate = true;
    amberGlow.instanceMatrix.needsUpdate = true;
  };
  const showAmberNear = (s: number, refill = false) => {
    let from = AMBER.length;
    let to = 0;
    for (let k = 0; k < batchStart.length - 1; k++) {
      const first = batchStart[k];
      const end = batchStart[k + 1];
      if (AMBER[end - 1].s > s - 4 && AMBER[first].s < s + 150) {
        from = Math.min(from, first);
        to = Math.max(to, end);
      }
    }
    if (to < from) from = to = 0;
    if (!refill && from === shownFrom && to === shownTo) return;
    shownFrom = from;
    shownTo = to;
    for (let i = from; i < to; i++) putAmber(i);
    amberMesh.count = amberGlow.count = to - from;
    amberMesh.visible = amberGlow.visible = to > from;
  };

  // ---------------------------------------------------------------- hero and egg
  const rig = new HeroRig(heroModel);
  const hero = new THREE.Group();
  hero.add(rig.root);
  scene.add(hero);
  const heroShadow = makeContactShadow(0.95, 1.35, 0.46);
  scene.add(heroShadow);

  const egg = instance(props, 'egg_true', false);
  egg.scale.setScalar(EGG_LEN);
  scene.add(egg);
  materialFor('egg').uniforms.uGlow.value.set('#3fd0c0');
  const eggShadow = makeContactShadow(0.7, 0.52, 0.55);
  scene.add(eggShadow);
  // a soft light round it in the chase, so an egg this size can still be picked out from far behind
  const eggGlow = makeGlow('#5fe0cf', 1.25, 0.26);
  eggGlow.renderOrder = 3;
  scene.add(eggGlow);

  // ---------------------------------------------------------------- the nest, and what the hatching needs
  const nestBasis = basisAt(START_S, 0);
  const nest = makeNest(terrain, props, small, START_S, 0, nestBasis, EGG_LEN);
  scene.add(nest.group);
  /** The opening is shown once; starting again in the same visit goes straight to the chase. */
  let introSeen = false;
  const shell = makeShell(props);
  scene.add(shell.cup, shell.cap);
  let chick: Chick | null = null;
  let chickAsked = false;
  const fetchChick = () => {
    if (chickAsked) return;
    chickAsked = true;
    void loadChick(EGG_LEN).then((c) => {
      chick = c;
      scene.add(c.group);
      hooks.pickStyle(hooks.styleIndex()); // its own materials take the current look
      warm = true;
    });
  };
  /** Set when something new should be made ready to draw now, so its first frame on screen is not a late one. */
  let warm = true;

  // ---------------------------------------------------------------- air: mist and sun shafts that travel with you
  const airAt = new THREE.Vector3();
  // the valley's layers, farthest first: [distance ahead, drop below the eye, width, height, seed]
  const valleyMist = ([[740, -6, 1600, 110, 5], [500, 14, 1100, 80, 4], [330, 22, 800, 60, 3], [215, 24, 520, 44, 2], [130, 22, 300, 30, 1]] as const).map(
    ([r, drop, w, h, seed], k) => {
      mist.set(4 + k, w, h, seed * 13.1);
      return { i: 4 + k, r, drop };
    },
  );
  const mists: { i: number; s: number; u: number; lift: number }[] = [];
  const MIST_GAP = 34;
  for (let i = 0; i < 7; i++) {
    const w = 34 + (i % 3) * 22;
    const h = 7 + (i % 3) * 4;
    mist.set(9 + i, w, h, i * 7.3);
    mists.push({ i: 9 + i, s: 28 + i * MIST_GAP, u: i % 2 ? 7 : -5, lift: 1.5 + h * 0.3 });
  }
  const shaftField = makeShaftField(10);
  shaftField.mesh.renderOrder = 3;
  scene.add(shaftField.mesh);
  const shafts: { s: number; u: number }[] = [];
  const SHAFT_GAP = 11;
  for (let i = 0; i < 10; i++) {
    shaftField.set(i, 33, 1.4 + rnd() * 2.2, rnd() * 50);
    shafts.push({ s: 10 + i * SHAFT_GAP, u: -1.5 + rnd() * 7 });
  }
  const placeAir = () => {
    for (const m of mists) mist.move(m.i, terrain.place(m.s, m.u, m.lift, airAt));
    shafts.forEach((sh, i) => shaftField.move(i, terrain.place(sh.s, sh.u, 0, airAt).addScaledVector(sun, 30)));
  };

  const shadow = new SunShadow(27, 170);
  let shadowsOn = true;
  let shadowAt = -1e9; // where along the trail the shadow map was last drawn

  // ---------------------------------------------------------------- state
  const obstacles = OBSTACLES.map((o) => ({ ...o, hit: false }));
  // where the camera has to duck: under each arch, and all the way through the hollow log
  const archAt = OBSTACLES.filter((o) => slides(o.kind)).map((o) => ({ s: o.s, half: o.kind === 'hollow' ? 1.9 : 0, branch: o.branch ?? 0 }));
  // Obstacles that share a spot on the trail are one decision: a row.
  interface Row {
    /** In the fork, the side this row is on (-1 left, 1 right); 0 everywhere else. */
    branch: number;
    s: number;
    kind: Obstacle['kind'];
    around: boolean;
    blocked: number[];
    /** The lane the egg takes past a tree or a boulder. */
    eggLane: number;
    members: typeof obstacles;
    hit: boolean;
  }
  const rows: Row[] = [];
  for (const o of obstacles) {
    let row = rows.find((r) => r.s === o.s && r.branch === (o.branch ?? 0));
    if (!row) {
      row = { branch: o.branch ?? 0, s: o.s, kind: o.kind, around: goAround(o.kind) && !o.branch, blocked: [], eggLane: 0, members: [], hit: false };
      rows.push(row);
    }
    row.members.push(o);
    for (const lane of o.lanes) if (!row.blocked.includes(lane)) row.blocked.push(lane);
    if (o.kind === 'hollow') row.eggLane = o.lanes[0]; // the egg rolls through it too
  }
  // The island's prow is a row like any other: go round it. Meet it head-on in the middle lane
  // and the runner bumps and steps to the easy side. The egg takes the other one, the richer and
  // riskier side (Drew, build 50: "let's have the egg take the left side").
  const prow: Row | null = FORK
    ? { branch: 0, s: FORK.from + 1.7, kind: 'boulder', around: true, blocked: [0], eggLane: EGG_FORK, members: [{ s: FORK.from + 1.7, kind: 'boulder', lanes: [0], hit: false }], hit: false }
    : null;
  if (prow) rows.push(prow);
  rows.sort((a, b) => a.s - b.s);
  const inFork = (s: number) => FORK !== null && s > FORK.from - 0.5 && s < FORK.to;
  // The rock tapers to nothing over its last few meters, and from behind the runner it looks
  // passed before the runner is level with its tip. So the way back to the middle opens a little
  // before the tip, and a swipe made a second or so early is kept and answered the moment it does.
  const FORK_OPEN = 3;
  const FORK_EARLY = 12;
  const besideRock = (s: number) => FORK !== null && s > FORK.from - 0.5 && s < FORK.to - FORK_OPEN;
  const weave = (s: number) => Math.sin(s * 0.13) * 0.36;
  const openLanes = (row: Row) => [-1, 0, 1].filter((lane) => !row.blocked.includes(lane));
  for (const row of rows) {
    if (!row.around) continue;
    // (where rows stand close together, it needs a lane that is open past all of them)
    const close = rows.filter((r) => r.around && Math.abs(r.s - row.s) < 6.5);
    const clear = [-1, 0, 1].filter((lane) => close.every((r) => !r.blocked.includes(lane)));
    const open = clear.length ? clear : openLanes(row);
    // of two open lanes the egg takes the one without amber, so it never hides the line worth following
    const quiet = open.filter((lane) => !AMBER.some((a) => a.lane === lane && Math.abs(a.s - row.s) < 4));
    const pick = quiet.length ? quiet : open;
    const from = weave(row.s);
    row.eggLane = pick.reduce((best, lane) => (Math.abs(lane * LANE - from) < Math.abs(best * LANE - from) ? lane : best), pick[0] ?? 0);
  }
  if (prow) prow.eggLane = EGG_FORK;
  /** Where the egg is across the trail: weaving between the lanes, so it never sits on a line of
   *  amber, and swinging into an open lane in good time to pass a tree or a boulder. The wild
   *  egg adds quick side-steps, and leaves its swing late and takes it wide. */
  const eggUAt = (s: number, wild = 0): number => {
    let u = weave(s);
    if (wild === 1) u += Math.sin(s * 0.47 + 1.3) * 0.17;
    // (berserk: a wide swing with a sharp zig-zag on top of it, for no reason at all)
    if (wild === 2) u += Math.sin(s * 0.62 + 1.3) * 0.3 + (Math.abs(((s * 0.19) % 2) - 1) - 0.5) * 0.5;
    for (const row of rows) {
      if (row.kind === 'hollow') {
        // lined up with the log's mouth in good time, and out the far end before it wanders again
        if (s < row.s - 10 || s > row.s + 7) continue;
        const k = smoothstep(row.s - 9.5, row.s - 4.2, s) * (1 - smoothstep(row.s + 2.6, row.s + 6.5, s));
        u += (row.eggLane * LANE - u) * k;
        continue;
      }
      if (!row.around || s < row.s - 8 || s > row.s + 6) continue;
      const k = wild
        ? smoothstep(row.s - 5.2, row.s - 1.7, s) * (1 - smoothstep(row.s + 1.5, row.s + 4, s))
        : smoothstep(row.s - 7.5, row.s - 2.5, s) * (1 - smoothstep(row.s + 1.5, row.s + 5.5, s));
      u += (row.eggLane * LANE * (wild === 2 ? 1.22 : wild === 1 ? 1.12 : 1) - u) * k;
    }
    if (FORK) {
      // at the fork it takes its side, down the middle of that lane
      const k = smoothstep(FORK.from - 15, FORK.from - 5, s) * (1 - smoothstep(FORK.to + 2, FORK.to + 10, s));
      u += (laneU(EGG_FORK, s) - u) * k;
    }
    return u;
  };
  /** How far either side of a log, creek, arch or hollow log the egg is hopping or staying down. */
  const lowHalf = (row: Row) => (jumps(row.kind) ? HOP_HALF : row.kind === 'hollow' ? 2.7 : LOW_HALF);
  /** The log or arch the egg is coming up to or passing, if any. It stops bouncing far enough
   *  ahead to be on the ground when it gets there, which is further the faster it is going. */
  const eggRow = (s: number, speed: number): Row | null => {
    const settle = Math.max(SETTLE, speed * 0.8);
    for (const row of rows) {
      if (row.around || row.branch === -EGG_FORK) continue; // (the fork's other side is not the egg's way)
      const half = lowHalf(row);
      if (s > row.s - half - settle && s < row.s + half) return row;
    }
    return null;
  };
  /** True where the trail ahead of the egg is clear for long enough to show off. */
  const eggFree = (s: number): boolean => !inFork(s) && !rows.some((row) => row.s > s - 3 && row.s < s + 17);
  // The power-up: a golden ginkgo leaf in the air. Taking it is "Fan out".
  const leafAt = terrain.place(POWER.s, POWER.lane * LANE, 0.66);
  const leaf = makeLeaf(0.95);
  leaf.position.copy(leafAt);
  leaf.renderOrder = 5;
  const leafGlow = makeGlow('#ffcf5a', 2.1, 0.5);
  leafGlow.position.copy(leafAt);
  const fanGlow = makeGlow('#ffcf6a', 2.2, 0);
  fanGlow.renderOrder = 4;
  scene.add(leaf, leafGlow, fanGlow);
  // Hidden finds: larger pieces with a pale blue glow, off the amber line.
  const findGeo = (props.get('amber') ?? [])[0]?.geometry;
  const finds = FINDS.map((f) => {
    const mat = paintMaterial('amber');
    mat.uniforms.uGemHeart.value.set(0.72, 0.93, 1.0);
    mat.uniforms.uGemEdge.value.set(0.16, 0.5, 0.86);
    const gem = new THREE.Mesh(findGeo, mat);
    gem.scale.setScalar(0.36);
    const at = terrain.place(f.s, laneU(f.lane, f.s), f.lift);
    gem.position.copy(at);
    const glow = makeGlow('#8fd8ff', 1.7, 0.6);
    glow.position.copy(at);
    scene.add(gem, glow);
    return { ...f, gem, glow, at };
  });

  /** Amber on its way to the runner while the fans are out: 0 = not flying, else how far along (0..1). */
  const fly = new Float32Array(AMBER.length);
  const flying: number[] = [];
  const chest = new THREE.Vector3();

  // a puff of dust where the runner bumps something
  const puff = makeGlow('#e6d2a8', 1, 0);
  puff.visible = false;
  puff.renderOrder = 4;
  scene.add(puff);
  const collected: boolean[] = AMBER.map(() => false);
  let baseSpeed = Number(localStorage.getItem('rr-speed2')) || DEFAULT_SPEED;
  // (a new key: the list changed when Wild came in, and everyone should meet Wild first)
  const savedEgg = localStorage.getItem('rr-egg3');
  let eggMode = savedEgg === null ? 1 : THREE.MathUtils.clamp(Number(savedEgg) || 0, 0, 2);
  // the egg's turn, in the trail's own frame (x across to the right, y up, z back up the trail)
  const eggQ = new THREE.Quaternion();
  const eggAxis = new THREE.Vector3();
  const eggSpinQ = new THREE.Quaternion();
  const eggNudge = new THREE.Quaternion();
  const eggLong = new THREE.Vector3();
  const eggSide = new THREE.Vector3();
  const eggBack = new THREE.Vector3(0, 0, 1);
  const st = {
    s: START_S,
    lane: 0,
    u: 0,
    y: 0,
    vy: 0,
    slideT: 0,
    safeT: 0,
    prevLane: 0,
    /** Sideways speed, and the angle the body is turned to its real heading. */
    du: 0,
    heading: 0,
    bump: null as Bump | null,
    /** Time left reeling from a sideways knock, recoiling, shaking the view and showing dust. */
    sideT: 0,
    /** A shoulder against the fork's rock: a wobble, nothing more. */
    nudgeT: 0,
    /** A swipe back to the middle lane, made before the rock was passed and waiting for it. */
    toMiddle: false,
    wadeT: 0,
    flinch: 0,
    shakeT: 0,
    puffT: 0,
    /** The view runs on a little when the runner stops dead, then settles back. */
    camLead: 0,
    /** A swipe made mid-bump, kept for when the runner can act again. */
    pending: null as Move | null,
    pendingT: 0,
    boostT: 0,
    speed: 0,
    phase: 0,
    air: 0,
    slide: 0,
    camU: 0,
    camDuck: 0,
    started: false,
    gap: START_LEAD,
    eggS: START_S + START_LEAD,
    eggY: 0,
    eggVy: 0,
    eggSpin: 0,
    eggKick: 0,
    eggU: 0,
    eggV: 0,
    /** The runner's speed with its stops smoothed out; the egg keeps pace with this. */
    heroV: 0,
    eggHop: false,
    eggPop: 0,
    eggTip: 0,
    /** The wild egg: winding up before a hop, skips owed after one, bounces counted, and what it last did. */
    eggWind: 0,
    eggSkips: 0,
    eggBounces: 0,
    eggJink: -1,
    eggWasLow: false,
    /** The wilder egg: time left spinning on its end like a top. */
    eggTop: 0,
    eggCork: 0,
    /** Fan out: time left, how far the fans are spread, and whether the leaf has been taken. */
    fanOn: false,
    /** Hidden finds picked up, and the seconds since the egg was lost (0 while it is still in reach). */
    found: FINDS.map(() => false),
    lostT: 0,
    /** How fast time runs: 1, or less for a moment of slow motion. */
    slow: 1,
    /** Where the egg came down off the nest's rim. */
    rollS: 0,
    rollU: 0,
    /** The opening: seconds since "Run!", or -1 once the chase has the whole screen. */
    introT: -1,
    /** How far the runner is settled on folded legs, where its head is turned, and how far its beak is open. */
    sit: 0,
    lookYaw: 0,
    lookPitch: 0,
    beak: 0,
    /** The ending: 0 the chase, 1 in the clearing waiting for the scoop, 2 settling round the egg, 3 hatching, 4 the journal card, 5 results. */
    end: 0,
    endT: 0,
    scoop: false,
    /** Seconds since the egg's dash for the edge began, how long the dive takes, and when (on the scene clock) the egg was caught. */
    dashT: 0,
    diveT: 0.3,
    caughtAt: 0,
    /** Extra turn of the body, for facing back up the trail with the egg. */
    turn: 0,
    fromS: 0,
    fromU: 0,
    /** A clock that runs whenever the game is not paused, for the life in the scenes. */
    sceneT: 0,
    fan: 0,
    leafTaken: false,
    amber: 0,
    paused: false,
    finished: false,
    queued: null as Move | null,
    queuedT: 0,
    hint: 0,
    hintT: 0,
    clock: 0,
    frame: 0,
  };
  const heroState: HeroState = { phase: 0, speed: 0, run: 1, air: 0, airTilt: 0, slide: 0, lean: 0 };

  const hud = makeHud(ui, {
    styles: hooks.styles,
    styleIndex: hooks.styleIndex(),
    speed: baseSpeed,
    quality: hooks.quality,
    speedNow: hooks.speedNow,
    eggModes: EGG_MODES,
    eggMode,
    onEgg: (mode) => {
      eggMode = mode;
      try {
        localStorage.setItem('rr-egg3', String(mode));
      } catch {
        /* private mode */
      }
    },
    soundOn: sound.on,
    onSound: (on) => sound.setOn(on),
    // (a miss at the edge is tried again from a little way back; losing the egg on the way down starts the level over)
    onRetry: () => (st.end === END.miss ? tryAgain(RETRY_S) : LOST_RESTART === 'checkpoint' ? tryAgain() : reset()),
    onJournalNext: () => {
      if (st.end !== END.card) return;
      st.end = END.results;
      hud.hideJournal();
      hud.clean(false);
      hud.showFinish(st.amber, AMBER.length, st.found.filter(Boolean).length, FINDS.length);
    },
    onStart: () => {
      st.started = true;
    },
    onPause: () => setPaused(true),
    onResume: () => setPaused(false),
    onRestart: () => reset(),
    onStyle: (i) => {
      hooks.pickStyle(i);
      hud.setStyle(i);
    },
    onSpeed: (v) => {
      baseSpeed = v;
      try {
        localStorage.setItem('rr-speed2', String(v));
      } catch {
        /* private mode */
      }
    },
  });

  function setPaused(p: boolean) {
    if (st.finished || !st.started || st.lostT > 0) return;
    st.paused = p;
    hud.setPaused(p);
    sound.setPaused(p);
  }

  /** Put every single thing back to the start. */
  function reset() {
    const opening = playIntro && !introSeen;
    Object.assign(st, {
      s: START_S, lane: 0, u: 0, y: 0, vy: 0, slideT: 0, safeT: 0, speed: 0, phase: 0, air: 0,
      slide: 0, camU: 0, camDuck: 0, gap: START_LEAD, eggS: START_S + START_LEAD, eggY: 0, eggVy: 0, eggSpin: 0, eggKick: 0, amber: 0, paused: false,
      finished: false, queued: null, queuedT: 0, hint: 0, hintT: 0,
      prevLane: 0, du: 0, heading: 0, bump: null, sideT: 0, wadeT: 0, flinch: 0, shakeT: 0, puffT: 0, camLead: 0, pending: null,
      pendingT: 0, boostT: 0, eggU: 0, eggV: 0, heroV: 0, eggHop: false, eggPop: 0, eggTip: 0,
      eggWind: 0, eggSkips: 0, eggBounces: 0, eggJink: -1, eggWasLow: false, eggTop: 0, eggCork: 0, fanOn: false, fan: 0, leafTaken: false, lostT: 0,
      slow: 1,
      introT: opening ? 0 : -1, sit: opening ? 1 : 0, lookYaw: 0, lookPitch: 0, beak: 0,
      end: 0, endT: 0, scoop: false, dashT: 0, turn: 0,
    });
    hud.hideLost();
    hud.hideJournal();
    hud.skip(false);
    hud.clean(opening);
    sound.setMode(opening ? 'quiet' : 'chase');
    egg.visible = true;
    shell.cup.visible = shell.cap.visible = false;
    if (chick) chick.group.visible = false;
    fly.fill(0);
    flying.length = 0;
    st.found = FINDS.map(() => false);
    for (const f of finds) f.gem.visible = f.glow.visible = true;
    for (const c of crossings) c.fled = 0;
    hud.setFinds(st.found);
    hud.fork(false);
    hud.fade(false);
    leaf.visible = leafGlow.visible = true;
    eggQ.setFromAxisAngle(v3.set(1, 0, 0), -0.5); // tipped a little forward, about to roll
    for (const o of obstacles) o.hit = false;
    for (const row of rows) row.hit = false;
    collected.fill(false);
    showAmberNear(START_S, true);
    shadowAt = -1e9;
    for (let i = 0; i < mists.length; i++) mists[i].s = 28 + i * MIST_GAP;
    for (let i = 0; i < shafts.length; i++) shafts[i].s = 10 + i * SHAFT_GAP;
    placeAir();
    materialFor('egg').uniforms.uCrack.value = opening ? 0 : 0.5;
    materialFor('egg').uniforms.uEggNear.value = opening ? 1 : 0;
    hud.setAmber(0);
    hud.hint(null);
    hud.warn(false);
    hud.setPaused(false);
    hud.hideFinish();
  }

  /** Back to the last checkpoint passed, with the egg a fair way ahead again. What was collected is kept. (Not in use: see LOST_RESTART.) */
  function tryAgain(at?: number) {
    const from = at ?? CHECKPOINTS.filter((c) => c <= st.s).pop() ?? START_S;
    hud.hideLost();
    Object.assign(st, {
      s: from, lane: 0, u: 0, y: 0, vy: 0, slideT: 0, safeT: 1, speed: 0, air: 0, slide: 0, camU: 0, camDuck: 0,
      gap: START_LEAD, eggS: from + START_LEAD, eggY: 0, eggVy: 0, eggV: 0, heroV: 0, queued: null, queuedT: 0,
      prevLane: 0, du: 0, heading: 0, bump: null, sideT: 0, wadeT: 0, flinch: 0, shakeT: 0, puffT: 0, camLead: 0,
      pending: null, pendingT: 0, boostT: 0, eggHop: false, eggTop: 0, eggSkips: 0, eggWasLow: false, lostT: 0,
      end: 0, endT: 0, scoop: false, dashT: 0, turn: 0, slow: 1, finished: false, sit: 0,
    });
    egg.visible = true;
    hud.clean(false);
    sound.setMode('chase');
    for (const o of obstacles) o.hit = false;
    for (const row of rows) row.hit = false;
    for (const c of crossings) c.fled = 0;
    st.fanOn = false;
    st.fan = 0;
    if (from <= POWER.s) {
      // the leaf is ahead again, so it can be taken again
      st.leafTaken = false;
      leaf.visible = leafGlow.visible = true;
    }
    shadowAt = -1e9;
    for (let i = 0; i < mists.length; i++) mists[i].s = from + 25 + i * MIST_GAP;
    for (let i = 0; i < shafts.length; i++) shafts[i].s = from + 7 + i * SHAFT_GAP;
    placeAir();
    hud.warn(false);
    hud.fade(false);
    hud.hint('Try again from here!');
    st.hintT = 2.2;
  }

  function act(move: Move) {
    if (st.paused || st.finished || !st.started || st.lostT > 0) return;
    if (st.introT >= 0 && st.introT < INTRO.go) return; // the opening is still playing
    if (st.end === END.dash) {
      // the egg is making for the edge: a swipe up is the dive, and nothing else matters now
      if (move === 'up') st.scoop = true;
      if (move === 'up' || move === 'down') return;
    }
    if (st.bump) {
      // mid-bump the runner can't answer, but the swipe is kept for the moment it can
      st.pending = move;
      st.pendingT = 0.6;
      return;
    }
    if (move === 'left' || move === 'right') {
      const to = THREE.MathUtils.clamp(st.lane + (move === 'left' ? -1 : 1), -1, 1);
      if (to === 0 && besideRock(st.s)) {
        // the rock is in the way. Near its end the swipe is kept for when the way opens; before
        // that it is a shoulder against the rock, which no longer costs any speed (slowing here
        // made the music, which follows the runner, stumble).
        if (FORK && st.s > FORK.to - FORK_EARLY) st.toMiddle = true;
        else st.nudgeT = 0.25;
        return;
      }
      st.toMiddle = false;
      if (to !== st.lane) {
        st.prevLane = st.lane;
        st.lane = to;
        sound.step_();
      }
    } else if (move === 'up') {
      if (st.y <= 0.001) {
        st.vy = JUMP_V;
        st.y = 0.001;
        st.slideT = 0;
        sound.jump();
      } else {
        st.queued = 'up'; // jump again the moment we land
        st.queuedT = 0.14;
      }
    } else if (move === 'down') {
      if (st.y > 0.001) {
        st.vy = Math.min(st.vy, -9); // drop fast, then slide on landing
        st.queued = 'down';
        st.queuedT = 0.5;
      } else {
        st.slideT = SLIDE_TIME;
        sound.slide();
      }
    }
  }
  listenForMoves(stage, act);

  /** Straight to the chase: the runner up and off, the egg its full lead ahead. */
  function skipIntro() {
    if (st.introT < 0) return;
    st.introT = -1;
    introSeen = true;
    st.sit = 0;
    sound.setMode('chase');
    materialFor('egg').uniforms.uEggNear.value = 0;
    st.eggS = st.s + START_LEAD;
    st.gap = START_LEAD;
    st.eggV = st.speed;
    st.eggY = 0;
    st.eggVy = 0;
    eggQ.setFromAxisAngle(v3.set(1, 0, 0), -0.5);
    materialFor('egg').uniforms.uCrack.value = 0.5;
    hud.skip(false);
    hud.clean(false);
  }
  stage.addEventListener('pointerdown', () => {
    if (st.started && !st.paused && st.introT > 0.35 && st.introT < INTRO.go) skipIntro();
  });

  // ---------------------------------------------------------------- the ending
  const restQ = new THREE.Quaternion(); // the egg as it was caught
  const cradleQ = new THREE.Quaternion(); // and standing on its narrow end, leaning toward the parent
  const camPos = new THREE.Vector3(); // the ending's camera, eased toward where each moment wants it
  const camLook = new THREE.Vector3();
  let camFov = 62;
  let restLift = 0;
  let restU = 0;
  /** Where the egg stands for the hatching. */
  const cradle = { s: END_S, u: 0 };
  /** The way the last of the trail points, level: what goes over the edge leaves along it. */
  const lipFwd = track.sample(END_S - 0.5).tan.clone().setY(0).normalize();
  const missFrom = new THREE.Vector3();
  const missQ = new THREE.Quaternion();
  let missV = 0;
  let diveEggS = 0;

  /** One more kick from inside, and the egg is off for the edge. */
  function startDash() {
    st.end = END.dash;
    st.dashT = 0;
    st.scoop = false;
    st.eggY = 0.001;
    st.eggVy = Math.sqrt(2 * EGG_G * 0.3);
    st.eggKick = 2.2;
    st.eggPop = 1;
    hud.hint('Swipe up!');
    st.hintT = 1e9;
    sound.setMode('dash');
  }

  /** The egg's dash, at its own pace, the last of it in slow motion. */
  function dashEgg(dt: number) {
    st.dashT += dt;
    st.eggV = FINALE.v0 + FINALE.a * st.dashT;
    st.eggS += st.eggV * dt;
    rollEgg(dt, true);
    st.slow = THREE.MathUtils.lerp(1, FINALE.slow, smoothstep(END_S - FINALE.slowFrom - 1.2, END_S - FINALE.slowFrom, st.eggS));
  }

  /** The dive, timed so the runner comes down on the egg just as it reaches the last of the ground. */
  function startDive() {
    const left = Math.max(CATCH_S - st.eggS, 0);
    const v = st.eggV;
    st.diveT = Math.max(0.16, (-v + Math.sqrt(v * v + 2 * FINALE.a * left)) / FINALE.a);
    st.end = END.dive;
    st.endT = 0;
    st.fromS = st.s;
    st.fromU = st.u;
    diveEggS = st.eggS;
    // (the dive plays out in slow motion, so it lasts longer by the clock than by the game's own time)
    sound.leap(st.diveT / FINALE.slow);
    st.fanOn = false;
    st.slideT = 0;
    camPos.copy(camera.position);
    camLook.copy(look);
    camFov = camera.fov;
    hud.hint(null);
    hud.warn(false);
    hud.clean(true);
  }

  /** Too late: the egg goes over. */
  function startMiss() {
    st.end = END.miss;
    st.endT = 0;
    st.slow = 1;
    missFrom.copy(egg.position);
    missQ.copy(egg.quaternion);
    missV = st.eggV;
    sound.lost();
    camPos.copy(camera.position);
    camLook.copy(look);
    camFov = camera.fov;
    hud.hint(null);
    hud.warn(false);
  }

  function stepEnding(dt: number) {
    const before = st.endT;
    st.endT += dt;
    const t = st.endT;
    const L = THREE.MathUtils.lerp;
    const ease = 1 - Math.exp(-dt / 0.06);
    st.heading *= Math.exp(-dt / 0.15);
    st.flinch *= Math.exp(-dt / 0.12);
    if (st.end === END.dive) {
      const e = Math.min(1, t / st.diveT);
      // the egg comes on to where it will be caught, and the runner comes down on it there
      st.eggS = L(diveEggS, CATCH_S, e);
      st.eggY *= Math.max(0, 1 - dt * 9);
      rollEgg(dt, true);
      const k = 1 - (1 - e) * (1 - e);
      st.s = L(st.fromS, CATCH_S - CATCH_HOLD, k);
      st.u = L(st.fromU, st.eggU, k);
      st.lane = Math.round(st.u / LANE);
      st.y = 0.36 * 4 * e * (1 - e) * Math.min(1, st.diveT / 0.3);
      st.vy = JUMP_V * (1 - 2 * e);
      st.air += ((e < 0.55 ? 1 : 0) - st.air) * ease;
      st.slide += ((e > 0.4 ? 1 : 0) - st.slide) * ease;
      st.fan += (1 - st.fan) * ease;
      st.speed = (CATCH_S - CATCH_HOLD - st.fromS) / st.diveT;
      st.phase += dt * 1.2;
      st.slow = FINALE.slow;
      if (e >= 1) {
        st.end = END.caught;
        st.endT = 0;
        st.finished = true;
        st.caughtAt = st.sceneT;
        st.eggS = CATCH_S;
        st.eggV = st.eggY = st.eggVy = 0;
        st.y = st.speed = 0;
        st.shakeT = 0.3;
        st.puffT = 0.34;
        puff.position.copy(terrain.place(CATCH_S - 0.2, st.u, 0.2));
        sound.caught();
      }
    } else if (st.end === END.caught) {
      // held, at the very edge: a breath in slow motion, and then time runs again
      const real = st.sceneT - st.caughtAt;
      st.slow = L(0.3, 1, smoothstep(0.35, 0.9, real));
      st.slide += (1 - st.slide) * ease;
      st.air *= 1 - ease;
      st.fan += (1 - st.fan) * ease;
      rollEgg(dt, false);
      if (real > 1.3) {
        st.end = END.turn;
        st.endT = 0;
        st.slow = 1;
        st.fromS = st.s;
        st.fromU = st.u;
        restQ.copy(egg.quaternion);
        restU = st.eggU;
        restLift = egg.position.y - terrain.place(st.eggS, restU, 0, v3).y;
        cradleQ.copy(basisAt(END_S - SETTLE_BACK, 0)).multiply(new THREE.Quaternion().setFromUnitVectors(upAxis, new THREE.Vector3(0.05, 1, -0.3).normalize()));
        fetchChick();
      }
    } else if (st.end === END.turn) {
      // up, round with the egg held to its breast, back from the edge, and down beside it
      const e = Math.min(1, t / TURN_TIME);
      const k = smoother(0, 1, e);
      st.turn = -Math.PI * k;
      st.s = L(st.fromS, END_S - SETTLE_BACK, k);
      st.u = st.fromU;
      // (gathered in from where it was pinned to where it is carried, against the breast)
      const hold = L(CATCH_HOLD, HOLD, smoothstep(0, 0.35, e));
      cradle.s = st.s + hold * Math.cos(st.turn);
      cradle.u = st.u - hold * Math.sin(st.turn);
      st.slide += ((e < 0.12 ? 1 : 0) - st.slide) * ease;
      st.fan += ((e < 0.75 ? 0.55 : 0) - st.fan) * ease;
      st.sit = smoothstep(TURN_TIME * 0.75, TURN_TIME * 1.3, t);
      if (e < 0.95) st.phase += dt * 1.5;
      if (t > TURN_TIME + 0.7) {
        st.end = END.hatch;
        st.endT = 0;
      }
    } else if (st.end === END.hatch) {
      // the chick has to be here before the top can come off
      if (!chick && st.endT > HATCH.pop - 0.05) st.endT = HATCH.pop - 0.05;
      HATCH.taps.forEach((tap, i) => {
        if (before < tap && st.endT >= tap) sound.tap(i / 2);
      });
      if (before < HATCH.pop && st.endT >= HATCH.pop) sound.crack();
      for (const at of [HATCH.pop + 1.0, HATCH.pop + 2.2]) if (before < at && st.endT >= at) sound.peep();
      let crack = 0.5;
      for (const tap of HATCH.taps) crack += (0.5 / HATCH.taps.length) * smoothstep(tap, tap + 0.2, st.endT);
      materialFor('egg').uniforms.uCrack.value = crack;
      if (st.endT > HATCH.card) {
        st.end = END.card;
        hud.showJournal();
      }
    } else if (st.end === END.miss) {
      // the runner pulls up at the edge with nothing in its arms, and looks after the egg
      st.speed += (0 - st.speed) * Math.min(1, dt * 7);
      st.s = Math.min(END_S - 0.75, st.s + st.speed * dt);
      st.phase += (st.speed * dt) / strideLength(Math.max(st.speed, 1));
      st.fan *= 1 - ease;
      st.air *= 1 - ease;
      st.slide *= 1 - ease;
      if (before < 0.15 && t >= 0.15) st.flinch = 0.7;
      if (before < 1.2 && t >= 1.2) hud.fade(true);
      if (before < 2.1 && t >= 2.1) hud.showLost('Swipe up a little sooner to catch it.');
    }
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'p') setPaused(!st.paused);
  });
  // leaving the app pauses the run (the only pause besides the pause button)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !st.finished && !testing) setPaused(true);
  });
  // never reload for an update in the middle of a run
  setReloadGuard(() => st.paused || st.finished || st.s < START_S + 2);

  /**
   * The egg always turns forward, top first down the trail. In the wobbly modes the axis it
   * turns about swings with its path and tips up and down, so it tumbles at changing angles.
   * In the lively mode each bounce depends on how it lands: down on an end, it kicks up high
   * and spins faster; flat on its side, it skips low. No physics engine: a few lines of rules.
   */
  function rollEgg(dt: number, rolling: boolean) {
    const lively = true;
    const wild = eggMode >= 1;
    const wilder = eggMode === 2;
    // lean the axis the way the egg is drifting across the trail, and tip it slowly up and down
    eggAxis.set(-1, 0.32 * Math.sin(st.eggS * 0.137 + 0.4), -0.45 * Math.cos(st.eggS * 0.13)).normalize();
    const topping = st.eggTop > 0 && rolling;
    // (berserk's corkscrew: turning about the upright as well, while it is in the air)
    if (st.eggCork > 0 && st.eggY > 0.15) eggQ.premultiply(eggSpinQ.setFromAxisAngle(eggSide.set(0, 1, 0), dt * 15)).normalize();
    const wanted = rolling && !topping ? st.eggV * 1.5 * (1 + st.eggKick) : 0;
    st.eggSpin += (wanted - st.eggSpin) * Math.min(1, dt * (rolling ? 8 : 3));
    st.eggKick = Math.max(0, st.eggKick - dt * 1.6);
    st.eggPop = Math.max(0, st.eggPop - dt * 5);
    eggQ.premultiply(eggSpinQ.setFromAxisAngle(eggAxis, st.eggSpin * dt)).normalize();
    if (topping) {
      // up on its end and spinning like a top, until it tips back into its tumble
      st.eggTop -= dt;
      eggLong.set(0, 1, 0).applyQuaternion(eggQ);
      eggSide.set(0, eggLong.y >= 0 ? 1 : -1, 0);
      eggSpinQ.setFromUnitVectors(eggLong, eggSide);
      eggQ.premultiply(eggNudge.identity().slerp(eggSpinQ, Math.min(1, dt * 10)));
      eggQ.premultiply(eggSpinQ.setFromAxisAngle(eggSide.set(0, 1, 0), dt * 24)).normalize();
    }

    // what is coming: a log to hop, or an arch to stay down for
    const row = rolling ? eggRow(st.eggS, st.eggV) : null;
    const d = row ? st.eggS - row.s : 0;
    const hop = row !== null && jumps(row.kind) && Math.abs(d) < HOP_HALF;
    const low = row !== null && slides(row.kind) && Math.abs(d) < lowHalf(row);
    const settle = row !== null && !hop && !low;
    // the wild egg shivers for a moment before the chick kicks
    st.eggWind = wild && row !== null && jumps(row.kind) && !hop && d < 0 ? smoothstep(-HOP_HALF - 2.4, -HOP_HALF - 0.3, d) : 0;

    if (row) st.eggTop = 0;
    if (row && slides(row.kind)) {
      // Under an arch it rolls like a barrel, long way across the trail, so it passes with room
      // to spare. Its long axis is eased round to lie across the trail on the way in.
      eggLong.set(0, 1, 0).applyQuaternion(eggQ);
      eggSide.set(eggLong.x >= 0 ? 1 : -1, 0, 0);
      eggSpinQ.setFromUnitVectors(eggLong, eggSide);
      eggQ.premultiply(eggNudge.identity().slerp(eggSpinQ, Math.min(1, dt * 5))).normalize();
      st.eggTip = 1.1; // once through, it is tipped back into its tumble
      if (wild && low) st.eggKick = Math.max(st.eggKick, 0.9); // and the wild one spins up as it goes under
    } else if (st.eggTip > 0) {
      const turn = Math.min(st.eggTip, dt * 4.5);
      st.eggTip -= turn;
      eggQ.premultiply(eggSpinQ.setFromAxisAngle(eggBack, turn)).normalize();
    }
    if (wild && st.eggWasLow && !low && rolling && eggRow(st.eggS, st.eggV) === null) {
      // out from under the arch with a pop
      st.eggY = 0.001;
      st.eggVy = Math.sqrt(2 * EGG_G * (wilder ? 0.85 : 0.5));
      st.eggKick = wilder ? 1.8 : 1.1;
      st.eggPop = 0.8;
    }
    st.eggWasLow = low;

    if (hop) {
      if (!st.eggHop) {
        // the chick kicks, and the egg jumps
        st.eggHop = true;
        st.eggKick = wilder ? 3.8 : wild ? 2.6 : 1.3;
        st.eggCork = wilder ? 1 : 0;
        st.eggPop = 1;
        st.eggSkips = wilder ? 3 : wild ? 2 : 0;
      }
      const top = wilder ? HOP_HEIGHT_WILDER : wild ? HOP_HEIGHT_WILD : HOP_HEIGHT;
      st.eggY = Math.max(st.eggY * 0.5, top * (1 - (d / HOP_HALF) ** 2));
      st.eggVy = 0;
      return;
    }
    if (st.eggHop) {
      // down from the hop: a skip, then back to its own bouncing
      st.eggHop = false;
      st.eggCork = 0;
      st.eggY = 0;
      st.eggVy = Math.sqrt(2 * EGG_G * 0.1);
    }
    if (wild && rolling && st.eggY <= 0.02) {
      // a little hop into each swerve round a tree or a boulder
      for (const r of rows) {
        if (!r.around || r === prow || st.eggJink === r.s || st.eggS < r.s - 5 || st.eggS > r.s - 3.4) continue;
        st.eggJink = r.s;
        st.eggY = 0.001;
        st.eggVy = Math.sqrt(2 * EGG_G * (wilder ? 0.6 : 0.3));
        st.eggKick = wilder ? 2.8 : 1.0;
        st.eggCork = wilder ? 1 : 0;
        st.eggPop = 0.6;
      }
    }
    if (!rolling && st.eggY <= 0) return;
    if (topping) {
      // a top stays down
      st.eggY = Math.max(0, st.eggY + Math.min(st.eggVy, 0) * dt);
      st.eggVy -= EGG_G * dt;
      if (st.eggY <= 0) st.eggVy = 0;
      return;
    }
    st.eggVy -= (low ? 40 : EGG_G) * dt;
    st.eggY += st.eggVy * dt;
    if (st.eggY <= 0) {
      st.eggY = 0;
      st.eggVy = 0;
      if (rolling && !settle && !low && !(st.introT >= 0 && st.introT < INTRO.bounce) && st.end !== END.dive) {
        // how upright the egg is as it lands: 1 on an end, 0 flat on its side
        const onEnd = Math.abs(eggLong.set(0, 1, 0).applyQuaternion(eggQ).y);
        let height = lively ? 0.1 + 0.32 * onEnd * onEnd : 0.2;
        if (lively) st.eggKick = 0.5 * onEnd * onEnd;
        if (wild) {
          st.eggBounces++;
          if (st.eggSkips > 0) {
            // quick skips coming down from a hop, each lower than the last
            height = [0.2, 0.2, 0.42, 0.5][Math.min(3, st.eggSkips)];
            st.eggSkips--;
            st.eggPop = 0.5;
          } else if (wilder && eggFree(st.eggS)) {
            // berserk: where there is room, something every time it lands
            const trick = st.eggBounces % 4;
            if (trick === 0) {
              // a high flip
              height = 1.05;
              st.eggKick = 3.2;
              st.eggPop = 0.8;
            } else if (trick === 1) {
              // down on its end, spinning like a top
              st.eggTop = 0.85;
              height = 0.14;
            } else if (trick === 2) {
              // a run of quick skips
              height = 0.5;
              st.eggSkips = 2;
              st.eggKick = 1.6;
              st.eggPop = 0.5;
            } else {
              // and the big one: sky high, flipping end over end and turning like a corkscrew
              height = 1.5;
              st.eggKick = 4.6;
              st.eggPop = 1;
              st.eggCork = 1;
            }
          } else if (!wilder && st.eggBounces % 3 === 0 && eggFree(st.eggS)) {
            // every so often, where there is room, a big bounce with a flip
            height = 0.66;
            st.eggKick = 1.3;
            st.eggPop = 0.7;
          }
          if (height < 1.2) st.eggCork = 0;
        }
        st.eggVy = Math.sqrt(2 * EGG_G * height);
      }
    }
  }

  /** The runner has walked into something. It stops where its body meets it, then gets past. */
  function startBump(row: Row, member: (typeof obstacles)[number]) {
    sound.bump();
    row.hit = true;
    for (const o of row.members) o.hit = true;
    let toLane = st.lane;
    if (row.around && row.blocked.includes(st.lane)) {
      // step round to the nearest open lane; with one on each side, the one the egg took
      const open = openLanes(row);
      const near = Math.min(...open.map((lane) => Math.abs(lane - st.lane)));
      const nearest = open.filter((lane) => Math.abs(lane - st.lane) === near);
      // (but off the island's prow, always to the easy side)
      const side = row === prow ? EASY_SIDE : row.eggLane;
      toLane = nearest.includes(side) ? side : (nearest[0] ?? st.lane);
    }
    (puff.material as THREE.ShaderMaterial).uniforms.uColor.value.set('#e6d2a8');
    st.bump = {
      kind: jumps(row.kind) ? 'log' : row.kind === 'arch' ? 'arch' : row.kind === 'hollow' ? 'hollow' : 'around',
      t: 0,
      faceS: Math.min(st.s, member.s - FACE[member.kind]),
      exitS: member.s + CLEAR[member.kind],
      u0: st.u,
      toLane,
    };
    st.camLead = 0.4 * Math.min(1, st.speed / 8);
    st.shakeT = 0.3;
    st.puffT = 0.34;
    terrain.place(member.s - DEPTH[member.kind], st.u, slides(row.kind) ? 0.62 : 0.3, puff.position);
    st.gap = Math.min(MAX_LEAD, st.gap + BUMP_COST);
    st.vy = 0;
    st.queued = null;
    st.slideT = 0;
  }

  /** Missed the jump over a creek: nothing to bump, so it is a splash and a slow wade out. */
  function wade(row: Row) {
    sound.splash();
    row.hit = true;
    for (const o of row.members) o.hit = true;
    st.wadeT = 0.75;
    st.safeT = 0.4;
    st.shakeT = 0.18;
    st.puffT = 0.34;
    (puff.material as THREE.ShaderMaterial).uniforms.uColor.value.set('#d6f2fb');
    terrain.place(row.s, st.u, 0.25, puff.position);
    st.gap = Math.min(MAX_LEAD, st.gap + BUMP_COST);
  }

  /** A sideways knock: the runner swiped into something beside it and bounces back to its lane. */
  function sideBump(row: Row, member: (typeof obstacles)[number]) {
    sound.bump();
    row.hit = true;
    for (const o of row.members) o.hit = true;
    (puff.material as THREE.ShaderMaterial).uniforms.uColor.value.set('#e6d2a8');
    const blockedLane = st.lane;
    st.lane = st.prevLane;
    st.sideT = 0.55;
    st.safeT = 0.5;
    st.shakeT = 0.22;
    st.puffT = 0.3;
    terrain.place(member.s, (st.u + blockedLane * LANE) / 2, 0.35, puff.position);
    st.gap = Math.min(MAX_LEAD, st.gap + BUMP_COST);
  }

  function stepBump(dt: number) {
    const b = st.bump as Bump;
    b.t += dt;
    const before = st.s;
    if (b.t < IMPACT_TIME) {
      // thrown back to where its body meets the obstacle
      st.s += (b.faceS - st.s) * (1 - Math.exp(-dt / 0.035));
      st.y = Math.max(0, st.y - dt * 5);
      st.flinch = 1;
      st.speed = 0;
      return;
    }
    const f = Math.min(1, (b.t - IMPACT_TIME) / (b.kind === 'hollow' ? RECOVER_TIME * 1.7 : RECOVER_TIME));
    st.flinch = Math.max(0, 1 - f * 3.2);
    // slow off the mark, moving well by the end
    st.s = b.faceS + (b.exitS - b.faceS) * Math.pow(f, 1.6);
    if (b.kind === 'log') {
      // scrambles over
      st.y = 0.52 * Math.sin(Math.PI * f);
      st.vy = Math.cos(Math.PI * f) * JUMP_V * 0.5;
    } else if (b.kind === 'arch' || b.kind === 'hollow') {
      // ducks under (or through), and stands once it is out the other side
      st.slideT = f < (b.kind === 'hollow' ? 0.93 : 0.82) ? 0.1 : 0;
    } else {
      // steps round
      st.lane = b.toLane;
      st.u = b.u0 + (laneU(b.toLane, st.s) - b.u0) * smoothstep(0, 0.62, f);
    }
    st.speed = dt > 0 ? Math.max(0, (st.s - before) / dt) : 0;
    if (f >= 1) {
      st.bump = null;
      st.y = 0;
      st.vy = 0;
      st.flinch = 0;
      st.safeT = 0.3;
      st.boostT = 1.0;
      st.prevLane = st.lane;
      if (st.pending && st.pendingT > 0) {
        const move = st.pending;
        st.pending = null;
        act(move);
      }
    }
  }

  function step(dt: number) {
    st.clock += dt;
    if (st.end >= END.dive) return stepEnding(dt);
    if (st.introT >= 0) {
      const before = st.introT;
      st.introT += dt;
      INTRO.taps.forEach((tap, i) => {
        if (before < tap && st.introT >= tap) sound.tap(i / 2);
      });
      if (before < INTRO.roll && st.introT >= INTRO.roll) sound.roll();
      if (before < INTRO.run && st.introT >= INTRO.run) sound.setMode('chase');
      const eggMat = materialFor('egg').uniforms;
      // the cracks spread with each tap from inside
      let crack = 0;
      for (const tap of INTRO.taps) crack += (0.5 / INTRO.taps.length) * smoothstep(tap, tap + 0.2, st.introT);
      eggMat.uCrack.value = crack;
      st.sit = 1 - smoothstep(INTRO.stand, INTRO.stand + 0.6, st.introT);
      if (before < INTRO.teeter + 0.55 && st.introT >= INTRO.teeter + 0.55) st.flinch = 0.5;
      if (before < INTRO.roll && st.introT >= INTRO.roll) {
        // down on the slope and rolling: from here it is the chase's egg, turning as it was when it came down
        st.eggS = st.rollS = nestEgg.s;
        st.rollU = nestEgg.u;
        st.eggV = 0.6;
        st.eggY = 0;
        st.eggVy = 0;
        st.eggSpin = 5.5;
        st.eggKick = 2.5;
        eggQ.copy(basisAt(st.eggS)).invert().multiply(egg.quaternion);
      }
      // (its speckles are drawn fine while it is close, and bold once it is away down the trail)
      eggMat.uEggNear.value = 1 - smoothstep(INTRO.roll, INTRO.roll + 1.6, st.introT);
      hud.skip(st.introT > 0.35 && st.introT < INTRO.go);
      hud.clean(st.introT >= 0 && st.introT < INTRO.go);
      if (st.introT >= INTRO.end) {
        st.introT = -1;
        introSeen = true;
        st.sit = 0;
      }
    }
    const onNest = st.introT >= 0 && st.introT < INTRO.run;
    // on the last shelf the runner comes up behind the egg, and keeps behind it until it dives
    let pace = baseSpeed;
    if (st.end === END.shelf || st.end === END.dash) {
      const most = st.end === END.dash ? Math.max(st.eggV, baseSpeed * 0.6) : baseSpeed;
      pace = THREE.MathUtils.clamp(st.eggV + (st.eggS - st.s - 2.2) * 4, 0, Math.min(most, baseSpeed * 1.3));
    }
    const cruise = st.finished || st.lostT > 0 || onNest ? 0 : pace;
    const uBefore = st.u;
    const sBefore = st.s;
    if (st.bump) {
      stepBump(dt);
    } else {
      const target = cruise * (st.wadeT > 0 ? 0.42 : st.sideT > 0 ? 0.6 : 1);
      // back up to speed briskly after a bump, so a bump costs about the same whatever was hit
      const pickup = st.boostT > 0 ? 5 : 2.2;
      st.speed += (target - st.speed) * Math.min(1, dt * (st.speed < target ? pickup : 6));
      st.s += st.speed * dt;
      if (st.end === END.shelf || st.end === END.dash) st.s = Math.min(st.s, st.eggS - 1.6, END_S - 1);
      // side to side
      st.u += (laneU(st.lane, st.s) - st.u) * (1 - Math.exp(-dt / 0.055));
    }
    st.phase += (st.speed * dt) / strideLength(st.speed);
    st.safeT = Math.max(0, st.safeT - dt);
    st.sideT = Math.max(0, st.sideT - dt);
    st.nudgeT = Math.max(0, st.nudgeT - dt);
    if (st.toMiddle && FORK) {
      if (!besideRock(st.s) && !st.bump && st.s < FORK.to + 6) {
        if (st.lane !== 0) {
          st.prevLane = st.lane;
          st.lane = 0;
          sound.step_();
        }
        st.toMiddle = false;
      } else if (st.s >= FORK.to + 6 || st.s < FORK.from) st.toMiddle = false;
    }
    st.wadeT = Math.max(0, st.wadeT - dt);
    st.shakeT = Math.max(0, st.shakeT - dt);
    st.puffT = Math.max(0, st.puffT - dt);
    st.boostT = Math.max(0, st.boostT - dt);
    st.pendingT = Math.max(0, st.pendingT - dt);
    st.camLead *= Math.exp(-dt / 0.14);
    // The body turns toward the lane it is making for. The move itself is over in a blink, so
    // the turn snaps in and then straightens slowly: that is what makes it something you see.
    st.du = dt > 0 ? (st.u - uBefore) / dt : 0;
    const toGo = (laneU(st.lane, st.s) - st.u) / LANE;
    const headingTo = THREE.MathUtils.clamp(toGo * 0.8 + Math.atan2(st.du, Math.max(st.speed, 4)) * 0.4, -0.55, 0.55);
    const quick = Math.abs(headingTo) > Math.abs(st.heading);
    st.heading += (headingTo - st.heading) * (1 - Math.exp(-dt / (quick ? 0.035 : 0.22)));

    // up and down
    if (!st.bump && st.y > 0) {
      st.vy -= GRAVITY * dt;
      st.y += st.vy * dt;
      if (st.y <= 0) {
        st.y = 0;
        st.vy = 0;
        if (st.queued === 'down' && st.queuedT > 0) st.slideT = SLIDE_TIME;
        if (st.queued === 'up' && st.queuedT > 0) {
          st.vy = JUMP_V;
          st.y = 0.001;
        }
        st.queued = null;
      }
    }
    st.queuedT = Math.max(0, st.queuedT - dt);
    st.slideT = Math.max(0, st.slideT - dt);
    const blend = 1 - Math.exp(-dt / 0.05);
    st.air += ((st.y > 0.02 ? 1 : 0) - st.air) * blend;
    st.slide += ((st.slideT > 0 ? 1 : 0) - st.slide) * blend;

    // obstacles
    // stepping round the boulders at a hollow log's mouth leaves the runner inside it: keep it down
    for (const row of rows) {
      if (row.kind !== 'hollow' || st.s < row.s - DEPTH.hollow - 0.5 || st.s > row.s + DEPTH.hollow) continue;
      if (Math.abs(st.u - row.eggLane * LANE) < 0.4 && (st.slide >= 0.5 || st.safeT > 0 || st.bump)) st.slideT = Math.max(st.slideT, 0.12);
    }
    if (!st.bump && st.safeT <= 0) {
      const inLane = (lane: number) => Math.abs(st.u - laneU(lane, st.s)) < 0.4;
      for (const row of rows) {
        const reach = Math.max(1, FACE[row.kind] + 0.2);
        if (row.hit || st.s > row.s + DEPTH[row.kind] + 0.2 || st.s < row.s - reach) continue;
        if (row.branch && Math.sign(st.u) !== row.branch) continue; // the other side of the fork
        // the obstacle of this row that stands in the runner's way, if any
        const member = row.around || row.kind === 'hollow' ? row.members.find((o) => o.lanes.some(inLane)) : row.members[0];
        if (!member) continue;
        const ahead = member.s - st.s; // how far ahead its middle is
        const depth = DEPTH[member.kind];
        const inside = Math.abs(ahead) <= depth;
        if (row.kind === 'creek') {
          // in the water without having jumped
          if (inside && st.y < 0.22) {
            wade(row);
            break;
          }
          continue;
        }
        if (row.kind === 'hollow' && inside && (st.slide >= 0.5 || st.safeT > 0)) {
          // once in, the runner stays down until it is out the far end
          st.slideT = Math.max(st.slideT, 0.12);
          continue;
        }
        // inside it without having done what it asks
        let hit = inside && (jumps(row.kind) ? st.y < 0.3 : slides(row.kind) ? st.slide < 0.5 : true);
        // or about to walk into its face having made no move at all: bump there, where the body
        // meets it. (A move made in time still gets its chance; this never bumps anyone who
        // would have made it.)
        if (!hit && ahead > depth && ahead <= FACE[member.kind]) {
          if (jumps(row.kind)) hit = st.y <= 0.001 && st.vy <= 0;
          else if (slides(row.kind)) hit = st.slideT <= 0 && st.slide < 0.5 && st.queued !== 'down';
          else hit = row.blocked.includes(st.lane);
        }
        if (!hit) continue;
        // swiped into it from an open lane while alongside: a sideways knock, not a head-on bump
        const fromSide =
          row.around && inside && row.blocked.includes(st.lane) && !row.blocked.includes(st.prevLane) &&
          Math.abs(st.u - laneU(st.prevLane, st.s)) < Math.abs(st.u - laneU(st.lane, st.s)) + 0.2;
        if (fromSide) sideBump(row, member);
        else startBump(row, member);
        for (const c of crossings) if (c.s === row.s) c.fled = 0.001;
        for (const z of sleepers) if (Math.abs(z.s - row.s) < 4) z.startled = 1.6;
        break;
      }
    }

    // Fan out: take the leaf and the fans spread; while they are out, amber from every lane
    // is swept in as the runner comes up to it.
    if (!st.leafTaken && Math.abs(POWER.s - st.s) < 0.7 && Math.abs(st.u - POWER.lane * LANE) < 0.45) {
      st.leafTaken = true;
      st.fanOn = true;
      leaf.visible = leafGlow.visible = false;
      hud.hint('Fan out! Catch it all');
      sound.leaf();
      st.hintT = 2.2;
    }
    // the fans stay out for a stretch of trail, so they cover the same amber at any speed
    if (st.fanOn && st.s > POWER.s + POWER.reach) st.fanOn = false;
    st.fan += ((st.fanOn && !st.bump ? 1 : 0) - st.fan) * (1 - Math.exp(-dt / 0.12));
    terrain.place(st.s + 0.25, st.u, st.y + 0.5, chest);
    if (st.fanOn) {
      for (let i = 0; i < AMBER.length; i++) {
        const a = AMBER[i];
        if (a.s < st.s - 0.6) continue;
        if (a.s > st.s + 3.6) break;
        if (collected[i] || fly[i] > 0) continue;
        fly[i] = 1e-4;
        flying.push(i);
      }
    }
    for (let k = flying.length - 1; k >= 0; k--) {
      const i = flying[k];
      fly[i] = Math.min(1, fly[i] + dt / 0.26);
      if (fly[i] >= 1) {
        collected[i] = true;
        flying.splice(k, 1);
        st.amber++;
        // (swept in by the fans: its row plays as a run of three, left to right)
        sound.amber(AMBER[i].s, AMBER[i].lift, AMBER[i].lane + 1);
        hud.setAmber(st.amber);
      }
      if (i >= shownFrom && i < shownTo) putAmber(i);
    }

    // amber
    for (let i = 0; i < AMBER.length; i++) {
      if (collected[i] || fly[i] > 0) continue;
      const a = AMBER[i];
      if (a.s < st.s - 1) continue;
      if (a.s > st.s + 1) break;
      if (Math.abs(a.s - st.s) < 0.55 && Math.abs(st.u - laneU(a.lane, a.s)) < 0.42 && Math.abs(st.y + 0.3 - a.lift) < 0.6) {
        collected[i] = true;
        if (i >= shownFrom && i < shownTo) putAmber(i);
        st.amber++;
        sound.amber(a.s, a.lift);
        hud.setAmber(st.amber);
      }
    }

    // The egg: clean running closes the gap, a bump lets it roll further ahead. It keeps its
    // own steady pace, so when the runner stops dead the egg rolls on.
    // The further behind you are, the faster you gain, so a bad patch can be won back.
    sound.setClose(1 - smoothstep(5.5, 19, st.eggS - st.s));
    // (the chase's music is tied to the ground: it goes as fast as the runner really is, and stops when it does)
    sound.drive(st.s, dt > 0 ? (st.s - sBefore) / dt : 0);
    const closing = 0.13 + 0.47 * smoothstep(START_LEAD, MAX_LEAD, st.gap);
    if (!st.bump && st.sideT <= 0 && st.wadeT <= 0 && st.introT < 0) st.gap = Math.max(MIN_LEAD, st.gap - closing * dt);
    st.gap = Math.min(st.gap, MAX_LEAD);
    st.heroV += (st.speed - st.heroV) * (1 - Math.exp(-dt / 0.5));
    // (while the egg is still in the nest the opening moves it: see draw)
    if (st.end === END.dash) dashEgg(dt);
    else if (st.introT < 0 || st.introT >= INTRO.roll) {
      // the wilder egg surges ahead and drops back when the trail is clear
      const surge = eggMode === 2 && eggFree(st.eggS) ? 1.3 * Math.sin(st.clock * 1.5) : 0;
      // Over the last of the trail the egg is reeled in, however far ahead it was, so that the
      // runner comes up right behind it just as it reaches the place it sets off from again.
      // (It used to stop there and wait, which Drew found "very anticlimactic".)
      const reel = smoothstep(REEL_FROM, PARK_S - FINALE.near - 2, st.s);
      const wantS = Math.min(st.s + THREE.MathUtils.lerp(st.gap + surge, FINALE.near + 0.9, reel), PARK_S);
      let eggSpeed = THREE.MathUtils.clamp(st.heroV + (wantS - st.eggS) * 1.6, 0, baseSpeed * 1.3 + 0.5);
      if (st.introT >= 0) {
        // fresh off the rim it rolls as the slope lets it, gathering speed, and then it bolts
        const x = st.introT - INTRO.roll;
        eggSpeed = Math.min(st.heroV + (wantS - st.eggS) * 1.6, 0.6 + 3.6 * x + 5 * Math.max(0, x - 0.7) ** 2, 13.5);
      }
      st.eggV += (eggSpeed - st.eggV) * Math.min(1, dt * 6);
      st.eggS = Math.min(PARK_S, st.eggS + st.eggV * dt);
      rollEgg(dt, st.eggS < PARK_S - 0.05);
    }
    hud.warn(st.gap > WARN_LEAD && !st.finished && st.lostT <= 0 && st.end === END.chase && st.s < REEL_FROM);
    if (st.lostT > 0) {
      // the egg is out of sight: the runner pulls up, the picture dims, and the level is over
      const before = st.lostT;
      st.lostT += dt;
      if (before < 1.1 && st.lostT >= 1.1) hud.fade(true);
      if (before < 2.0 && st.lostT >= 2.0) hud.showLost();
    } else if (!noLose && !st.finished && st.gap >= MAX_LEAD - 0.01 && st.s < REEL_FROM) {
      st.lostT = 1e-4;
      sound.lost();
      hud.hint('The egg got away!');
      st.hintT = 2.0;
    }

    // hidden finds
    finds.forEach((f, i) => {
      if (st.found[i]) return;
      if (Math.abs(f.s - st.s) < 0.6 && Math.abs(st.u - laneU(f.lane, f.s)) < 0.45 && Math.abs(st.y + 0.3 - f.lift) < 0.7) {
        st.found[i] = true;
        f.gem.visible = f.glow.visible = false;
        hud.setFinds(st.found);
        hud.hint('A hidden find!');
        sound.find();
        st.hintT = 1.6;
      }
    });
    hud.fork(FORK !== null && FORK_LABELS_FROM >= 0 && st.s >= FORK_LABELS_FROM && st.s < FORK.from + 1 && st.lostT <= 0);

    // first-time hints: one at a time, shown early enough to act on
    if (st.hint < HINTS.length && st.s >= HINTS[st.hint].s) {
      hud.hint(HINTS[st.hint].text);
      st.hint++;
      st.hintT = 2.8;
    }
    if (st.hintT > 0) {
      st.hintT -= dt;
      if (st.hintT <= 0) hud.hint(null);
    }

    // The last of the trail. The egg has stopped a little short of the edge. When the runner is
    // right behind it, one more kick from inside sends it on, and the swipe has to come before
    // it gets there.
    if (st.end === END.chase && st.s > PARK_S - 18 && st.lostT <= 0) st.end = END.shelf;
    if (st.end === END.shelf && st.lostT <= 0 && st.eggS >= PARK_S - 0.15 && st.eggS - st.s <= FINALE.near && st.y <= 0.001 && !st.bump) startDash();
    if (st.end === END.dash) {
      if (autoScoop) st.scoop = true;
      const left = CATCH_S - st.eggS;
      if (left <= 0) startMiss();
      else if (st.scoop && left <= FINALE.dive && left > FINALE.late && !st.bump) startDive();
    }
  }

  const tmp = new THREE.Vector3();
  const look = new THREE.Vector3();
  const scenePos = new THREE.Vector3();
  const sceneLook = new THREE.Vector3();
  const sceneQ = new THREE.Quaternion();
  const sceneE = new THREE.Euler();
  const sceneAxis = new THREE.Vector3();
  let chaseFov = 62;
  // The scenes' views, in trail terms: [meters down the trail from the subject, meters across, height].
  // On the nest: low on the uphill side, looking straight across it, so the rim and the slope below it are seen side-on.
  const introCam = { pos: [0.45, -3.0, 0.8], look: [0.3, 0, 0.18], fov: 44 };
  // The hatching: low, up the trail from the egg and a little to one side, with the parent beyond it and the valley beyond that; then closer.
  const endCam = { pos: [-2.4, 0.9, 0.7], look: [0.3, -0.1, 0.25], fov: 38, near: [-2.0, 0.95, 0.5], nearLook: [0.25, -0.1, 0.2], nearFov: 34 };
  // The catch: beside the last of the ground on the valley side, low, looking along the edge. [meters from the edge, across, height]
  const catchCam = { pos: [-2.7, 2.3, 0.7], look: [-0.5, 0, 0.22], fov: 46 };
  // (the chick: how big it is against the egg as it starts and ends, where its hips ride along the cup's middle as fractions of the egg's length from its center, how high its hips are in its own measure, how far it sits up, and which way it faces)
  const endPose = { pitch: -1.4, bow: 0.16, chickFrom: 0.4, chickTo: 0.56, chickLow: -0.42, chickHigh: 0.1, chickHip: 0.03, chickTilt: 0.8, chickSit: 1, chickYaw: Math.PI * 0.72 };
  /** 0 before a, 1 after b, and gentle at both ends in between. */
  const smoother = (a: number, b: number, x: number) => {
    const k = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
    return k * k * k * (k * (k * 6 - 15) + 10);
  };

  // our egg stands on the crest of the rim, its narrow end dug in a little
  const perchLean = (t: number): number => {
    let a = PERCH.lean;
    INTRO.taps.forEach((tap, i) => {
      const x = t - tap;
      if (x <= 0) return;
      // each tap leaves it standing a little further over
      a += PERCH.creep[i] * (1 - Math.exp(-x * 6));
      // the first two rock it and it settles; the third carries it up to the point of balance and no further
      const last = i === INTRO.taps.length - 1;
      a += PERCH.rock[i] * (last ? Math.sin(Math.min(x, INTRO.teeter - tap) * 14) : Math.exp(-x * 3.2) * Math.sin(x * 14));
    });
    if (t > INTRO.teeter) {
      // balanced and quivering, and then over: slowly at first, the way a thing falls from its balance
      const x = t - INTRO.teeter;
      a += 0.015 * (Math.exp(x / 0.28) - 1) + 0.012 * Math.sin(x * 23) * Math.exp(-x * 3);
    }
    return Math.min(a, Math.PI / 2 + 0.2);
  };
  /** Where our egg was last drawn on the nest, so the chase can take it over from there. */
  const nestEgg = { s: START_S, u: 0 };
  /** Our egg on the rim of the nest: rocked by each tap from inside, until the last one tips it over. */
  function drawNestEgg(t: number) {
    const lean = perchLean(t);
    // it turns on its narrow end until it is well over; then that end comes free and it is on the slope
    const free = smoothstep(0.7, 1.55, lean);
    const reach = (EGG_HALF - PERCH.bury * EGG_LEN) * Math.sin(lean) + 0.16 * free;
    const r = nest.plan.rim + reach;
    const s = START_S + Math.cos(OUR_ANGLE) * r;
    const u = Math.sin(OUR_ANGLE) * r;
    const c = Math.cos(lean);
    const high = Math.sqrt(EGG_HALF * EGG_HALF * c * c + EGG_R * EGG_R * (1 - c * c));
    const dug = PERCH.bury * EGG_LEN * (1 - smoothstep(0.3, 1.0, lean));
    egg.position.copy(terrain.place(s, u, nestHeight(nest.plan, r, OUR_ANGLE) + high - dug + 0.01));
    egg.quaternion.copy(nestBasis).multiply(eggTurn(OUR_ANGLE, lean, sceneQ));
    egg.scale.setScalar(EGG_LEN);
    nestEgg.s = s;
    nestEgg.u = u;
    st.eggU = u;
    eggShadow.position.copy(terrain.place(s, u, 0.02));
    eggShadow.scale.setScalar(1);
    (eggShadow.material as THREE.ShaderMaterial).uniforms.uStrength.value = 0.5 * free;
  }

  /** The egg in the parent's care: carried round from the edge, set on its end, and then the hatching. */
  function drawCradle() {
    const t = st.endT;
    const settle = st.end > END.turn ? 1 : smoother(0, 1, Math.min(1, t / TURN_TIME));
    terrain.place(cradle.s, cradle.u, THREE.MathUtils.lerp(restLift, EGG_LEN * 0.46, settle) + 0.1 * Math.sin(Math.PI * settle), tmp);
    sceneQ.copy(restQ).slerp(cradleQ, settle);
    // the taps from inside rock it, harder each time
    if (st.end === END.hatch) {
      let rock = 0;
      HATCH.taps.forEach((tap, i) => {
        const a = t - tap;
        if (a > 0) rock += (0.5 + 0.4 * i) * Math.exp(-a * 5) * Math.sin(a * 31);
      });
      sceneQ.multiply(heroYaw.setFromEuler(sceneE.set(rock * 0.1, 0, rock * 0.13)));
    }
    const popped = st.end > END.hatch || (st.end === END.hatch && t >= HATCH.pop);
    egg.visible = !popped;
    shell.cup.visible = shell.cap.visible = popped;
    for (const part of [egg, shell.cup]) {
      part.position.copy(tmp);
      part.quaternion.copy(sceneQ);
      part.scale.setScalar(EGG_LEN);
    }
    eggShadow.position.copy(terrain.place(cradle.s + 0.02, cradle.u, 0.012));
    eggShadow.scale.setScalar(1);
    (eggShadow.material as THREE.ShaderMaterial).uniforms.uStrength.value = 0.5;
    if (!popped) return;
    // the top comes off, turns over in the air and lands beside it
    const a = t - HATCH.pop;
    const e = st.end > END.hatch ? 1 : THREE.MathUtils.clamp(a / 0.6, 0, 1);
    terrain.place(cradle.s - 0.33 * EGG_LEN, cradle.u - 0.95 * EGG_LEN, EGG_LEN * 0.2, scenePos);
    shell.cap.position.lerpVectors(tmp, scenePos, e);
    shell.cap.position.y += 0.95 * EGG_LEN * 4 * e * (1 - e);
    shell.cap.quaternion.copy(sceneQ).multiply(heroYaw.setFromEuler(sceneE.set(-2.5 * e, 0.6 * e, 1.1 * e)));
    shell.cap.scale.setScalar(EGG_LEN);
    // and the chick comes up out of the cup: a look at the world, then up at its parent
    if (!chick) return;
    const up = st.end > END.hatch ? 1 : smoothstep(0.1, 0.95, a);
    const c = chick;
    c.group.visible = true;
    const size = c.size * THREE.MathUtils.lerp(endPose.chickFrom, endPose.chickTo, up);
    c.group.scale.setScalar(size);
    // It comes up sitting upright, as a chick does out of a shell: body on end, head on top. Its
    // hips ride up the middle of the cup, so the head comes out in the middle of the opening.
    c.group.quaternion
      .copy(basisAt(cradle.s, 0))
      .multiply(heroYaw.setFromAxisAngle(upAxis, endPose.chickYaw))
      .multiply(heroYaw.setFromAxisAngle(rightAxis, endPose.chickTilt));
    sceneAxis.set(0, 1, 0).applyQuaternion(sceneQ);
    c.group.position.copy(tmp).addScaledVector(sceneAxis, THREE.MathUtils.lerp(endPose.chickLow, endPose.chickHigh, up) * EGG_LEN);
    c.group.position.sub(scenePos.set(0, endPose.chickHip * size, 0).applyQuaternion(c.group.quaternion));
    const toParent = st.end > END.hatch ? 1 : smoothstep(1.5, 2.1, a);
    const cs = c.state;
    cs.idle = st.sceneT * 1.6;
    cs.blink = Math.max(blinkAt(st.sceneT, 0.61), a < 0.5 ? 1 - a / 0.5 : 0);
    cs.sit = endPose.chickSit;
    cs.lookYaw = THREE.MathUtils.lerp(0.8, -0.95, toParent) + 0.08 * Math.sin(st.sceneT * 2.1);
    cs.lookPitch = THREE.MathUtils.lerp(0.15, 0.6, toParent) - endPose.chickTilt * 0.8 + 0.05 * Math.sin(st.sceneT * 1.7);
    const peep = (st.sceneT * 0.9) % 1;
    cs.beak = up > 0.9 && peep < 0.16 ? Math.sin((peep / 0.16) * Math.PI) * 0.8 : 0;
    c.rig.pose(cs);
  }

  /** The egg that was not caught: out over the edge, turning as it goes, and down out of sight. */
  function drawMiss() {
    const t = st.endT;
    egg.position.copy(missFrom).addScaledVector(lipFwd, missV * t);
    egg.position.y += 1.7 * t - 4.75 * t * t;
    egg.quaternion.copy(missQ).premultiply(sceneQ.setFromAxisAngle(sceneAxis.crossVectors(upAxis, lipFwd), 7 * t));
    egg.scale.setScalar(EGG_LEN);
    egg.visible = t < 2.2;
    (eggShadow.material as THREE.ShaderMaterial).uniforms.uStrength.value = 0;
  }

  const heroYaw = new THREE.Quaternion();
  const upAxis = new THREE.Vector3(0, 1, 0);
  const rightAxis = new THREE.Vector3(1, 0, 0);
  function draw(renderer: THREE.WebGLRenderer) {
    // hero
    hero.position.copy(terrain.place(st.s, st.u, st.y + 0.005));
    // turned a little toward where it is really heading (to its right is a turn the negative way)
    hero.quaternion.copy(basisAt(st.s, 0.8)).multiply(heroYaw.setFromAxisAngle(upAxis, -st.heading + st.turn));
    // settled over the egg, it leans in over it
    if (st.end >= END.turn) hero.quaternion.multiply(heroYaw.setFromAxisAngle(rightAxis, -endPose.bow * st.sit));
    const shaken = Math.max(st.sideT, st.nudgeT);
    const wobble = shaken > 0 ? Math.sin(st.clock * 34) * 0.35 * (shaken / 0.55) : 0;
    heroState.phase = st.phase;
    heroState.speed = st.speed;
    heroState.run = Math.min(1, st.speed / 3);
    heroState.air = st.air;
    heroState.airTilt = THREE.MathUtils.clamp(st.vy / JUMP_V, -1, 1);
    heroState.slide = st.slide;
    heroState.flinch = st.flinch;
    heroState.fan = st.fan;
    // In the scenes the head has a life of its own: looking about on the nest, down at the egg
    // when it stirs, after it as it goes, and down at it again once it is safe.
    const inScene = st.introT >= 0 || st.end >= END.dive;
    let yawTo = 0;
    let pitchTo = 0;
    let beakTo = 0;
    if (st.introT >= 0) {
      const t = st.started ? st.introT : 0;
      if (t < INTRO.taps[0]) {
        // now and then it looks round at whoever is watching
        const glance = smoothstep(0.5, 0.85, Math.sin(st.sceneT * 0.5 + 0.6));
        yawTo = THREE.MathUtils.lerp(Math.sin(st.sceneT * 0.63) * 0.4 + Math.sin(st.sceneT * 1.17) * 0.12, -1.2, glance);
        pitchTo = -0.05 + 0.07 * Math.sin(st.sceneT * 0.8);
      } else if (t < INTRO.roll) {
        // down at the egg as it rocks, and closer as it hangs on the edge
        yawTo = -0.42;
        pitchTo = t < INTRO.teeter ? -1.1 : -1.4;
        beakTo = t > INTRO.teeter + 0.4 ? 0.8 : 0;
      } else if (t < INTRO.run + 0.6) {
        yawTo = -0.3 * (1 - smoothstep(INTRO.roll, INTRO.run, t));
        pitchTo = -0.45;
        beakTo = t < INTRO.roll + 0.5 ? 0.8 : 0;
      }
    } else if (st.end === END.miss) {
      pitchTo = -0.9; // after the egg, over the edge
    } else if (st.end >= END.dive) {
      const settled = st.end > END.turn || (st.end === END.turn && st.endT > TURN_TIME);
      // head up over the egg while it is pinned and carried; down to it once they have settled
      pitchTo = settled ? endPose.pitch + 0.06 * Math.sin(st.sceneT * 1.3) : st.end === END.turn ? 0 : 0.5;
      yawTo = settled ? 0.1 * Math.sin(st.sceneT * 0.7) : 0;
      // a soft call down to the chick once it is out
      const out = st.end > END.hatch || (st.end === END.hatch && st.endT > HATCH.pop + 1.6);
      beakTo = out && (st.sceneT * 0.45) % 1 < 0.12 ? 0.5 : 0;
    }
    st.lookYaw += (yawTo - st.lookYaw) * 0.1;
    st.lookPitch += (pitchTo - st.lookPitch) * 0.1;
    st.beak += (beakTo - st.beak) * 0.25;
    heroState.sit = st.sit;
    heroState.idle = st.sceneT;
    heroState.blink = Math.max(st.flinch, inScene ? blinkAt(st.sceneT) : 0);
    heroState.beak = st.beak;
    heroState.lookPitch = st.lookPitch;
    // (in the chase the head keeps looking down the trail while the body turns under it)
    heroState.lookYaw = -st.heading * 0.75 + st.lookYaw;
    fanGlow.position.copy(chest);
    (fanGlow.material as THREE.ShaderMaterial).uniforms.uStrength.value = 0.18 * st.fan;
    fanGlow.visible = st.fan > 0.01;
    heroState.lean = THREE.MathUtils.clamp((laneU(st.lane, st.s) - st.u) / LANE, -1, 1) + wobble;
    rig.pose(heroState);
    heroShadow.position.copy(terrain.place(st.s + 0.08, st.u, 0.02));
    heroShadow.quaternion.copy(basisAt(st.s));
    heroShadow.scale.setScalar(1 + st.y * 0.5);
    (heroShadow.material as THREE.ShaderMaterial).uniforms.uStrength.value = 0.46 * (1 - Math.min(0.6, st.y * 0.6));

    // egg: bouncing and tumbling down the trail ahead
    // it weaves between the lanes, so it never sits on top of a line of amber
    const wildEgg = eggMode; // 0 lively, 1 wild, 2 wilder
    if (st.introT >= 0 && (!st.started || st.introT < INTRO.roll)) drawNestEgg(st.started ? st.introT : 0);
    else if (st.end === END.miss) drawMiss();
    else if (st.end >= END.turn) drawCradle();
    else {
      let eggU = eggUAt(st.eggS, wildEgg);
      // (off the nest it comes onto its line over the first few meters)
      if (st.introT >= 0) eggU = THREE.MathUtils.lerp(st.rollU, eggU, smoothstep(0, 6, st.eggS - st.rollS));
      st.eggU = eggU;
      egg.scale.setScalar(EGG_LEN * (1 + (wildEgg ? 0.26 : 0.16) * st.eggPop) * (1 - 0.08 * st.eggWind));
      // an egg standing on its end rides higher than one lying on its side
      const up = eggLong.set(0, 1, 0).applyQuaternion(eggQ).y;
      const rest = Math.sqrt(EGG_HALF * EGG_HALF * up * up + EGG_R * EGG_R * (1 - up * up));
      egg.position.copy(terrain.place(st.eggS, eggU, rest + 0.015 + st.eggY));
      egg.quaternion.copy(basisAt(st.eggS));
      if (wildEgg) {
        // it leans into its swerves, and shivers as it winds up for a hop
        const lean = THREE.MathUtils.clamp((eggUAt(st.eggS + 0.4, wildEgg) - eggUAt(st.eggS - 0.4, wildEgg)) * 1.4, -0.6, 0.6);
        egg.quaternion.multiply(eggSpinQ.setFromAxisAngle(eggBack, lean + Math.sin(st.clock * 52) * 0.2 * st.eggWind));
      }
      egg.quaternion.multiply(eggQ);
      eggShadow.position.copy(terrain.place(st.eggS + 0.04, eggU, 0.02));
      eggShadow.quaternion.copy(basisAt(st.eggS));
      eggShadow.scale.setScalar(1);
      (eggShadow.material as THREE.ShaderMaterial).uniforms.uStrength.value = 0.55 * (1 - Math.min(0.75, st.eggY * 1.6));
    }

    eggGlow.position.copy(egg.position);
    eggGlow.visible = egg.visible && st.started && (st.introT < 0 || st.introT >= INTRO.roll) && st.end < END.caught;
    // the dozing Psittacosaurus breathes, and lifts its head to watch the runner go by
    for (const f of finds) {
      f.gem.rotation.y = st.clock * 1.4 + f.s;
      f.gem.position.y = f.at.y + Math.sin(st.clock * 2 + f.s) * 0.06;
    }
    for (const z of sleepers) {
      const ahead = z.s - st.s;
      const noticed = ahead > -7 && ahead < 9 ? 1 - smoothstep(3.5, 9, ahead) : 0;
      z.startled = Math.max(0, z.startled - 1 / 60);
      const want = Math.max(noticed * 0.8, z.startled > 0 ? 1 : 0);
      z.up += (want - z.up) * (want > z.up ? 0.12 : 0.03);
      const side = Math.sign(st.u - z.u) || 1;
      z.neck.rotation.set(z.up * 0.8, -side * z.up * (ahead < 0 ? 1.25 : 0.55), 0);
      z.group.scale.set(1, 1 + 0.02 * Math.sin(st.clock * 1.5), 1);
      materialFor('eye').uniforms.uBlink.value = 1 - smoothstep(0.25, 0.6, z.up);
    }
    // The young ones walk across as the runner comes: off in the ferns on the left when it is
    // far away, spread across all three lanes as it arrives, and away to the right behind it.
    // Their steps keep time with the ground they cover.
    for (const c of crossings) {
      const ahead = c.s - st.s;
      const show = ahead < 48 && ahead > -16;
      if (c.fled > 0) c.fled += 1 / 60;
      const shift = (ahead > 0 ? -0.11 * ahead : 0.2 * -ahead) + c.fled * 1.9;
      c.young.forEach((y, i) => {
        y.group.visible = show;
        if (!show) return;
        const yu = (i - 1) * 0.8 + shift;
        const step = (yu / 0.27) * Math.PI * 2;
        y.group.position.copy(terrain.place(c.s + (i - 1) * 0.07, yu, Math.abs(Math.sin(step)) * 0.012));
        y.group.quaternion.copy(basisAt(c.s, 0)).multiply(heroYaw.setFromAxisAngle(upAxis, -Math.PI / 2));
        const swing = Math.sin(step) * 0.55;
        y.legs[0].rotation.x = swing;
        y.legs[3].rotation.x = swing;
        y.legs[1].rotation.x = -swing;
        y.legs[2].rotation.x = -swing;
        y.neck.rotation.x = 0.12 + 0.08 * Math.sin(step * 2 + i);
      });
    }

    // camera: behind and above, easing sideways with the hero, looking well down the trail
    // In the fork the camera goes round with the runner's side of the trail, so the rock stays
    // beside the view and never in front of it.
    const swing = Math.sign(st.u) * Math.min(Math.abs(st.u), bowAt(st.s));
    st.camU += ((st.u - swing) * 0.7 + swing - st.camU) * 0.12;
    const camS = st.s - 2.6 + st.camLead;
    // the camera ducks under an arch a moment after the hero does
    let duck = 0;
    for (const a of archAt) {
      if (a.branch && Math.sign(st.u) !== a.branch) continue;
      duck = Math.max(duck, 1 - smoothstep(1.0, 3.6, Math.max(0, Math.abs(a.s - camS) - a.half)));
    }
    st.camDuck += (duck - st.camDuck) * 0.3;
    camera.position.copy(terrain.place(camS, st.camU, 1.45 + st.y * 0.22 - 1.05 * st.camDuck));
    if (st.shakeT > 0) {
      const k = (st.shakeT / 0.3) * 0.045;
      camera.position.x += Math.sin(st.clock * 47) * k;
      camera.position.y += Math.cos(st.clock * 53) * k;
    }
    // dust where the bump landed: a quick swelling, fading puff
    puff.visible = st.puffT > 0;
    if (puff.visible) {
      const age = 1 - st.puffT / 0.34;
      puff.scale.setScalar(0.5 + age * 1.3);
      (puff.material as THREE.ShaderMaterial).uniforms.uStrength.value = 0.5 * (1 - age) ** 1.5;
    }
    const swingAhead = Math.sign(st.u) * Math.min(Math.abs(st.u), bowAt(st.s + 13));
    terrain.place(st.s + 13, (st.u - swing) * 0.3 + swingAhead, 0.5 - 0.2 * st.camDuck, look);
    // at the end of the ground the view looks out level over the valley, not down the cliff
    if (st.s + 13 > END_S) {
      const over = st.s + 13 - END_S;
      terrain.place(END_S, (st.u - swing) * 0.3 + swingAhead, 0.5 - 0.2 * st.camDuck, look).addScaledVector(lipFwd, over);
      look.y -= over * 0.05;
    }
    // The scenes have their own views, and the chase view is blended in or out of them.
    let fov = chaseFov;
    if (st.introT >= 0) {
      // beside the nest and low, looking across it and on down the trail; then round behind the runner
      const t = st.started ? st.introT : 0;
      const k = smoother(INTRO.camFrom, INTRO.camTo, t);
      terrain.place(START_S + introCam.pos[0], introCam.pos[1], introCam.pos[2], scenePos);
      terrain.place(START_S + introCam.look[0], introCam.look[1], introCam.look[2], sceneLook);
      // the view goes with the egg as it is thrown out
      sceneLook.lerp(egg.position, 0.9 * smoothstep(INTRO.teeter + 0.6, INTRO.roll + 0.2, t));
      camera.position.lerpVectors(scenePos, camera.position, k);
      look.lerpVectors(sceneLook, look, k);
      fov = THREE.MathUtils.lerp(introCam.fov, chaseFov, k);
    } else if (st.end >= END.dive) {
      // each moment of the ending has a view of its own, and the camera eases from one to the next
      let rate = 0.06;
      let fovTo = chaseFov;
      if (st.end === END.dive || st.end === END.caught) {
        // beside the last of the ground, low: the dive and the edge, with the valley beyond
        terrain.place(END_S + catchCam.pos[0], catchCam.pos[1], catchCam.pos[2], scenePos);
        terrain.place(END_S + catchCam.look[0], catchCam.look[1], catchCam.look[2], sceneLook);
        fovTo = catchCam.fov;
        rate = 0.1;
      } else if (st.end === END.miss) {
        // it stays where it was, and watches the egg go
        scenePos.copy(camPos);
        if (st.endT < 1.1) sceneLook.copy(egg.position);
        else sceneLook.copy(camLook);
        rate = 0.12;
      } else {
        const L = THREE.MathUtils.lerp;
        const closer = st.end > END.hatch ? 1 : st.end === END.hatch ? smoother(0.2, HATCH.pop + 1.4, st.endT) : 0;
        terrain.place(cradle.s + L(endCam.pos[0], endCam.near[0], closer), cradle.u + L(endCam.pos[1], endCam.near[1], closer), L(endCam.pos[2], endCam.near[2], closer), scenePos);
        terrain.place(cradle.s + L(endCam.look[0], endCam.nearLook[0], closer), cradle.u + L(endCam.look[1], endCam.nearLook[1], closer), L(endCam.look[2], endCam.nearLook[2], closer), sceneLook);
        // and a slow drift, so the picture is never quite still
        scenePos.x += Math.sin(st.sceneT * 0.3) * 0.02;
        fovTo = L(endCam.fov, endCam.nearFov, closer);
        rate = st.end === END.turn ? 0.06 : 0.035;
      }
      camPos.lerp(scenePos, rate);
      camLook.lerp(sceneLook, rate);
      camFov += (fovTo - camFov) * rate;
      camera.position.copy(camPos);
      look.copy(camLook);
      fov = camFov;
    }
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    camera.lookAt(look);
    camera.updateMatrixWorld();

    // the far world rides along; the valley's mist layer stays below you as you descend
    far.position.set(camera.position.x - eye0.x, (camera.position.y - eye0.y) * 0.45, camera.position.z - eye0.z);
    world.uFog.value.y = camera.position.y + hooks.styles[hooks.styleIndex()].fog.base;
    const ahead = track.sample(st.s + 40).tan.clone().setY(0).normalize();
    for (const v of valleyMist) {
      airAt.copy(camera.position).addScaledVector(ahead, v.r);
      airAt.y = camera.position.y - v.drop;
      mist.move(v.i, airAt);
    }
    plume.forEach((p, i) => mist.move(i, airAt.copy(p).add(far.position)));
    let moved = false;
    for (const m of mists) {
      if (m.s < st.s - 6) {
        m.s += mists.length * MIST_GAP;
        moved = true;
      }
    }
    for (const sh of shafts) {
      if (sh.s < st.s - 4) {
        sh.s += shafts.length * SHAFT_GAP;
        moved = true;
      }
    }
    if (moved) placeAir();

    flora.update(st.s);
    // only the ground and the amber near the runner are drawn
    terrain.showRange(ground, st.s - 8, st.s + 330);
    showAmberNear(st.s);
    // Nothing that casts into the shadow map moves, so it only needs drawing again once the
    // runner has covered some ground. That keeps its cost off most frames.
    if (shadowsOn && Math.abs(st.s - shadowAt) >= 2.5) {
      shadowAt = st.s;
      flora.shadowPass(true);
      shadow.render(renderer, scene, terrain.place(Math.min(st.s + 14, END_S - 4), 0, 0, tmp));
      flora.shadowPass(false);
    }
    st.frame++;
  }

  reset();
  // for testing from the console: read the state, make moves, pause, start over
  Object.assign(window, { rrGame: { st, act, setPaused, reset, obstacles, rows, collected, DEPTH, flora, laneU, FORK, finds: FINDS, CHECKPOINTS, tryAgain, skipIntro, END_S, introCam, endCam, endPose, catchCam, END, FINALE, startDash, scene, camera, sound } });
  if (testing) {
    st.started = true;
    (ui.querySelector('.start-sheet') as HTMLElement).hidden = true;
  }
  // the chick is a big file and is only needed at the end: fetch it once the first picture is up
  setTimeout(fetchChick, 1200);
  let last = -1;
  return {
    scene,
    camera,
    debug: {
      st,
      forest: flora.group,
      setShadows(on: boolean) {
        shadowsOn = on;
        shadowAt = -1e9;
        world.uShadowParams.value.w = on ? 1 : 0;
      },
    },
    resize(aspect: number) {
      camera.aspect = aspect;
      const base = 62;
      const phone = 440 / 956;
      chaseFov = aspect <= phone ? base : THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(base / 2)) * Math.min(1, (phone / aspect) * 1.25)));
      camera.fov = chaseFov;
      camera.updateProjectionMatrix();
    },
    steady: () => st.started && !st.paused && !st.finished && st.lostT <= 0 && st.introT < 0 && st.slow >= 1,
    update(time: number, renderer: THREE.WebGLRenderer) {
      const real = last < 0 ? 0 : Math.min(0.05, Math.max(0, time - last));
      last = time;
      if (warm) {
        // the shell's pieces and the chick are hidden until the very end: have them ready now
        warm = false;
        const hidden = [shell.cup, shell.cap, ...(chick ? [chick.group] : [])].filter((o) => !o.visible);
        for (const o of hidden) o.visible = true;
        renderer.compile(scene, camera);
        for (const o of hidden) o.visible = false;
      }
      const dt = real * st.slow;
      if (!st.paused) {
        world.uTime.value += dt;
        st.sceneT += real;
        if (st.started) step(dt);
      }
      draw(renderer);
    },
  };
}

void SHADOW_LAYER;
