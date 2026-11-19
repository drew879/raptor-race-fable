import './style.css';
import * as THREE from 'three';
import { runBench } from './app/bench';
import { startUpdates } from './app/build';
import { makeFront, type Front } from './app/front';
import { makeJournal } from './app/journal';
import { makeResults, type Results } from './app/results';
import { Quality } from './app/quality';
import { tickFps, watchViewport } from './app/viewport';
import { buildCloseup } from './closeup/scene';
import { buildRun, type RunView } from './game/run';
import { buildHeroLab } from './herolab/scene';
import { buildLookdev, type Lookdev } from './lookdev/scene';
import { makeViewerUI, type ViewerUI } from './lookdev/ui';
import { Post, SAMPLES } from './render/post';
import { applyStyle, STYLES } from './render/styles';

startUpdates();

const stage = document.getElementById('stage') as HTMLDivElement;
const ui = document.getElementById('ui') as HTMLDivElement;
const params = new URLSearchParams(location.search);

const boot = document.createElement('div');
boot.className = 'boot';
boot.textContent = 'Loading the forest…';
// The game itself opens on the loading screen and then the home screen. The test views and
// test runs (the links with a mode, or with nopause) go straight in, as before.
let front: Front | null = null;
let results: Results | null = null;
if ((params.get('mode') ?? 'run') === 'run' && !params.has('nopause')) front = makeFront(document.body);
else ui.appendChild(boot);

function fail(message: string) {
  document.querySelector('.front')?.remove();
  document.querySelector('.results')?.remove();
  front = null;
  results = null;
  boot.textContent = `Something went wrong.\n${message}`;
  if (!boot.isConnected) ui.appendChild(boot);
}
window.addEventListener('error', (e) => fail(e.message));
window.addEventListener('unhandledrejection', (e) => fail(String(e.reason)));

async function start() {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  // the paint shaders write finished display colors themselves
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  // Full sharpness is two pixels per point; Quality trims that when the phone can't keep up.
  const fullDpr = Math.min(window.devicePixelRatio || 1, Number(params.get('dpr')) || 2);
  stage.appendChild(renderer.domElement);

  const post = new Post(renderer, params.has('msaa') ? Number(params.get('msaa')) || 0 : SAMPLES);
  post.enabled = params.get('post') !== '0';

  // one look for now (see styles.ts); the link can still ask for another by name if more are added
  let styleIndex = Math.max(0, STYLES.findIndex((s) => s.id === params.get('style')));
  const setStyle = (index: number) => {
    styleIndex = index;
    applyStyle(STYLES[index]);
    document.documentElement.style.background = STYLES[index].ui.panel;
  };
  setStyle(styleIndex);

  // draw calls in the last frame: on a phone this is what costs the most
  let draws = 0;
  renderer.info.autoReset = false;
  // sharpness: set by the link for testing, otherwise looked after automatically
  let size = { width: 2, height: 2 };
  const applySize = () => {
    const dpr = fullDpr * quality.scale;
    renderer.setPixelRatio(dpr);
    renderer.setSize(size.width, size.height, false);
    post.setSize(size.width, size.height, dpr);
  };
  // modes: the rough run (the default), its speed test, the close-up turntable, the old concept
  // frame, and a hero test view
  const mode = params.get('mode') ?? 'run';
  const fixedScale = Number(params.get('scale'));
  const quality = new Quality(applySize, !fixedScale && mode !== 'bench' && params.get('auto') !== '0');
  if (fixedScale) quality.scale = Math.min(1, Math.max(0.25, fixedScale));

  let view: Lookdev;
  let viewer: ViewerUI | null = null;
  if (mode === 'run' || mode === 'bench') {
    view = await buildRun(ui, stage, {
      styles: STYLES,
      styleIndex: () => styleIndex,
      pickStyle: setStyle,
      home: front !== null,
      quality: () =>
        `${quality.scale < 1 ? `sharpness ${Math.round(quality.scale * 100)}%` : 'full sharpness'} · ${draws} draws` +
        (quality.history() ? `\nsharpness log: ${quality.history()}` : ''),
      // Draw a burst of frames flat out and time them, the way the speed test does. A fresh
      // phone takes about 8.6 ms at full sharpness; a warm or nearly flat one takes longer.
      speedNow: () =>
        new Promise((resolve) => {
          setTimeout(() => {
            const gl = renderer.getContext();
            const px = new Uint8Array(4);
            const burst = (n: number) => {
              for (let i = 0; i < n; i++) post.render(view.scene, view.camera);
              gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
            };
            burst(10);
            const t0 = performance.now();
            burst(18);
            const ms = (performance.now() - t0) / 18;
            resolve(`one frame costs ${ms.toFixed(1)} ms right now at ${Math.round(quality.scale * 100)}% sharpness (60 a second needs under 16.7)`);
          }, 350);
        }),
    });
    boot.remove();
  } else if (mode === 'close') {
    view = await buildCloseup(ui, stage, { styles: STYLES, styleIndex: () => styleIndex, pickStyle: setStyle });
    boot.remove();
  } else {
    view = mode === 'hero' ? await buildHeroLab(params) : await buildLookdev();
    boot.remove();
    viewer = makeViewerUI(ui, STYLES, (index) => {
      setStyle(index);
      viewer?.setStyle(index);
    });
    viewer.setStyle(styleIndex);
    if (params.get('clean') === '1') ui.classList.add('clean');
  }
  // styles set uniforms the scene may have just created materials for
  setStyle(styleIndex);

  watchViewport((next) => {
    size = next;
    applySize();
    view.resize(size.width / size.height);
    viewer?.refresh();
    quality.rest();
  });
  document.addEventListener('visibilitychange', () => quality.rest(2000));

  // handy for checking the picture from the console
  Object.assign(window, { rr: { renderer, view, post, setStyle, STYLES, quality } });

  if (mode === 'bench') {
    await runBench({
      renderer,
      post,
      view: view as RunView,
      ui,
      setScale: (scale) => {
        quality.scale = scale;
        applySize();
      },
    });
    return;
  }

  if (front) {
    const run = view as RunView;
    const home = front;
    run.onHome = () => home.showHome();
    run.sound.setMode('home');
    const journal = makeJournal(document.body, { bell: (kind, up) => run.sound.menu(kind, up) });
    // the level's end: the results, and from there another go or (there being no second level yet) home
    const page = makeResults(document.body, {
      again: () => run.play(),
      next: () => run.home(),
      page: () => journal.open(),
      bell: (kind, up) => run.sound.menu(kind, up),
    });
    results = page;
    run.onResults = (result) => page.show(result);
    // one frame drawn now, behind the loading screen, so the frame that builds every shader is not the first one after PLAY
    view.update(0, renderer);
    post.render(view.scene, view.camera);
    void home.ready({
      play: () => run.play(),
      bell: (kind) => run.sound.menu(kind),
      journal: () => journal.open(),
      soundOn: () => run.sound.on,
      setSound: (on) => run.sound.setOn(on),
      recorded: () => run.sound.recorded,
      setRecorded: (on) => run.sound.setRecorded(on),
    });
  }

  const t0 = performance.now();
  let last = t0;
  let sinceReport = 0;
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    // nothing is drawn behind the loading screen, the home screen or the results
    if (front?.up || results?.up) {
      last = now;
      return;
    }
    const time = (now - t0) / 1000;
    tickFps((now - last) / 1000);
    quality.tick(now - last, view.steady?.() ?? true);
    sinceReport += now - last;
    last = now;
    if (sinceReport > 500) {
      sinceReport = 0;
      viewer?.refresh();
    }
    renderer.info.reset();
    view.update(time, renderer);
    post.render(view.scene, view.camera);
    draws = renderer.info.render.calls;
  });
}

start().catch((e) => fail(String(e?.message ?? e)));
