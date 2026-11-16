// Hero lab: the hero on a bare patch of ground, for checking the rig and its poses.
// URL options: cam=side|behind|front|three, state=run|jump|slide|stand, phase=0..1 (freezes the stride),
// slow=<factor>, speed=<meters per second>, travel=0 (run on the spot instead of along the ground).

import * as THREE from 'three';
import { HeroRig, strideLength, type HeroState } from '../hero/rig';
import { world } from '../render/paint';
import { loadSkinned } from '../world/assets';
import { makeContactShadow } from '../world/fx';
import { makeSky } from '../world/sky';
import { Terrain } from '../world/terrain';
import { Track } from '../world/track';
import type { Lookdev } from '../lookdev/scene';

import heroUrl from '../assets/models/caudipteryx.glb?url';

export async function buildHeroLab(params: URLSearchParams): Promise<Lookdev> {
  const model = await loadSkinned(heroUrl);
  const rig = new HeroRig(model);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 0.46, 0.1, 500);

  const track = new Track([{ length: 60 }]);
  const terrain = new Terrain(track, { upSlope: 0.0, downSlope: 0.0 });
  scene.add(makeSky());
  scene.add(terrain.buildMesh(0, 60, 30));
  world.uSunDir.value.set(0.55, 0.6, 0.45).normalize();

  const hero = new THREE.Group();
  hero.add(rig.root);
  hero.position.copy(terrain.place(30, 0, 0));
  scene.add(hero);
  const blob = makeContactShadow(0.9, 1.3, 0.45);
  scene.add(blob);

  const cam = params.get('cam') ?? 'side';
  const eye = new THREE.Vector3();
  if (cam === 'side') eye.set(2.6, 0.55, 0);
  else if (cam === 'behind') eye.set(0, 1.45, 2.6);
  else if (cam === 'front') eye.set(0.9, 0.7, -2.2);
  else eye.set(1.9, 0.9, 1.6);
  const target = new THREE.Vector3(0, 0.42, cam === 'behind' ? -1.5 : 0);

  const fixedPhase = params.has('phase') ? Number(params.get('phase')) : null;
  const mode = params.get('state') ?? 'run';
  const slow = Number(params.get('slow')) || 1;
  const speed = Number(params.get('speed')) || 8;
  const state: HeroState = { phase: 0, speed, run: 1, air: 0, airTilt: 0, slide: 0, lean: 0 };
  // the hero covers real ground, so a foot that slides on the dirt is easy to spot
  const travel = params.get('travel') !== '0' && mode === 'run' && fixedPhase === null;

  return {
    scene,
    camera,
    resize(aspect: number) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    },
    update(time: number) {
      world.uTime.value = time;
      const t = time * slow;
      state.phase = fixedPhase ?? (t * speed) / strideLength(speed);
      hero.position.copy(terrain.place(travel ? 8 + ((t * speed) % 44) : 30, 0, 0));
      blob.position.copy(hero.position).setY(hero.position.y + 0.02);
      state.run = mode === 'stand' ? 0 : 1;
      state.speed = mode === 'stand' ? 0 : speed;
      state.air = mode === 'jump' ? 1 : 0;
      state.airTilt = mode === 'jump' ? Math.sin(t * 2) : 0;
      state.slide = mode === 'slide' ? 1 : 0;
      state.lean = params.has('lean') ? Number(params.get('lean')) : 0;
      rig.pose(state);
      rig.root.position.y = mode === 'jump' ? 0.5 : 0;
      camera.position.copy(hero.position).add(eye);
      camera.lookAt(hero.position.clone().add(target));
    },
  };
}
