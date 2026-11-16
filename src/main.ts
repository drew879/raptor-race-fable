import './style.css';
import * as THREE from 'three';
import { runBench } from './app/bench';
import { startUpdates } from './app/build';
import { Quality } from './app/quality';
import { tickFps, watchViewport } from './app/viewport';
import { buildCloseup } from './closeup/scene';
import { buildRun, type RunView } from './game/run';
import { buildHeroLab } from './herolab/scene';
import { buildLookdev, type Lookdev } from './lookdev/scene';
import { makeViewerUI, type ViewerUI } from './lookdev/ui';
import { Post } from './render/post';
import { applyStyle, STYLES } from './render/styles';

startUpdates();

const stage = document.getElementById('stage') as HTMLDivElement;
const ui = document.getElementById('ui') as HTMLDivElement;
const params = new URLSearchParams(location.search);

const boot = document.createElement('div');
boot.className = 'boot';
boot.textContent = 'Loading the forest…';
ui.appendChild(boot);

function fail(message: string) {
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

  const post = new Post(renderer, params.get('msaa') === '0' ? 0 : 4);
  post.enabled = params.get('post') !== '0';

  // which look: the link can ask for one, otherwise the last one used, otherwise Inked Diorama
  const wanted = params.get('style') ?? localStorage.getItem('rr-style2') ?? 'inkdiorama';
  let styleIndex = STYLES.findIndex((s) => s.id === wanted);
  if (styleIndex < 0) styleIndex = STYLES.findIndex((s) => s.id === 'inkdiorama');
  const setStyle = (index: number) => {
    styleIndex = index;
    applyStyle(STYLES[index]);
    document.documentElement.style.background = STYLES[index].ui.panel;
    try {
      localStorage.setItem('rr-style2', STYLES[index].id);
    } catch {
      /* private mode */
    }
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
  // modes: the concept frames (default for now), the rough run, its speed test, the close-up
  // turntable, and a hero test view
  const mode = params.get('mode') ?? 'concept';
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
      quality: () =>
        `${quality.scale < 1 ? `sharpness ${Math.round(quality.scale * 100)}%` : 'full sharpness'} · ${draws} draws` +
        (quality.history() ? `\nsharpness log: ${quality.history()}` : ''),
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

  const t0 = performance.now();
  let last = t0;
  let sinceReport = 0;
  renderer.setAnimationLoop(() => {
    const now = performance.now();
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
