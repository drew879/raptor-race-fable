// The speed test. It draws the run's picture as fast as the phone can, several ways (full
// sharpness, without edge smoothing, without the forest and so on), and lists how long a frame
// takes each way. A screenshot of the list shows exactly what costs the most on a real phone.

import * as THREE from 'three';
import type { RunView } from '../game/run';
import type { Post } from '../render/post';
import { BUILD } from './build';
import { fitLine, isStandalone } from './viewport';

interface Rig {
  renderer: THREE.WebGLRenderer;
  post: Post;
  view: RunView;
  ui: HTMLElement;
  setScale(scale: number): void;
}

interface Case {
  name: string;
  scale?: number;
  samples?: number;
  post?: boolean;
  forest?: boolean;
  shadows?: boolean;
}

const CASES: Case[] = [
  { name: 'as played, full sharpness' },
  { name: 'no edge smoothing', samples: 0 },
  { name: 'no ink and paper pass', post: false },
  { name: 'three quarters sharp', scale: 0.75 },
  { name: 'half sharp', scale: 0.5 },
  { name: 'no forest', forest: false },
  { name: 'no sun shadows', shadows: false },
  { name: 'half sharp, no forest', scale: 0.5, forest: false },
  { name: 'half sharp, no smoothing', scale: 0.5, samples: 0 },
];

export async function runBench(rig: Rig) {
  const { renderer, post, view, ui } = rig;
  renderer.setAnimationLoop(null);
  // the run's own controls stay in the page (its code still talks to them) but out of sight
  for (const el of [...ui.children]) (el as HTMLElement).style.display = 'none';
  const out = document.createElement('pre');
  out.className = 'bench';
  out.textContent = 'Speed test: warming up…';
  ui.appendChild(out);
  const gl = renderer.getContext();
  const px = new Uint8Array(4);
  // reading a pixel back makes the browser wait until everything queued has really been drawn
  const finish = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const st = view.debug.st;
  st.started = true;
  let time = 10;
  const frame = () => {
    time += 1 / 60;
    view.update(time, renderer);
    post.render(view.scene, view.camera);
  };
  const park = (s: number) => {
    st.paused = false;
    st.s = s;
    st.eggS = s + 6;
    for (let i = 0; i < 8; i++) frame(); // let the forest and the camera settle at this spot
    st.paused = true;
  };
  /** Draw flat out for a while. A graphics chip speeds up under load, so short bursts read slow. */
  const drawFor = (ms: number) => {
    const t0 = performance.now();
    let frames = 0;
    do {
      for (let i = 0; i < 6; i++) frame();
      finish();
      frames += 6;
    } while (performance.now() - t0 < ms);
    return (performance.now() - t0) / frames;
  };
  const measure = (s: number) => {
    park(s);
    drawFor(350); // get up to speed first
    return drawFor(600);
  };
  const breathe = () => new Promise((r) => setTimeout(r, 80));
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  // how many separate draw calls one frame takes: the thing a phone's browser charges most for
  park(150);
  renderer.info.reset();
  frame();
  const draws = renderer.info.render.calls;
  renderer.info.reset();
  const lines = [
    `Raptor Race speed test · build ${BUILD}`,
    `${isStandalone() ? 'Home Screen' : 'browser'} · ${size.x}x${size.y} px · screen x${window.devicePixelRatio} · ${draws} draws`,
    fitLine(),
    '',
    'time to draw one frame (60 a second needs under 16.7)',
  ];
  const show = (tail: string) => (out.textContent = `${lines.join('\n')}\n${tail}`);
  await breathe();
  park(150);
  drawFor(500); // the first frames compile shaders; leave them out
  for (const c of CASES) {
    rig.setScale(c.scale ?? 1);
    post.setSamples(c.samples ?? 4);
    post.enabled = c.post ?? true;
    view.debug.forest.visible = c.forest ?? true;
    view.debug.setShadows(c.shadows ?? true);
    show('measuring…');
    await breathe();
    const ms = (measure(150) + measure(330)) / 2;
    lines.push(`${ms.toFixed(1).padStart(6)} ms  ${c.name}`);
  }
  rig.setScale(1);
  post.setSamples(4);
  post.enabled = true;
  view.debug.forest.visible = true;
  view.debug.setShadows(true);
  frame();
  show('\nDone. Please screenshot this and send it to me.');
  const back = document.createElement('a');
  back.href = '?mode=run';
  back.textContent = '\nBack to the run';
  out.appendChild(back);
}
