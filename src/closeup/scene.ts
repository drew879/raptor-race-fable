// The close-up: the runner, the egg and the chick on a turntable, for judging them at the
// distance the opening and ending scenes will show them. Drag to spin, pinch to zoom.
//
// Sizes here are true to life. The egg in the chase is drawn several times too big on purpose.

import * as THREE from 'three';
import { BUILD } from '../app/build';
import { blinkAt, HeroRig, strideLength, type HeroState } from '../hero/rig';
import { paintMaterial, world } from '../render/paint';
import { SunShadow } from '../render/shadow';
import type { Style } from '../render/styles';
import { instances, loadKit, loadSkinned, SHADOW_LAYER, type Kit, type Placement } from '../world/assets';
import { makeContactShadow } from '../world/fx';
import { makeSky } from '../world/sky';
import { Terrain } from '../world/terrain';
import { Track } from '../world/track';
import type { Lookdev } from '../lookdev/scene';

import parentUrl from '../assets/models/caudipteryx.glb?url';
import chickUrl from '../assets/models/chick.glb?url';
import propsUrl from '../assets/models/props.glb?url';
import smallUrl from '../assets/models/flora_small.glb?url';

export interface CloseupHooks {
  styles: Style[];
  styleIndex(): number;
  pickStyle(index: number): void;
}

/** Meters. No Caudipteryx egg is known; this is scaled from its relatives' eggs. */
const EGG_LENGTH = 0.08;
/** The chick model is built a little large; a hatchling has to have fitted in that egg. */
const CHICK_SIZE = 0.75;
/** The chick's legs against the parent's, as built in art/hero.py. */
const CHICK_LEGS = 0.145;

const SUBJECTS = ['Runner', 'Egg', 'Chick', 'Family'] as const;
const RUNNER_POSES = ['Stand', 'Run', 'Sit'] as const;
const CHICK_POSES = ['Stand', 'Hatched'] as const;
const CAPTIONS: Record<(typeof SUBJECTS)[number], string> = {
  Runner:
    'Caudipteryx zoui, 70 to 90 cm long. Fourteen banded feathers on each hand, eleven on each side of the tail, and four small teeth at the tip of the beak. All of that is from the fossils.',
  Egg: "About 8 cm long. No Caudipteryx egg has been found, so the size and shape come from its cousins' eggs: long ovals, and one kind has blue-green pigment in the shell.",
  Chick:
    "No chick has been found either. Its cousins' unhatched young had well-formed bones, so chicks were probably up and walking soon after hatching. The down and its colors are our choice: the parent's colors gone soft, with a first hint of the gold collar.",
  Family: 'All three at their true sizes.',
};

interface Animal {
  rig: HeroRig;
  group: THREE.Group;
  state: HeroState;
  /** Where its head is turned now, eased toward where it wants to look. */
  yaw: number;
  pitch: number;
}

function eggMesh(kit: Kit, name: string, crack: number): THREE.Group {
  const group = new THREE.Group();
  for (const part of kit.get(name) ?? []) {
    const mat = paintMaterial('egg');
    mat.uniforms.uCrack.value = crack;
    mat.uniforms.uGlow.value.set('#2a9c90');
    mat.uniforms.uEggNear.value = 1;
    mat.side = THREE.FrontSide;
    const mesh = new THREE.Mesh(part.geometry, mat);
    mesh.layers.enable(SHADOW_LAYER);
    group.add(mesh);
  }
  group.scale.setScalar(EGG_LENGTH);
  return group;
}

export async function buildCloseup(ui: HTMLElement, stage: HTMLElement, hooks: CloseupHooks): Promise<Lookdev> {
  const [parentModel, props, small] = await Promise.all([loadSkinned(parentUrl, true), loadKit(propsUrl), loadKit(smallUrl)]);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 0.46, 0.02, 400);
  const track = new Track([{ length: 60 }]);
  const terrain = new Terrain(track, { upSlope: 0.0, downSlope: 0.0 });
  scene.add(makeSky());
  scene.add(terrain.buildMesh(0, 60, 30));
  world.uSunDir.value.set(-0.5, 0.62, -0.6).normalize();
  const shadow = new SunShadow(2.6, 40);
  const origin = terrain.place(30, 0, 0);

  // a little of the forest floor around the edge, well clear of the subject
  const rnd = (() => {
    let a = 20261116;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();
  const ring: Record<string, Placement[]> = { fern_a: [], fern_b: [], fern_c: [], horsetail_a: [], rock_a: [], rock_c: [] };
  const names = Object.keys(ring);
  for (let i = 0; i < 46; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 2.5 + rnd() * rnd() * 5.5;
    const name = names[Math.floor(rnd() * names.length)];
    const p = origin.clone().add(new THREE.Vector3(Math.sin(a) * r, 0, Math.cos(a) * r));
    ring[name].push({ position: p, yaw: rnd() * 6.28, scale: (name.startsWith('rock') ? 0.5 : 0.75) + rnd() * 0.5 });
  }
  for (const name of names) scene.add(instances(small, name, ring[name], true));

  // ---------------------------------------------------------------- the three subjects
  const animal = (model: Awaited<ReturnType<typeof loadSkinned>>, legs: number, size: number): Animal => {
    const group = new THREE.Group();
    group.add(model.root);
    group.scale.setScalar(size);
    scene.add(group);
    return {
      rig: new HeroRig(model, legs),
      group,
      state: { phase: 0, speed: 0, run: 0, air: 0, airTilt: 0, slide: 0, lean: 0 },
      yaw: 0,
      pitch: 0,
    };
  };
  const parent = animal(parentModel, 1, 1);
  // the chick is fetched the first time it is wanted
  let chick: Animal | null = null;
  let chickLoad: Promise<void> | null = null;

  const egg = eggMesh(props, 'egg_true', 0);
  const cup = eggMesh(props, 'eggshell_cup', 0);
  const cap = eggMesh(props, 'eggshell_cap', 0);
  scene.add(egg, cup, cap);
  const blob = makeContactShadow(0.9, 1.3, 0.3);
  scene.add(blob);

  // ---------------------------------------------------------------- what is on show
  let subject = 0;
  let runnerPose = 0;
  let chickPose = 0;
  const cam = { yaw: Math.PI - 0.7, pitch: 0.2, dist: 2.5, target: new THREE.Vector3(), zoom: 1, touched: -1e9 };
  const want = { dist: 2.5, height: 0.4 };
  const at = (x: number, y: number, z: number) => origin.clone().add(new THREE.Vector3(x, y, z));

  function showChick() {
    if (!chickLoad) {
      chickLoad = loadSkinned(chickUrl, true).then((model) => {
        if (model.eye) model.eye.uniforms.uLid.value.set(0.05, 0.04, 0.035);
        chick = animal(model, CHICK_LEGS, CHICK_SIZE);
        hooks.pickStyle(hooks.styleIndex()); // new materials take the current look
        arrange();
      });
    }
    arrange();
  }

  /** Put everything where the current choice wants it, and hide the rest. */
  function arrange() {
    const name = SUBJECTS[subject];
    const family = name === 'Family';
    parent.group.visible = name === 'Runner' || family;
    parent.group.position.copy(origin);
    parent.group.rotation.y = 0;
    const sitting = name === 'Runner' && RUNNER_POSES[runnerPose] === 'Sit';
    const hatching = name === 'Chick' && CHICK_POSES[chickPose] === 'Hatched';

    egg.visible = name === 'Egg' || family || sitting;
    cup.visible = cap.visible = hatching;
    // the egg lies on its side, as an egg does
    egg.rotation.set(0, 0.5, Math.PI / 2 - 0.08);
    const eggRest = 0.226 * EGG_LENGTH * 0.98;
    if (name === 'Egg') egg.position.copy(at(0, eggRest, 0));
    else if (sitting) egg.position.copy(at(0.03, eggRest, -0.4));
    else egg.position.copy(at(0.3, eggRest, -0.22));

    if (chick) {
      chick.group.visible = name === 'Chick' || family;
      if (family) {
        chick.group.position.copy(at(0.36, 0, -0.42));
        chick.group.rotation.y = -2.2;
      } else if (hatching) {
        chick.group.position.copy(at(-0.02, 0, 0.01));
        chick.group.rotation.y = 0.25;
      } else {
        chick.group.position.copy(origin);
        chick.group.rotation.y = 0;
      }
    }
    // just out of the egg: the two pieces of shell lie where they fell, beside the chick
    const shellRest = 0.226 * EGG_LENGTH * 0.96;
    cup.position.copy(at(0.062, shellRest, -0.012));
    cup.rotation.set(0.1, -0.9, Math.PI / 2 + 0.12);
    cap.position.copy(at(0.03, shellRest * 0.82, -0.085));
    cap.rotation.set(-0.5, 0.7, Math.PI / 2 - 0.5);

    const running = name === 'Runner' && RUNNER_POSES[runnerPose] === 'Run';
    if (name === 'Runner') Object.assign(want, { dist: sitting ? 2.1 : running ? 3.1 : 2.5, height: sitting ? 0.3 : 0.42 });
    else if (name === 'Egg') Object.assign(want, { dist: 0.5, height: 0.03 });
    else if (name === 'Chick') Object.assign(want, { dist: 0.62, height: 0.055 });
    else Object.assign(want, { dist: 2.7, height: 0.36 });
    blob.visible = false;
    refreshUi();
  }

  // ---------------------------------------------------------------- controls
  ui.classList.remove('clean');
  ui.innerHTML = `
    <div class="closeup-cap"></div>
    <div class="picker closeup">
      <div class="row"><div class="tabs words subjects"></div></div>
      <div class="row opt-row"><span class="lbl"></span><div class="tabs words opts"></div></div>
      <div class="row look-row"><span class="lbl">Look</span><div class="tabs looks"></div></div>
      <div class="foot"><span>Drag to spin. Pinch to zoom.</span><a class="back" href="?mode=run">Back to the run</a><span>build ${BUILD}</span></div>
    </div>`;
  const q = <T extends HTMLElement>(sel: string) => ui.querySelector(sel) as T;
  const caption = q('.closeup-cap');
  const fill = (el: HTMLElement, labels: readonly string[], pick: (i: number) => void) => {
    el.innerHTML = '';
    labels.forEach((label, i) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        pick(i);
      });
      el.appendChild(b);
    });
  };
  const mark = (el: HTMLElement, index: number) => [...el.children].forEach((c, i) => c.classList.toggle('on', i === index));
  fill(q('.subjects'), SUBJECTS, (i) => {
    subject = i;
    if (SUBJECTS[i] === 'Chick' || SUBJECTS[i] === 'Family') showChick();
    cam.zoom = 1;
    arrange();
  });
  fill(q('.looks'), hooks.styles.map((s) => s.tab), (i) => {
    hooks.pickStyle(i);
    refreshUi();
  });

  function refreshUi() {
    const name = SUBJECTS[subject];
    mark(q('.subjects'), subject);
    mark(q('.looks'), hooks.styleIndex());
    q('.look-row').hidden = hooks.styles.length < 2;
    const optRow = q('.opt-row');
    const opts = q('.opts');
    optRow.hidden = !(name === 'Runner' || name === 'Chick');
    if (name === 'Runner') {
      q('.opt-row .lbl').textContent = 'Pose';
      fill(opts, RUNNER_POSES, (i) => {
        runnerPose = i;
        arrange();
      });
      mark(opts, runnerPose);
    } else if (name === 'Chick') {
      q('.opt-row .lbl').textContent = 'Pose';
      fill(opts, CHICK_POSES, (i) => {
        chickPose = i;
        arrange();
      });
      mark(opts, chickPose);
    }
    const loading = (name === 'Chick' || name === 'Family') && !chick;
    caption.textContent = (loading ? 'Loading the chick…\n' : '') + CAPTIONS[name];
    const style = hooks.styles[hooks.styleIndex()];
    ui.style.setProperty('--ui-ink', style.ui.ink);
    ui.style.setProperty('--ui-panel', style.ui.panel);
    ui.style.setProperty('--ui-accent', style.ui.accent);
    ui.style.setProperty('--ui-text', style.ui.text);
  }

  // drag to spin and tilt, pinch or scroll to zoom
  const touches = new Map<number, { x: number; y: number }>();
  let pinch = 0;
  stage.addEventListener('pointerdown', (e) => {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      stage.setPointerCapture(e.pointerId);
    } catch {
      /* the pointer has already gone; nothing to hold on to */
    }
    pinch = 0;
  });
  stage.addEventListener('pointermove', (e) => {
    const t = touches.get(e.pointerId);
    if (!t) return;
    const dx = e.clientX - t.x;
    const dy = e.clientY - t.y;
    t.x = e.clientX;
    t.y = e.clientY;
    cam.touched = performance.now();
    if (touches.size === 1) {
      cam.yaw -= dx * 0.008;
      cam.pitch = THREE.MathUtils.clamp(cam.pitch + dy * 0.005, 0.03, 0.9);
    } else if (touches.size === 2) {
      const [a, b] = [...touches.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch > 0) cam.zoom = THREE.MathUtils.clamp(cam.zoom * (pinch / d), 0.35, 1.6);
      pinch = d;
    }
  });
  const lift = (e: PointerEvent) => {
    touches.delete(e.pointerId);
    pinch = 0;
  };
  stage.addEventListener('pointerup', lift);
  stage.addEventListener('pointercancel', lift);
  stage.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      cam.zoom = THREE.MathUtils.clamp(cam.zoom * Math.exp(e.deltaY * 0.0015), 0.35, 1.6);
      cam.touched = performance.now();
    },
    { passive: false },
  );

  // ---------------------------------------------------------------- each frame
  const toCam = new THREE.Vector3();
  let last = -1;
  /** Idle life: breathing, blinking, a glance at whoever is looking, now and then a call. */
  function live(a: Animal, time: number, dt: number, seed: number, opts: { sit?: number; run?: boolean; down?: number }) {
    const s = a.state;
    s.idle = time + seed * 10;
    s.blink = blinkAt(time, seed);
    s.sit = opts.sit ?? 0;
    if (opts.run) {
      s.run = 1;
      s.speed = 8;
      s.phase += (8 * dt) / strideLength(8);
      a.yaw += (0 - a.yaw) * Math.min(1, dt * 6);
      a.pitch += (0 - a.pitch) * Math.min(1, dt * 6);
      s.beak = 0;
    } else {
      s.run = 0;
      s.speed = 0;
      // turn the head toward the camera when it is somewhere in front, else look about
      toCam.copy(camera.position).sub(a.group.position);
      const local = Math.atan2(-toCam.x, -toCam.z) - a.group.rotation.y;
      const bearing = Math.atan2(Math.sin(local), Math.cos(local));
      const wander = Math.sin(time * 0.37 + seed * 5) * 0.35 + Math.sin(time * 0.83 + seed * 9) * 0.15;
      const yawTo = Math.abs(bearing) < 1.9 ? THREE.MathUtils.clamp(-bearing, -1.05, 1.05) * 0.85 + wander * 0.25 : wander;
      const pitchTo = (opts.down ?? 0) + Math.sin(time * 0.51 + seed * 3) * 0.06;
      a.yaw += (yawTo - a.yaw) * Math.min(1, dt * 2.2);
      a.pitch += (pitchTo - a.pitch) * Math.min(1, dt * 2.2);
      const call = (time * 0.21 + seed * 0.37) % 1;
      s.beak = call < 0.035 ? Math.sin((call / 0.035) * Math.PI) * 0.7 : 0;
    }
    s.lookYaw = a.yaw;
    s.lookPitch = a.pitch;
    a.rig.pose(s);
  }

  arrange();
  return {
    scene,
    camera,
    resize(aspect: number) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    },
    update(time: number, renderer: THREE.WebGLRenderer) {
      const dt = last < 0 ? 0 : Math.min(0.05, Math.max(0, time - last));
      last = time;
      world.uTime.value = time;
      const name = SUBJECTS[subject];

      // the camera drifts round by itself until someone takes hold of it
      if (performance.now() - cam.touched > 5000) cam.yaw += dt * 0.22;
      cam.dist += (want.dist * cam.zoom - cam.dist) * Math.min(1, dt * 5);
      cam.target.lerp(at(0, want.height, 0), Math.min(1, dt * 5));
      // a tall phone screen is narrow: step back so a long animal still fits across it
      const fit = Math.max(1, 0.46 / camera.aspect) ** 0.5;
      const d = cam.dist * (name === 'Runner' || name === 'Family' ? fit : 1);
      camera.position.set(
        cam.target.x + Math.sin(cam.yaw) * Math.cos(cam.pitch) * d,
        cam.target.y + Math.sin(cam.pitch) * d,
        cam.target.z + Math.cos(cam.yaw) * Math.cos(cam.pitch) * d,
      );
      camera.lookAt(cam.target);

      if (parent.group.visible) {
        const pose = name === 'Runner' ? RUNNER_POSES[runnerPose] : 'Stand';
        live(parent, time, dt, 0, { sit: pose === 'Sit' ? 1 : 0, run: pose === 'Run', down: pose === 'Sit' ? -0.5 : name === 'Family' ? -0.25 : 0 });
      }
      if (chick && chick.group.visible) {
        const hatching = name === 'Chick' && CHICK_POSES[chickPose] === 'Hatched';
        live(chick, time, dt, 0.61, { sit: hatching ? 1 : 0, down: name === 'Family' ? 0.35 : 0.1 });
      }
      shadow.render(renderer, scene, origin);
    },
  };
}
