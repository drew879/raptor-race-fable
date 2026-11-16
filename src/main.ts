import './style.css';
import * as THREE from 'three';
import { BUILD, startUpdates } from './app/build';
import { watchViewport, viewportReport } from './app/viewport';

startUpdates();

const stage = document.getElementById('stage') as HTMLDivElement;
const ui = document.getElementById('ui') as HTMLDivElement;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#16211f');
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
camera.position.set(0, 0.4, 3);

const egg = new THREE.Mesh(
  new THREE.SphereGeometry(0.6, 48, 32).scale(0.78, 1, 0.78),
  new THREE.MeshStandardMaterial({ color: '#5fb8a8', roughness: 0.6 }),
);
scene.add(egg);
scene.add(new THREE.HemisphereLight('#cfe8e0', '#3a2f22', 1.2));
const sun = new THREE.DirectionalLight('#ffd9a0', 2.2);
sun.position.set(2, 3, 2);
scene.add(sun);

const badge = document.createElement('pre');
badge.style.cssText =
  'position:absolute;left:calc(12px + var(--sal));bottom:calc(10px + var(--sab));margin:0;' +
  'font:12px/1.35 ui-monospace,Menlo,monospace;color:#f3ead8;opacity:.75;pointer-events:none';
ui.appendChild(badge);

watchViewport(({ width, height }) => {
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  badge.textContent = `build ${BUILD}\n${viewportReport()}`;
});

renderer.setAnimationLoop((t) => {
  egg.rotation.z = Math.sin(t / 700) * 0.25;
  egg.rotation.y = t / 2000;
  renderer.render(scene, camera);
});
