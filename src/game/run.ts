// The rough playable run: one runner, one trail, an egg to chase.
// Everything that moves is driven from here; the world pieces come from src/world.

import * as THREE from 'three';
import { setReloadGuard } from '../app/build';
import { HeroRig, strideLength, type HeroState } from '../hero/rig';
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
import { AMBER, bowAt, CHECKPOINTS, DEFAULT_SPEED, END_S, FINDS, FORK, FORK_LABELS_FROM, HINTS, LANE, laneMap, laneU, OBSTACLES, POWER, SEGMENTS, START_SLOPE, VISTAS, type Obstacle } from './course';
import { Flora } from './flora';
import { makeHud } from './hud';
import { listenForMoves, type Move } from './input';

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
const EGG_SCALE = 0.56;
const EGG_R = 0.275 * EGG_SCALE; // half its width
const EGG_HALF = 0.5 * EGG_SCALE; // half its length
const EGG_G = 9.5;
/**
 * How the egg travels. Lively: tumbling at changing angles, each bounce depending on how it
 * lands. Wild: Lively, and it shows off: it shivers before a hop and flips over the log, jinks
 * late and hard round trees, shoots out from under arches, and throws in big bounces and quick
 * side-steps when the trail is clear. Wilder: all of that turned up, and now and then it lands
 * on its end and spins like a top, and it surges ahead and drops back.
 */
export const EGG_MODES = ['Lively', 'Wild', 'Wilder'];

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
const MAX_LEAD = 26; // let it get this far ahead and the egg is lost: back to the last checkpoint
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

  const testing = new URLSearchParams(location.search).has('nopause'); // test runs only
  const noLose = new URLSearchParams(location.search).has('nolose'); // test runs only: the egg can't be lost
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, 0.46, 0.3, 2500);
  const track = new Track(SEGMENTS, START_SLOPE);
  const creekAt = OBSTACLES.filter((o) => o.kind === 'creek').map((o) => o.s);
  // the ground knows where the lanes swing apart at the fork and where creeks cut through its edges
  const terrain = new Terrain(track, { laneMap, creeks: creekAt });
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
    length: track.length,
    vistas: VISTAS,
    keepClear: OBSTACLES.map((o) => o.s),
    keepOut: (ps, pu) => Math.abs(pu) - bowAt(ps) < 1.5 || creekAt.some((c) => Math.abs(c - ps) < 1.2),
  });
  scene.add(flora.group);

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

  const egg = instance(props, 'egg', false);
  egg.scale.setScalar(EGG_SCALE);
  scene.add(egg);
  materialFor('egg').uniforms.uGlow.value.set('#3fd0c0');
  const eggShadow = makeContactShadow(0.7, 0.52, 0.55);
  scene.add(eggShadow);

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
  // and the runner bumps and steps to the egg's side, the easy one.
  const prow: Row | null = FORK
    ? { branch: 0, s: FORK.from + 1.7, kind: 'boulder', around: true, blocked: [0], eggLane: 1, members: [{ s: FORK.from + 1.7, kind: 'boulder', lanes: [0], hit: false }], hit: false }
    : null;
  if (prow) rows.push(prow);
  rows.sort((a, b) => a.s - b.s);
  const inFork = (s: number) => FORK !== null && s > FORK.from - 0.5 && s < FORK.to;
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
  if (prow) prow.eggLane = 1;
  /** Where the egg is across the trail: weaving between the lanes, so it never sits on a line of
   *  amber, and swinging into an open lane in good time to pass a tree or a boulder. The wild
   *  egg adds quick side-steps, and leaves its swing late and takes it wide. */
  const eggUAt = (s: number, wild = 0): number => {
    let u = weave(s);
    if (wild === 1) u += Math.sin(s * 0.47 + 1.3) * 0.17;
    if (wild === 2) u += Math.sin(s * 0.62 + 1.3) * 0.3;
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
      // at the fork it takes the easy side, down the middle of that lane
      const k = smoothstep(FORK.from - 15, FORK.from - 5, s) * (1 - smoothstep(FORK.to + 2, FORK.to + 10, s));
      u += (laneU(1, s) - u) * k;
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
      if (row.around || row.branch === -1) continue; // (the fork's left side is not the egg's way)
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
  const eggTurn = new THREE.Quaternion();
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
    /** Fan out: time left, how far the fans are spread, and whether the leaf has been taken. */
    fanOn: false,
    /** Hidden finds picked up, and the countdown after the egg is lost. */
    found: FINDS.map(() => false),
    lostT: 0,
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
    if (st.finished || !st.started) return;
    st.paused = p;
    hud.setPaused(p);
  }

  /** Put every single thing back to the start. */
  function reset() {
    Object.assign(st, {
      s: START_S, lane: 0, u: 0, y: 0, vy: 0, slideT: 0, safeT: 0, speed: 0, phase: 0, air: 0,
      slide: 0, camU: 0, camDuck: 0, gap: START_LEAD, eggS: START_S + START_LEAD, eggY: 0, eggVy: 0, eggSpin: 0, eggKick: 0, amber: 0, paused: false,
      finished: false, queued: null, queuedT: 0, hint: 0, hintT: 0,
      prevLane: 0, du: 0, heading: 0, bump: null, sideT: 0, wadeT: 0, flinch: 0, shakeT: 0, puffT: 0, camLead: 0, pending: null,
      pendingT: 0, boostT: 0, eggU: 0, eggV: 0, heroV: 0, eggHop: false, eggPop: 0, eggTip: 0,
      eggWind: 0, eggSkips: 0, eggBounces: 0, eggJink: -1, eggWasLow: false, eggTop: 0, fanOn: false, fan: 0, leafTaken: false, lostT: 0,
    });
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
    materialFor('egg').uniforms.uCrack.value = 0.5;
    hud.setAmber(0);
    hud.hint(null);
    hud.warn(false);
    hud.setPaused(false);
    hud.hideFinish();
  }

  /** Back to the last checkpoint passed, with the egg a fair way ahead again. What was collected is kept. */
  function tryAgain() {
    const from = CHECKPOINTS.filter((c) => c <= st.s).pop() ?? START_S;
    Object.assign(st, {
      s: from, lane: 0, u: 0, y: 0, vy: 0, slideT: 0, safeT: 1, speed: 0, air: 0, slide: 0, camU: 0, camDuck: 0,
      gap: START_LEAD, eggS: from + START_LEAD, eggY: 0, eggVy: 0, eggV: 0, heroV: 0, queued: null, queuedT: 0,
      prevLane: 0, du: 0, heading: 0, bump: null, sideT: 0, wadeT: 0, flinch: 0, shakeT: 0, puffT: 0, camLead: 0,
      pending: null, pendingT: 0, boostT: 0, eggHop: false, eggTop: 0, eggSkips: 0, eggWasLow: false, lostT: 0,
    });
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
    if (st.bump) {
      // mid-bump the runner can't answer, but the swipe is kept for the moment it can
      st.pending = move;
      st.pendingT = 0.6;
      return;
    }
    if (move === 'left' || move === 'right') {
      const to = THREE.MathUtils.clamp(st.lane + (move === 'left' ? -1 : 1), -1, 1);
      if (to === 0 && inFork(st.s)) {
        // the rock is in the way: a shoulder against it, and on
        st.sideT = Math.max(st.sideT, 0.25);
        return;
      }
      if (to !== st.lane) {
        st.prevLane = st.lane;
        st.lane = to;
      }
    } else if (move === 'up') {
      if (st.y <= 0.001) {
        st.vy = JUMP_V;
        st.y = 0.001;
        st.slideT = 0;
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
      }
    }
  }
  listenForMoves(stage, act);
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
    const wanted = rolling && !topping ? st.eggV * 1.5 * (1 + st.eggKick) : 0;
    st.eggSpin += (wanted - st.eggSpin) * Math.min(1, dt * (rolling ? 8 : 3));
    st.eggKick = Math.max(0, st.eggKick - dt * 1.6);
    st.eggPop = Math.max(0, st.eggPop - dt * 5);
    eggQ.premultiply(eggTurn.setFromAxisAngle(eggAxis, st.eggSpin * dt)).normalize();
    if (topping) {
      // up on its end and spinning like a top, until it tips back into its tumble
      st.eggTop -= dt;
      eggLong.set(0, 1, 0).applyQuaternion(eggQ);
      eggSide.set(0, eggLong.y >= 0 ? 1 : -1, 0);
      eggTurn.setFromUnitVectors(eggLong, eggSide);
      eggQ.premultiply(eggNudge.identity().slerp(eggTurn, Math.min(1, dt * 10)));
      eggQ.premultiply(eggTurn.setFromAxisAngle(eggSide.set(0, 1, 0), dt * 24)).normalize();
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
      eggTurn.setFromUnitVectors(eggLong, eggSide);
      eggQ.premultiply(eggNudge.identity().slerp(eggTurn, Math.min(1, dt * 5))).normalize();
      st.eggTip = 1.1; // once through, it is tipped back into its tumble
      if (wild && low) st.eggKick = Math.max(st.eggKick, 0.9); // and the wild one spins up as it goes under
    } else if (st.eggTip > 0) {
      const turn = Math.min(st.eggTip, dt * 4.5);
      st.eggTip -= turn;
      eggQ.premultiply(eggTurn.setFromAxisAngle(eggBack, turn)).normalize();
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
      st.eggY = 0;
      st.eggVy = Math.sqrt(2 * EGG_G * 0.1);
    }
    if (wild && rolling && st.eggY <= 0.02) {
      // a little hop into each swerve round a tree or a boulder
      for (const r of rows) {
        if (!r.around || r === prow || st.eggJink === r.s || st.eggS < r.s - 5 || st.eggS > r.s - 3.4) continue;
        st.eggJink = r.s;
        st.eggY = 0.001;
        st.eggVy = Math.sqrt(2 * EGG_G * 0.3);
        st.eggKick = 1.0;
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
      if (rolling && !settle && !low) {
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
          } else if (st.eggBounces % (wilder ? 2 : 3) === 0 && eggFree(st.eggS)) {
            // every so often, where there is room, a big bounce with a flip
            height = wilder ? 0.85 : 0.66;
            st.eggKick = wilder ? 1.7 : 1.3;
            st.eggPop = 0.7;
          } else if (wilder && st.eggBounces % 4 === 1 && eggFree(st.eggS)) {
            // or it lands on its end and spins there for a moment
            st.eggTop = 0.7;
            height = 0.12;
          }
        }
        st.eggVy = Math.sqrt(2 * EGG_G * height);
      }
    }
  }

  /** The runner has walked into something. It stops where its body meets it, then gets past. */
  function startBump(row: Row, member: (typeof obstacles)[number]) {
    row.hit = true;
    for (const o of row.members) o.hit = true;
    let toLane = st.lane;
    if (row.around && row.blocked.includes(st.lane)) {
      // step round to the nearest open lane; with one on each side, the one the egg took
      const open = openLanes(row);
      const near = Math.min(...open.map((lane) => Math.abs(lane - st.lane)));
      const nearest = open.filter((lane) => Math.abs(lane - st.lane) === near);
      toLane = nearest.includes(row.eggLane) ? row.eggLane : (nearest[0] ?? st.lane);
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
    const ending = st.s > END_S - 9;
    const cruise = st.finished || st.lostT > 0 ? 0 : baseSpeed * (ending ? THREE.MathUtils.clamp((END_S - 1.0 - st.s) / 8, 0.12, 1) : 1);
    const uBefore = st.u;
    if (st.bump) {
      stepBump(dt);
    } else {
      const target = cruise * (st.wadeT > 0 ? 0.42 : st.sideT > 0 ? 0.6 : 1);
      // back up to speed briskly after a bump, so a bump costs about the same whatever was hit
      const pickup = st.boostT > 0 ? 5 : 2.2;
      st.speed += (target - st.speed) * Math.min(1, dt * (st.speed < target ? pickup : 6));
      st.s += st.speed * dt;
      // side to side
      st.u += (laneU(st.lane, st.s) - st.u) * (1 - Math.exp(-dt / 0.055));
    }
    st.phase += (st.speed * dt) / strideLength(st.speed);
    st.safeT = Math.max(0, st.safeT - dt);
    st.sideT = Math.max(0, st.sideT - dt);
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
        hud.setAmber(st.amber);
      }
    }

    // The egg: clean running closes the gap, a bump lets it roll further ahead. It keeps its
    // own steady pace, so when the runner stops dead the egg rolls on.
    // The further behind you are, the faster you gain, so a bad patch can be won back.
    const closing = 0.13 + 0.47 * smoothstep(START_LEAD, MAX_LEAD, st.gap);
    if (!st.bump && st.sideT <= 0 && st.wadeT <= 0) st.gap = Math.max(MIN_LEAD, st.gap - closing * dt);
    st.gap = Math.min(st.gap, MAX_LEAD);
    st.heroV += (st.speed - st.heroV) * (1 - Math.exp(-dt / 0.5));
    // the wilder egg surges ahead and drops back when the trail is clear
    const surge = eggMode === 2 && eggFree(st.eggS) ? 1.3 * Math.sin(st.clock * 1.5) : 0;
    const wantS = Math.min(st.s + st.gap + surge, END_S);
    const eggSpeed = THREE.MathUtils.clamp(st.heroV + (wantS - st.eggS) * 1.6, 0, baseSpeed * 1.3 + 0.5);
    st.eggV += (eggSpeed - st.eggV) * Math.min(1, dt * 6);
    st.eggS = Math.min(END_S, st.eggS + st.eggV * dt);
    rollEgg(dt, st.eggS < END_S - 0.05);
    hud.warn(st.gap > WARN_LEAD && !st.finished && st.lostT <= 0);
    if (st.lostT > 0) {
      // the egg is out of sight: stop, dim the picture, and go back to the last checkpoint
      const before = st.lostT;
      st.lostT -= dt;
      if (before > 0.8 && st.lostT <= 0.8) hud.fade(true);
      if (st.lostT <= 0) tryAgain();
    } else if (!noLose && !st.finished && st.gap >= MAX_LEAD - 0.01) {
      st.lostT = 1.5;
      hud.hint('The egg got away!');
      st.hintT = 9;
    }

    // hidden finds
    finds.forEach((f, i) => {
      if (st.found[i]) return;
      if (Math.abs(f.s - st.s) < 0.6 && Math.abs(st.u - laneU(f.lane, f.s)) < 0.45 && Math.abs(st.y + 0.3 - f.lift) < 0.7) {
        st.found[i] = true;
        f.gem.visible = f.glow.visible = false;
        hud.setFinds(st.found);
        hud.hint('A hidden find!');
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

    if (!st.finished && st.s >= END_S - 1.25) {
      st.finished = true;
      hud.hint(null);
      hud.warn(false);
      hud.showFinish(st.amber, AMBER.length, st.found.filter(Boolean).length, FINDS.length);
    }
  }

  const tmp = new THREE.Vector3();
  const look = new THREE.Vector3();
  const heroYaw = new THREE.Quaternion();
  const upAxis = new THREE.Vector3(0, 1, 0);
  function draw(renderer: THREE.WebGLRenderer) {
    // hero
    hero.position.copy(terrain.place(st.s, st.u, st.y + 0.005));
    // turned a little toward where it is really heading (to its right is a turn the negative way)
    hero.quaternion.copy(basisAt(st.s, 0.8)).multiply(heroYaw.setFromAxisAngle(upAxis, -st.heading));
    const wobble = st.sideT > 0 ? Math.sin(st.clock * 34) * 0.35 * (st.sideT / 0.55) : 0;
    heroState.phase = st.phase;
    heroState.speed = st.speed;
    heroState.run = Math.min(1, st.speed / 3);
    heroState.air = st.air;
    heroState.airTilt = THREE.MathUtils.clamp(st.vy / JUMP_V, -1, 1);
    heroState.slide = st.slide;
    heroState.flinch = st.flinch;
    heroState.blink = st.flinch;
    heroState.fan = st.fan;
    // the head keeps looking down the trail while the body turns under it
    heroState.lookYaw = -st.heading * 0.75;
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
    const eggU = eggUAt(st.eggS, wildEgg);
    st.eggU = eggU;
    egg.scale.setScalar(EGG_SCALE * (1 + (wildEgg ? 0.26 : 0.16) * st.eggPop) * (1 - 0.08 * st.eggWind));
    // an egg standing on its end rides higher than one lying on its side
    const up = eggLong.set(0, 1, 0).applyQuaternion(eggQ).y;
    const rest = Math.sqrt(EGG_HALF * EGG_HALF * up * up + EGG_R * EGG_R * (1 - up * up));
    egg.position.copy(terrain.place(st.eggS, eggU, rest + 0.015 + st.eggY));
    egg.quaternion.copy(basisAt(st.eggS));
    if (wildEgg) {
      // it leans into its swerves, and shivers as it winds up for a hop
      const lean = THREE.MathUtils.clamp((eggUAt(st.eggS + 0.4, wildEgg) - eggUAt(st.eggS - 0.4, wildEgg)) * 1.4, -0.6, 0.6);
      egg.quaternion.multiply(eggTurn.setFromAxisAngle(eggBack, lean + Math.sin(st.clock * 52) * 0.2 * st.eggWind));
    }
    egg.quaternion.multiply(eggQ);
    eggShadow.position.copy(terrain.place(st.eggS + 0.04, eggU, 0.02));
    eggShadow.quaternion.copy(basisAt(st.eggS));
    (eggShadow.material as THREE.ShaderMaterial).uniforms.uStrength.value = 0.55 * (1 - Math.min(0.75, st.eggY * 1.6));

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
      shadow.render(renderer, scene, terrain.place(st.s + 14, 0, 0, tmp));
      flora.shadowPass(false);
    }
    st.frame++;
  }

  reset();
  // for testing from the console: read the state, make moves, pause, start over
  Object.assign(window, { rrGame: { st, act, setPaused, reset, obstacles, rows, collected, DEPTH, flora, laneU, FORK, finds: FINDS, CHECKPOINTS, tryAgain } });
  if (testing) {
    st.started = true;
    (ui.querySelector('.start-sheet') as HTMLElement).hidden = true;
  }
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
      camera.fov = aspect <= phone ? base : THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(base / 2)) * Math.min(1, (phone / aspect) * 1.25)));
      camera.updateProjectionMatrix();
    },
    steady: () => st.started && !st.paused && !st.finished,
    update(time: number, renderer: THREE.WebGLRenderer) {
      const dt = last < 0 ? 0 : Math.min(0.05, Math.max(0, time - last));
      last = time;
      if (!st.paused) {
        world.uTime.value += dt;
        if (st.started) step(dt);
      }
      draw(renderer);
    },
  };
}

void SHADOW_LAYER;
