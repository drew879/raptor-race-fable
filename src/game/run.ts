// The rough playable run: one runner, one trail, an egg to chase.
// Everything that moves is driven from here; the world pieces come from src/world.

import * as THREE from 'three';
import { setReloadGuard } from '../app/build';
import { HeroRig, type HeroState } from '../hero/rig';
import type { Lookdev } from '../lookdev/scene';
import { world } from '../render/paint';
import { SunShadow } from '../render/shadow';
import type { Style } from '../render/styles';
import { instance, instances, loadKit, loadSkinned, materialFor, SHADOW_LAYER, type Placement } from '../world/assets';
import { makeContactShadow, makeGlowField, makeMist, makeShaft } from '../world/fx';
import { rng, smoothstep } from '../world/noise';
import { makeRidges, makeSky, makeVolcano } from '../world/sky';
import { Terrain } from '../world/terrain';
import { Track } from '../world/track';
import { AMBER, DEFAULT_SPEED, END_S, HINTS, LANE, OBSTACLES, SEGMENTS, START_SLOPE, VISTAS, type Obstacle } from './course';
import { Flora } from './flora';
import { makeHud } from './hud';
import { listenForMoves, type Move } from './input';

import treesUrl from '../assets/models/flora_trees.glb?url';
import smallUrl from '../assets/models/flora_small.glb?url';
import propsUrl from '../assets/models/props.glb?url';
import heroUrl from '../assets/models/caudipteryx.glb?url';

export interface RunHooks {
  styles: Style[];
  styleIndex(): number;
  pickStyle(index: number): void;
  /** A short note on how sharp the picture is being drawn right now. */
  quality?(): string;
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
const STRIDE = 1.9; // meters per full stride
const JUMP_HEIGHT = 0.72;
const JUMP_TIME = 0.56;
const GRAVITY = (8 * JUMP_HEIGHT) / (JUMP_TIME * JUMP_TIME);
const JUMP_V = (GRAVITY * JUMP_TIME) / 2;
const SLIDE_TIME = 0.62;
const EGG_SCALE = 0.56;
const EGG_R = 0.275 * EGG_SCALE; // half its width
const EGG_HALF = 0.5 * EGG_SCALE; // half its length
const EGG_G = 9.5;
/** How the egg travels: 0 steady end over end, 1 wobbling, 2 wobbling with bounces that depend on how it lands. */
export const EGG_MODES = ['Steady', 'Wobbly', 'Lively'];

// how far along the trail each kind of obstacle can catch you
const DEPTH: Record<Obstacle['kind'], number> = { log: 0.3, arch: 0.45, boulder: 0.42, tree: 0.26 };

export async function buildRun(ui: HTMLElement, stage: HTMLElement, hooks: RunHooks): Promise<RunView> {
  const [trees, small, props, heroModel] = await Promise.all([
    loadKit(treesUrl),
    loadKit(smallUrl),
    loadKit(propsUrl),
    loadSkinned(heroUrl),
  ]);

  const testing = new URLSearchParams(location.search).has('nopause'); // test runs only
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, 0.46, 0.3, 2500);
  const track = new Track(SEGMENTS, START_SLOPE);
  const terrain = new Terrain(track);
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
  const summit = volcano.userData.summit as THREE.Vector3;
  const drift = volcano.userData.side as THREE.Vector3;
  for (let i = 0; i < 4; i++) {
    const p = summit.clone().addScaledVector(drift, -40 - i * 95);
    p.y += 30 + i * 34;
    far.add(makeMist(p, 190 + i * 70, 70 + i * 22, 40 + i * 9.7, '#6b7480', 0.5 - i * 0.07));
  }
  scene.add(far);

  // ---------------------------------------------------------------- ground and forest
  const ground = terrain.buildSections(-40, track.length + 40);
  scene.add(ground);
  // three worn tracks with a broken seam of moss between them, so the lanes read without painted lines
  terrain.material.uniforms.uLanes.value.set(LANE, 1, 0.08, 0);
  const flora = new Flora(terrain, trees, small, {
    length: track.length,
    vistas: VISTAS,
    keepClear: OBSTACLES.map((o) => o.s),
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
  const byModel: Record<string, Placement[]> = { log: [], arch: [], boulder: [], lane_tree: [] };
  for (const o of OBSTACLES) {
    if (o.kind === 'log' || o.kind === 'arch') {
      byModel[o.kind].push({ position: terrain.place(o.s, 0, 0), yaw: 0, scale: 1, tilt: basisAt(o.s) });
    } else {
      for (const lane of o.lanes) {
        const upright = basisAt(o.s, 0); // boulders and trees stand straight on a slope
        byModel[o.kind === 'tree' ? 'lane_tree' : 'boulder'].push({
          position: terrain.place(o.s, lane * LANE, -0.04),
          yaw: 0,
          scale: o.kind === 'tree' ? 1 : 0.92 + rnd() * 0.12,
          tilt: upright.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28)),
        });
      }
    }
  }
  for (const [name, list] of Object.entries(byModel)) scene.add(instances(props, name, list, true));

  // ---------------------------------------------------------------- amber
  // Pieces are grouped into batches along the trail, so only the ones near the runner are drawn.
  const AMBER_BATCH = 40; // meters of trail per batch
  const amberPos = AMBER.map((a) => terrain.place(a.s, a.lane * LANE, a.lift));
  const batches: { s0: number; s1: number; first: number; mesh: THREE.InstancedMesh; glow: THREE.InstancedMesh }[] = [];
  const batchOf: number[] = [];
  for (let first = 0; first < AMBER.length; ) {
    let end = first;
    while (end < AMBER.length && AMBER[end].s < AMBER[first].s + AMBER_BATCH) end++;
    const list = amberPos.slice(first, end).map((position) => ({ position, yaw: 0, scale: 0.19 }));
    const mesh = instances(props, 'amber', list, false).children[0] as THREE.InstancedMesh;
    mesh.frustumCulled = false;
    const glow = makeGlowField(list.length, '#ffb347', 0.4);
    scene.add(mesh, glow);
    for (let i = first; i < end; i++) batchOf.push(batches.length);
    batches.push({ s0: AMBER[first].s, s1: AMBER[end - 1].s, first, mesh, glow });
    first = end;
  }
  const m4 = new THREE.Matrix4();
  const qI = new THREE.Quaternion();
  const v3 = new THREE.Vector3();
  const showAmber = (i: number, on: boolean) => {
    const b = batches[batchOf[i]];
    const k = i - b.first;
    const s = on ? 1 : 0;
    b.mesh.setMatrixAt(k, m4.compose(amberPos[i], qI, v3.setScalar(0.19 * s)));
    b.glow.setMatrixAt(k, m4.compose(amberPos[i], qI, v3.setScalar(0.8 * s)));
    b.mesh.instanceMatrix.needsUpdate = true;
    b.glow.instanceMatrix.needsUpdate = true;
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
  const mists: { mesh: THREE.Mesh; s: number; u: number; lift: number }[] = [];
  const MIST_GAP = 34;
  for (let i = 0; i < 7; i++) {
    const w = 34 + (i % 3) * 22;
    const h = 7 + (i % 3) * 4;
    const mesh = makeMist(new THREE.Vector3(), w, h, i * 7.3);
    scene.add(mesh);
    mists.push({ mesh, s: 28 + i * MIST_GAP, u: i % 2 ? 7 : -5, lift: 1.5 + h * 0.3 });
  }
  const shafts: { mesh: THREE.Mesh; s: number; u: number }[] = [];
  const SHAFT_GAP = 11;
  for (let i = 0; i < 10; i++) {
    const mesh = makeShaft(new THREE.Vector3(), 33, 1.4 + rnd() * 2.2, rnd() * 50);
    scene.add(mesh);
    shafts.push({ mesh, s: 10 + i * SHAFT_GAP, u: -1.5 + rnd() * 7 });
  }
  const placeAir = () => {
    for (const m of mists) m.mesh.position.copy(terrain.place(m.s, m.u, m.lift));
    for (const sh of shafts) sh.mesh.position.copy(terrain.place(sh.s, sh.u, 0)).addScaledVector(sun, 30);
  };
  const valleyMist: { mesh: THREE.Mesh; r: number; drop: number }[] = [];
  for (const [r, drop, w, h, seed] of [[130, 22, 300, 30, 1], [215, 24, 520, 44, 2], [330, 22, 800, 60, 3], [500, 14, 1100, 80, 4], [740, -6, 1600, 110, 5]] as const) {
    const mesh = makeMist(new THREE.Vector3(), w, h, seed * 13.1);
    scene.add(mesh);
    valleyMist.push({ mesh, r, drop });
  }

  const shadow = new SunShadow(27, 170);
  let shadowsOn = true;

  // ---------------------------------------------------------------- state
  const obstacles = OBSTACLES.map((o) => ({ ...o, hit: false }));
  const archAt = OBSTACLES.filter((o) => o.kind === 'arch').map((o) => o.s);
  const collected: boolean[] = AMBER.map(() => false);
  let baseSpeed = Number(localStorage.getItem('rr-speed2')) || DEFAULT_SPEED;
  const savedEgg = localStorage.getItem('rr-egg');
  let eggMode = savedEgg === null ? 2 : THREE.MathUtils.clamp(Number(savedEgg) || 0, 0, 2);
  // the egg's turn, in the trail's own frame (x across to the right, y up, z back up the trail)
  const eggQ = new THREE.Quaternion();
  const eggAxis = new THREE.Vector3();
  const eggTurn = new THREE.Quaternion();
  const eggLong = new THREE.Vector3();
  const st = {
    s: START_S,
    lane: 0,
    u: 0,
    y: 0,
    vy: 0,
    slideT: 0,
    stumbleT: 0,
    safeT: 0,
    speed: 0,
    phase: 0,
    air: 0,
    slide: 0,
    camU: 0,
    camDuck: 0,
    started: false,
    gap: 9,
    eggS: START_S + 9,
    eggY: 0,
    eggVy: 0,
    eggSpin: 0,
    eggKick: 0,
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
  const heroState: HeroState = { phase: 0, run: 1, air: 0, airTilt: 0, slide: 0, lean: 0 };

  const hud = makeHud(ui, {
    styles: hooks.styles,
    styleIndex: hooks.styleIndex(),
    speed: baseSpeed,
    quality: hooks.quality,
    eggModes: EGG_MODES,
    eggMode,
    onEgg: (mode) => {
      eggMode = mode;
      try {
        localStorage.setItem('rr-egg', String(mode));
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
      s: START_S, lane: 0, u: 0, y: 0, vy: 0, slideT: 0, stumbleT: 0, safeT: 0, speed: 0, phase: 0, air: 0,
      slide: 0, camU: 0, camDuck: 0, gap: 9, eggS: START_S + 9, eggY: 0, eggVy: 0, eggSpin: 0, eggKick: 0, amber: 0, paused: false,
      finished: false, queued: null, queuedT: 0, hint: 0, hintT: 0,
    });
    eggQ.setFromAxisAngle(v3.set(1, 0, 0), -0.5); // tipped a little forward, about to roll
    for (const o of obstacles) o.hit = false;
    for (let i = 0; i < collected.length; i++) {
      collected[i] = false;
      showAmber(i, true);
    }
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

  function act(move: Move) {
    if (st.paused || st.finished || !st.started) return;
    if (move === 'left') st.lane = Math.max(-1, st.lane - 1);
    else if (move === 'right') st.lane = Math.min(1, st.lane + 1);
    else if (move === 'up') {
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
    const wander = eggMode === 0 ? 0 : 1;
    // lean the axis the way the egg is drifting across the trail, and tip it slowly up and down
    eggAxis.set(-1, wander * 0.32 * Math.sin(st.eggS * 0.137 + 0.4), wander * -0.45 * Math.cos(st.eggS * 0.13)).normalize();
    const wanted = rolling ? st.speed * 1.5 * (1 + st.eggKick) : 0;
    st.eggSpin += (wanted - st.eggSpin) * Math.min(1, dt * (rolling ? 8 : 3));
    st.eggKick = Math.max(0, st.eggKick - dt * 1.6);
    eggQ.premultiply(eggTurn.setFromAxisAngle(eggAxis, st.eggSpin * dt)).normalize();

    if (!rolling && st.eggY <= 0) return;
    st.eggVy -= EGG_G * dt;
    st.eggY += st.eggVy * dt;
    if (st.eggY <= 0) {
      st.eggY = 0;
      st.eggVy = 0;
      if (rolling) {
        // how upright the egg is as it lands: 1 on an end, 0 flat on its side
        const onEnd = Math.abs(eggLong.set(0, 1, 0).applyQuaternion(eggQ).y);
        const height = eggMode === 2 ? 0.1 + 0.32 * onEnd * onEnd : 0.2;
        st.eggVy = Math.sqrt(2 * EGG_G * height);
        if (eggMode === 2) st.eggKick = 0.5 * onEnd * onEnd;
      }
    }
  }

  function stumble() {
    st.stumbleT = 0.9;
    st.safeT = 1.3;
    st.gap += 3.2;
  }

  function step(dt: number) {
    st.clock += dt;
    const ending = st.s > END_S - 9;
    const target = st.finished ? 0 : baseSpeed * (st.stumbleT > 0 ? 0.5 : 1) * (ending ? THREE.MathUtils.clamp((END_S - 1.0 - st.s) / 8, 0.12, 1) : 1);
    st.speed += (target - st.speed) * Math.min(1, dt * (st.speed < target ? 2.2 : 6));
    st.s += st.speed * dt;
    st.phase += (st.speed * dt) / STRIDE;
    st.stumbleT = Math.max(0, st.stumbleT - dt);
    st.safeT = Math.max(0, st.safeT - dt);

    // side to side
    st.u += (st.lane * LANE - st.u) * (1 - Math.exp(-dt / 0.055));

    // up and down
    if (st.y > 0) {
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
    if (st.safeT <= 0) {
      for (const o of obstacles) {
        if (o.hit || Math.abs(o.s - st.s) > DEPTH[o.kind]) continue;
        let hit = false;
        if (o.kind === 'log') hit = st.y < 0.3;
        else if (o.kind === 'arch') hit = st.slide < 0.5;
        else hit = o.lanes.some((lane) => Math.abs(st.u - lane * LANE) < 0.4);
        if (hit) {
          o.hit = true;
          stumble();
          break;
        }
      }
    }

    // amber
    for (let i = 0; i < AMBER.length; i++) {
      if (collected[i]) continue;
      const a = AMBER[i];
      if (a.s < st.s - 1) continue;
      if (a.s > st.s + 1) break;
      if (Math.abs(a.s - st.s) < 0.55 && Math.abs(st.u - a.lane * LANE) < 0.42 && Math.abs(st.y + 0.3 - a.lift) < 0.6) {
        collected[i] = true;
        showAmber(i, false);
        st.amber++;
        hud.setAmber(st.amber);
      }
    }

    // the egg: clean running closes the gap, a stumble lets it roll further ahead
    if (st.stumbleT <= 0) st.gap = Math.max(4.8, st.gap - 0.28 * dt);
    st.gap = Math.min(st.gap, 17);
    const wanted = Math.min(st.s + st.gap, END_S);
    st.eggS += (wanted - st.eggS) * Math.min(1, dt * 3);
    rollEgg(dt, st.eggS < END_S - 0.05);
    hud.warn(st.gap > 12.5 && !st.finished);

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
      hud.showFinish(st.amber, AMBER.length);
    }
  }

  const tmp = new THREE.Vector3();
  const look = new THREE.Vector3();
  function draw(renderer: THREE.WebGLRenderer) {
    // hero
    hero.position.copy(terrain.place(st.s, st.u, st.y + 0.005));
    hero.quaternion.copy(basisAt(st.s, 0.8));
    const wobble = st.stumbleT > 0 ? Math.sin(st.clock * 34) * 0.35 * (st.stumbleT / 0.9) : 0;
    heroState.phase = st.phase;
    heroState.run = Math.min(1, st.speed / 3);
    heroState.air = st.air;
    heroState.airTilt = THREE.MathUtils.clamp(st.vy / JUMP_V, -1, 1);
    heroState.slide = Math.max(st.slide, st.stumbleT > 0.55 ? 0.3 : 0);
    heroState.lean = THREE.MathUtils.clamp((st.lane * LANE - st.u) / LANE, -1, 1) + wobble;
    rig.pose(heroState);
    heroShadow.position.copy(terrain.place(st.s + 0.08, st.u, 0.02));
    heroShadow.quaternion.copy(basisAt(st.s));
    heroShadow.scale.setScalar(1 + st.y * 0.5);
    (heroShadow.material as THREE.ShaderMaterial).uniforms.uStrength.value = 0.46 * (1 - Math.min(0.6, st.y * 0.6));

    // egg: bouncing and tumbling down the trail ahead
    // it weaves between the lanes, so it never sits on top of a line of amber
    const eggU = Math.sin(st.eggS * 0.13) * 0.36;
    // an egg standing on its end rides higher than one lying on its side
    const up = eggLong.set(0, 1, 0).applyQuaternion(eggQ).y;
    const rest = Math.sqrt(EGG_HALF * EGG_HALF * up * up + EGG_R * EGG_R * (1 - up * up));
    egg.position.copy(terrain.place(st.eggS, eggU, rest + 0.015 + st.eggY));
    egg.quaternion.copy(basisAt(st.eggS)).multiply(eggQ);
    eggShadow.position.copy(terrain.place(st.eggS + 0.04, eggU, 0.02));
    eggShadow.quaternion.copy(basisAt(st.eggS));
    (eggShadow.material as THREE.ShaderMaterial).uniforms.uStrength.value = 0.55 * (1 - Math.min(0.75, st.eggY * 1.6));

    // camera: behind and above, easing sideways with the hero, looking well down the trail
    st.camU += (st.u * 0.7 - st.camU) * 0.12;
    const camS = st.s - 2.6;
    // the camera ducks under an arch a moment after the hero does
    let duck = 0;
    for (const a of archAt) duck = Math.max(duck, 1 - smoothstep(1.0, 3.6, Math.abs(a - camS)));
    st.camDuck += (duck - st.camDuck) * 0.3;
    camera.position.copy(terrain.place(camS, st.camU, 1.45 + st.y * 0.22 - 1.05 * st.camDuck));
    if (st.stumbleT > 0) {
      const k = (st.stumbleT / 0.9) * 0.05;
      camera.position.x += Math.sin(st.clock * 47) * k;
      camera.position.y += Math.cos(st.clock * 53) * k;
    }
    terrain.place(st.s + 13, st.u * 0.3, 0.5 - 0.2 * st.camDuck, look);
    camera.lookAt(look);
    camera.updateMatrixWorld();

    // the far world rides along; the valley's mist layer stays below you as you descend
    far.position.set(camera.position.x - eye0.x, (camera.position.y - eye0.y) * 0.45, camera.position.z - eye0.z);
    world.uFog.value.y = camera.position.y + hooks.styles[hooks.styleIndex()].fog.base;
    const ahead = track.sample(st.s + 40).tan.clone().setY(0).normalize();
    for (const v of valleyMist) {
      v.mesh.position.copy(camera.position).addScaledVector(ahead, v.r);
      v.mesh.position.y = camera.position.y - v.drop;
    }
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
    for (const part of ground.children) part.visible = part.userData.s1 > st.s - 8 && part.userData.s0 < st.s + 330;
    for (const b of batches) b.mesh.visible = b.glow.visible = b.s1 > st.s - 4 && b.s0 < st.s + 150;
    if (shadowsOn && st.frame % 5 === 0) shadow.render(renderer, scene, terrain.place(st.s + 14, 0, 0, tmp));
    st.frame++;
  }

  reset();
  // for testing from the console: read the state, make moves, pause, start over
  Object.assign(window, { rrGame: { st, act, setPaused, reset, obstacles, collected, DEPTH } });
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
