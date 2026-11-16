import './style.css';
import * as THREE from 'three';
import { startUpdates } from './app/build';
import { tickFps, watchViewport } from './app/viewport';
import { buildLookdev } from './lookdev/scene';
import { makeViewerUI } from './lookdev/ui';
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
  renderer.autoClear = true;
  const dpr = Math.min(window.devicePixelRatio || 1, Number(params.get('dpr')) || 2);
  renderer.setPixelRatio(dpr);
  stage.appendChild(renderer.domElement);

  const post = new Post(renderer, params.get('msaa') === '0' ? 0 : 4);
  post.enabled = params.get('post') !== '0';

  const view = await buildLookdev();

  let styleIndex = Math.max(0, STYLES.findIndex((s) => s.id === (params.get('style') ?? localStorage.getItem('rr-style'))));
  const pick = (index: number) => {
    styleIndex = index;
    applyStyle(STYLES[index]);
    viewer.setStyle(index);
    document.documentElement.style.background = STYLES[index].ui.panel;
    try {
      localStorage.setItem('rr-style', STYLES[index].id);
    } catch {
      /* private mode */
    }
  };
  boot.remove();
  const viewer = makeViewerUI(ui, STYLES, pick);
  pick(styleIndex);
  if (params.get('clean') === '1') ui.classList.add('clean');

  watchViewport(({ width, height }) => {
    renderer.setSize(width, height, false);
    post.setSize(width, height, dpr);
    view.resize(width / height);
    viewer.refresh();
  });

  const t0 = performance.now();
  let last = t0;
  let sinceReport = 0;
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const time = (now - t0) / 1000;
    tickFps((now - last) / 1000);
    sinceReport += now - last;
    last = now;
    if (sinceReport > 500) {
      sinceReport = 0;
      viewer.refresh();
    }
    view.update(time, renderer);
    post.render(view.scene, view.camera);
  });

  // handy for checking the picture from the console
  Object.assign(window, { rr: { renderer, view, post, pick, STYLES } });
}

start().catch((e) => fail(String(e?.message ?? e)));
