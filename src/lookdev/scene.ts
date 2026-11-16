// The concept frame: one frozen moment of the chase, built from real game pieces.
// The hero mid-stride, the egg rolling ahead, a fallen log to jump, a line of amber,
// and the trail dropping away into the valley with a volcano beyond.

import * as THREE from 'three';
import { world } from '../render/paint';
import { SunShadow } from '../render/shadow';
import { HeroRig } from '../hero/rig';
import { instance, instances, loadKit, loadSkinned, materialFor, type Placement } from '../world/assets';
import { makeContactShadow, makeGlow, makeMist, makeShaft } from '../world/fx';
import { fbm, rng } from '../world/noise';
import { makeRidges, makeSky, makeVolcano } from '../world/sky';
import { Terrain } from '../world/terrain';
import { Track } from '../world/track';

import treesUrl from '../assets/models/flora_trees.glb?url';
import smallUrl from '../assets/models/flora_small.glb?url';
import propsUrl from '../assets/models/props.glb?url';
import heroUrl from '../assets/models/caudipteryx.glb?url';

export interface Lookdev {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  update(time: number, renderer: THREE.WebGLRenderer): void;
  resize(aspect: number): void;
}

const HERO_S = 14;
const LANE = 0.62;

export async function buildLookdev(): Promise<Lookdev> {
  const [trees, small, props, heroModel] = await Promise.all([
    loadKit(treesUrl),
    loadKit(smallUrl),
    loadKit(propsUrl),
    loadSkinned(heroUrl, true),
  ]);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, 0.46, 0.3, 2500);

  // Downhill all the way, with one steeper pitch ahead where the trail falls out of sight
  // and comes back into view lower down.
  const track = new Track(
    [
      { length: 14, slope: -0.11 },
      { length: 17, turn: 0.05, slope: -0.13 }, // gentle run to the log
      { length: 8, turn: 0.1, slope: -0.38 }, // the trail tips over
      { length: 11, turn: 0.12, slope: -0.38 }, // steep pitch, out of sight from here
      { length: 14, turn: -0.05, slope: -0.07 }, // run-out
      { length: 30, turn: -0.55, slope: -0.06 }, // far below, the trail swings left
      { length: 34, turn: 0.75, slope: -0.07 }, // and back across the view
      { length: 40, turn: -0.3, slope: -0.1 },
      { length: 40, turn: 0.2, slope: -0.12 },
    ],
    -0.11,
  );
  const terrain = new Terrain(track);

  // The camera comes first: the forest is planted around what it needs to see.
  const camS = HERO_S - 2.6;
  const camBase = terrain.place(camS, 0, 1.45);
  const lookAt = terrain.place(HERO_S + 14, 0.3, 0.5);
  const camRight = track.sample(camS).right;
  const viewDir = lookAt.clone().sub(camBase).setY(0).normalize();
  const viewBearing = Math.atan2(viewDir.x, -viewDir.z);

  // Morning sun, low and ahead on the valley side.
  const az = viewBearing + THREE.MathUtils.degToRad(38);
  const el = THREE.MathUtils.degToRad(28);
  world.uSunDir.value.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();

  scene.add(makeSky());
  const eye = camBase.clone();
  scene.add(
    makeRidges(eye, [
      { radius: 250, base: eye.y - 15, amp: 9, freq: 5, color: '#24443a', trees: 5, seed: 3, mist: 0.42 },
      { radius: 400, base: eye.y - 2, amp: 15, freq: 4, color: '#284a42', trees: 5, seed: 11, mist: 0.58 },
      { radius: 590, base: eye.y + 18, amp: 24, freq: 3.2, color: '#2d4e4b', trees: 4, seed: 23, mist: 0.7 },
      { radius: 870, base: eye.y + 50, amp: 34, freq: 2.6, color: '#335456', trees: 0, seed: 37, mist: 0.79 },
      { radius: 1320, base: eye.y + 110, amp: 52, freq: 2.2, color: '#3a5c62', trees: 0, seed: 51, mist: 0.86 },
    ]),
  );
  const volcano = makeVolcano(eye, viewBearing + THREE.MathUtils.degToRad(5.5), 1950, 400, '#3b5a66', 0.72);
  scene.add(volcano);
  // a thin plume of ash drifting from the summit
  const summit = volcano.userData.summit as THREE.Vector3;
  const drift = volcano.userData.side as THREE.Vector3;
  for (let i = 0; i < 4; i++) {
    const p = summit.clone().addScaledVector(drift, -40 - i * 95);
    p.y += 30 + i * 34;
    scene.add(makeMist(p, 190 + i * 70, 70 + i * 22, 40 + i * 9.7, '#6b7480', 0.5 - i * 0.07));
  }

  scene.add(terrain.buildMesh(-40, track.length + 30));

  // ---------------------------------------------------------------- forest
  const rnd = rng(20261116);
  const tint = (spread: number) => {
    const v = 1 + (rnd() - 0.5) * spread;
    return new THREE.Color(v * (1 + (rnd() - 0.5) * spread * 0.4), v, v * (1 + (rnd() - 0.5) * spread * 0.4));
  };
  const lists: Record<string, Placement[]> = {};
  // Where a point sits relative to the camera: distance and bearing off the view direction.
  const seenFrom = (p: THREE.Vector3) => {
    const dx = p.x - camBase.x;
    const dz = p.z - camBase.z;
    let bearing = Math.atan2(dx, -dz) - viewBearing;
    bearing = Math.atan2(Math.sin(bearing), Math.cos(bearing));
    return { dist: Math.hypot(dx, dz), bearing };
  };
  // Only plant what this frame can see, or what throws a shadow into it, and swap in
  // light models with distance. The full game will do this per chunk as you run.
  const LOD: [string, string, number, number][] = [
    ['conifer_a', 'conifer_lo', 36, 17 / 19],
    ['conifer_b', 'conifer_lo', 36, 22 / 19],
    ['ginkgo_a', 'ginkgo_lo', 36, 9 / 10],
    ['ginkgo_b', 'ginkgo_lo', 36, 11 / 10],
    ['treefern_a', 'treefern_lo', 30, 3.0 / 3.6],
    ['treefern_b', 'treefern_lo', 30, 4.2 / 3.6],
    ['fern_a', 'fern_lo', 13, 1],
    ['fern_b', 'fern_lo', 13, 1.25],
    ['fern_c', 'fern_lo', 13, 0.8],
  ];
  const add = (name: string, s: number, u: number, scale: number, spread = 0.2, sink = 0.05) => {
    const position = terrain.place(s, u, -sink * scale);
    const { dist, bearing } = seenFrom(position);
    const tall = name.startsWith('conifer') || name.startsWith('ginkgo') || name.startsWith('treefern');
    const inFrame = Math.abs(bearing) < 0.38 && dist < (tall ? 220 : 90);
    const shadesFrame = tall && dist < 45 && bearing > -0.6 && bearing < 1.9;
    if (!inFrame && !shadesFrame && dist > (tall ? 9 : 4)) return;
    const lod = LOD.find((l) => l[0] === name);
    if (lod && (dist > lod[2] || !inFrame)) {
      name = lod[1];
      scale *= lod[3];
    }
    (lists[name] ??= []).push({ position, yaw: rnd() * Math.PI * 2, scale, tint: tint(spread) });
  };
  const HEIGHTS: Record<string, number> = { conifer_a: 17, conifer_b: 22, ginkgo_a: 9, ginkgo_b: 11, treefern_a: 4.2, treefern_b: 5.4 };
  // A slot is kept open ahead so the drop, the valley and the volcano show.
  // Anything in the slot has to stay below the line of sight.
  const blocksView = (name: string, s: number, u: number, scale: number): boolean => {
    const p = terrain.place(s, u);
    const dx = p.x - camBase.x;
    const dz = p.z - camBase.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 15) return false;
    let bearing = Math.atan2(dx, -dz) - viewBearing;
    bearing = Math.atan2(Math.sin(bearing), Math.cos(bearing));
    if (bearing < -0.1 || bearing > 0.22) return false;
    const top = p.y + (HEIGHTS[name] ?? 1) * scale;
    return top > camBase.y - 0.05 * dist - 1.2;
  };
  const tree = (name: string, s: number, u: number, scale: number, spread: number, sink: number) => {
    if (!blocksView(name, s, u, scale)) add(name, s, u, scale, spread, sink);
  };

  const leftBands = [-3.4, -6.8, -11.5, -17, -24, -33, -44];
  const rightBands = [3.6, 7.6, 12.5, 19, 27, 37, 50];
  for (let s = -30; s < track.length + 20; s += 5.2) {
    for (const band of [...leftBands, ...rightBands]) {
      const u = band + (rnd() - 0.5) * Math.abs(band) * 0.35;
      const ss = s + (rnd() - 0.5) * 4.5;
      if (Math.abs(u) < 2.9) continue;
      // keep a window open on the valley side, so the drop and the far ridges show
      if (rnd() > 0.8) continue;
      const pick = rnd();
      const near = Math.abs(u) < 9;
      if (near && pick < 0.3) tree(rnd() < 0.5 ? 'treefern_a' : 'treefern_b', ss, u, 0.85 + rnd() * 0.5, 0.2, 0.1);
      else if (pick < (u > 0 ? 0.46 : 0.36)) tree(rnd() < 0.5 ? 'ginkgo_a' : 'ginkgo_b', ss, u, 0.8 + rnd() * 0.5, 0.18, 0.15);
      else tree(rnd() < 0.5 ? 'conifer_a' : 'conifer_b', ss, u, 0.8 + rnd() * 0.55, 0.16, 0.2);
    }
  }
  // framing trees, placed by hand
  add('conifer_b', HERO_S - 1.0, -3.4, 1.1, 0.05, 0.2);
  add('conifer_a', HERO_S + 10, -4.3, 1.0, 0.05, 0.2);
  add('treefern_b', HERO_S + 4.5, -3.2, 1.0, 0.05, 0.1);
  add('conifer_a', HERO_S + 6, 4.4, 0.95, 0.05, 0.2);
  add('treefern_a', HERO_S + 13.5, 3.3, 0.9, 0.05, 0.1);
  add('ginkgo_b', HERO_S + 19, 5.0, 0.9, 0.05, 0.15);
  // just over the crest: trunks rising from below sell the drop
  add('conifer_b', HERO_S + 27, -4.6, 1.05, 0.05, 0.2);
  add('conifer_a', HERO_S + 31, 7.2, 1.1, 0.05, 0.2);
  add('treefern_b', HERO_S + 24, -3.0, 1.1, 0.05, 0.1);
  add('treefern_a', HERO_S + 26, 3.4, 1.0, 0.05, 0.1);

  for (let i = 0; i < 520; i++) {
    const s = -12 + rnd() * (track.length + 10);
    const side = rnd() < 0.5 ? -1 : 1;
    const u = side * (1.25 + Math.pow(rnd(), 1.9) * 15);
    const name = ['fern_a', 'fern_b', 'fern_c'][Math.floor(rnd() * 3)];
    if (s > camS - 3 && s < HERO_S + 2 && Math.abs(u) < 2.3) continue; // keep the foreground clear
    add(name, s, u, 0.7 + rnd() * 0.9, 0.3, 0.02);
  }
  for (const [cs, cu] of [[9, -1.7], [19, 1.75], [27, -1.8], [41, 1.7], [58, -1.9], [77, 1.8]] as const) {
    for (let i = 0; i < 8; i++) {
      add(rnd() < 0.5 ? 'horsetail_a' : 'horsetail_b', cs + (rnd() - 0.5) * 3.4, cu + Math.sign(cu) * rnd() * 1.4, 0.8 + rnd() * 0.7, 0.2, 0.02);
    }
  }
  for (let i = 0; i < 70; i++) {
    const s = -10 + rnd() * (track.length + 5);
    const u = (rnd() < 0.5 ? -1 : 1) * (1.35 + Math.pow(rnd(), 1.5) * 13);
    const size = 0.5 + rnd() * 1.1;
    // nothing bulky beside the trail, and nothing at all crowding the log: obstacles must read alone
    if (Math.abs(u) < 3.2 && (size > 0.9 || Math.abs(s - (HERO_S + 17)) < 7)) continue;
    add(['rock_a', 'rock_b', 'rock_c'][Math.floor(rnd() * 3)], s, u, size, 0.15, 0.12);
  }
  add('rock_b', HERO_S + 5.5, -2.1, 0.9, 0.05, 0.15);
  add('rock_a', HERO_S + 13.5, 2.0, 0.8, 0.05, 0.12);

  const counts: Record<string, number> = {};
  for (const [name, list] of Object.entries(lists)) {
    const kit = name.startsWith('fern') || name.startsWith('horsetail') || name.startsWith('rock') ? small : trees;
    counts[name] = list.length;
    // The high canopy's shade is painted as dappled light instead of traced, so it can be
    // art-directed per style. Trunks, tree ferns and everything low still cast real shadows.
    const castsShadow = (role: string) => role !== 'foliage_conifer' && role !== 'foliage_ginkgo';
    scene.add(instances(kit, name, list, castsShadow));
  }

  // ---------------------------------------------------------------- the moment
  const orient = (obj: THREE.Object3D, s: number, follow = 1) => {
    const t = track.sample(s);
    const fwd = t.tan.clone();
    fwd.y *= follow;
    fwd.normalize();
    const z = fwd.clone().negate();
    const y = new THREE.Vector3().crossVectors(z, t.right).normalize();
    obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(t.right, y, z));
  };

  // the same rig the game uses, frozen at one moment of its stride
  const rig = new HeroRig(heroModel);
  rig.pose({ phase: 0.93, run: 1, air: 0, airTilt: 0, slide: 0, lean: 0 });
  const hero = new THREE.Group();
  hero.add(rig.root);
  hero.position.copy(terrain.place(HERO_S, 0, 0.005));
  orient(hero, HERO_S, 0.8);
  scene.add(hero);
  const ground = (s: number, u: number, width: number, length: number, strength: number) => {
    const blob = makeContactShadow(width, length, strength);
    blob.position.copy(terrain.place(s, u, 0.02));
    orient(blob, s);
    scene.add(blob);
  };
  ground(HERO_S + 0.08, -0.03, 0.95, 1.35, 0.46);

  const EGG_S = HERO_S + 6.4;
  const egg = instance(props, 'egg');
  const eggScale = 0.56;
  egg.scale.setScalar(eggScale);
  // caught mid-bounce: off the ground and tipped up, so it reads as a solid egg, not a pool
  egg.position.copy(terrain.place(EGG_S, 0.1, 0.4));
  orient(egg, EGG_S);
  egg.rotateZ(-0.85);
  egg.rotateX(0.35);
  egg.rotateY(-0.98); // turn the pecked hole toward the camera
  scene.add(egg);
  materialFor('egg').uniforms.uGlow.value.set('#3fd0c0');
  ground(EGG_S + 0.05, 0.1, 0.7, 0.52, 0.6);
  // dust kicked up where it last hit the trail
  for (let i = 0; i < 3; i++) {
    const puff = makeGlow('#f0d9aa', 0.42 + i * 0.2, 0.15 - i * 0.035);
    puff.position.copy(terrain.place(EGG_S - 0.5 - i * 0.4, 0.1 + (i % 2 ? 0.1 : -0.08), 0.1 + i * 0.05));
    scene.add(puff);
  }

  const LOG_S = HERO_S + 17;
  const log = instance(props, 'log');
  log.position.copy(terrain.place(LOG_S, 0, 0));
  orient(log, LOG_S);
  scene.add(log);

  // amber: a line down the right lane, then an arc that shows the jump over the log
  const amberList: Placement[] = [];
  const amberAt = (s: number, u: number, lift: number) => {
    const p = terrain.place(s, u, lift);
    amberList.push({ position: p, yaw: s * 0.9, scale: 0.19 });
    const glow = makeGlow('#ffb347', 0.8, 0.42);
    glow.position.copy(p);
    scene.add(glow);
  };
  for (let i = 0; i < 5; i++) amberAt(HERO_S + 3.2 + i * 1.55, LANE, 0.34);
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    amberAt(LOG_S - 2.6 + t * 5.2, LANE, 0.34 + Math.sin(Math.PI * t) * 0.62);
  }
  scene.add(instances(props, 'amber', amberList, false));

  // ---------------------------------------------------------------- air
  const sun = world.uSunDir.value;
  for (let i = 0; i < 11; i++) {
    const s = HERO_S + 3 + i * 4.6 + rnd() * 2;
    const u = -1.5 + rnd() * 7;
    const top = terrain.place(s, u, 0).addScaledVector(sun, 30);
    scene.add(makeShaft(top, 33, 1.4 + rnd() * 2.2, rnd() * 50));
  }
  const mistAt: [number, number, number, number, number][] = [
    [HERO_S + 26, 7, 1.5, 34, 7],
    [HERO_S + 38, -4, 2.5, 46, 10],
    [HERO_S + 56, 12, -1, 80, 16],
    [HERO_S + 78, -8, 2, 110, 20],
    [HERO_S + 105, 16, -4, 170, 30],
    [HERO_S + 140, -10, -2, 240, 40],
  ];
  mistAt.forEach(([s, u, lift, w, h], i) => scene.add(makeMist(terrain.place(s, u, lift + h * 0.3), w, h, i * 7.3)));
  // long banks of mist lying in the valley between the ridges
  for (const [r, drop, w, h, seed] of [[130, 22, 300, 30, 1], [215, 24, 520, 44, 2], [330, 22, 800, 60, 3], [500, 14, 1100, 80, 4], [740, -6, 1600, 110, 5]] as const) {
    const p = eye.clone().addScaledVector(viewDir, r);
    p.y = eye.y - drop;
    scene.add(makeMist(p, w, h, seed * 13.1));
  }

  // ---------------------------------------------------------------- camera
  const shadow = new SunShadow(27, 170);
  const focus = terrain.place(HERO_S + 8, 0, 0);
  let shadowDone = false;

  scene.userData.counts = counts;

  return {
    scene,
    camera,
    resize(aspect: number) {
      camera.aspect = aspect;
      // hold the horizontal view steady when the screen is wider than a phone
      const base = 62;
      const phone = 440 / 956;
      camera.fov = aspect <= phone ? base : THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(base / 2)) * Math.min(1, (phone / aspect) * 1.25)));
      camera.updateProjectionMatrix();
    },
    update(time: number, renderer: THREE.WebGLRenderer) {
      world.uTime.value = time;
      // the moment is frozen, but the camera breathes a little so depth reads on a phone
      camera.position.copy(camBase).addScaledVector(camRight, Math.sin(time * 0.35) * 0.07);
      camera.position.y += Math.sin(time * 0.27 + 1) * 0.03;
      camera.lookAt(lookAt);
      camera.updateMatrixWorld();
      if (!shadowDone) {
        shadow.render(renderer, scene, focus);
        shadowDone = true;
      }
    },
  };
}

void fbm;
