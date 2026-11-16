// Everything far away: the sky, stacked ridges fading into mist, and the volcano.

import * as THREE from 'three';
import { paintMaterial, world } from '../render/paint';
import { fbm, vnoise } from './noise';

export const skyUniforms = {
  uZenith: { value: new THREE.Color('#7fb0c0') },
  uHorizon: { value: new THREE.Color('#e8e2c8') },
  uSunGlow: { value: new THREE.Color('#ffd9a0') },
  // x: horizon sharpness, y: sun glow tightness, z: sun glow amount, w: sun disc amount
  uSkyParams: { value: new THREE.Vector4(2.2, 10, 0.9, 0.6) },
};

export function makeSky(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    uniforms: { ...skyUniforms, uSunDir: world.uSunDir, uTime: world.uTime },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith, uHorizon, uSunGlow, uSunDir;
      uniform vec4 uSkyParams;
      uniform float uTime;
      varying vec3 vDir;
      float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      vec3 toDisplay(vec3 c) { c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 col = mix(uHorizon, uZenith, 1.0 - pow(1.0 - h, uSkyParams.x));
        float s = max(dot(d, uSunDir), 0.0);
        col += uSunGlow * (pow(s, uSkyParams.y) * uSkyParams.z + pow(s, 900.0) * uSkyParams.w * 3.0);
        col = toDisplay(col);
        col += (hash21(gl_FragCoord.xy) - 0.5) / 255.0;
        gl_FragColor = vec4(col, 0.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  mesh.name = 'sky';
  return mesh;
}

interface RidgeSpec {
  radius: number;
  base: number; // average height of the crest
  amp: number; // how much the crest rolls
  freq: number;
  color: string;
  trees: number; // height of the tree-line serration
  mist: number; // 0..1, how far this layer has faded into the air
  seed: number;
}

/** A ring of silhouette ridges around a center point. Mist does the rest. */
export function makeRidges(center: THREE.Vector3, specs: RidgeSpec[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'ridges';
  const mat = paintMaterial('ridge');
  for (const spec of specs) {
    const n = 360;
    const pos: number[] = [];
    const paint: number[] = [];
    const nor: number[] = [];
    const index: number[] = [];
    const c = new THREE.Color(spec.color);
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = Math.sin(a);
      const z = -Math.cos(a);
      const roll = fbm(a * spec.freq + spec.seed, spec.seed * 1.7, 4) - 0.5;
      const tree = (vnoise(a * spec.radius * 0.35, spec.seed) - 0.5) * spec.trees;
      const top = spec.base + roll * 2 * spec.amp + tree;
      const shade = 0.9 + 0.2 * vnoise(a * 30 + spec.seed, 1.5);
      for (const y of [top, top - spec.amp * 0.9 - 30, -400]) {
        pos.push(center.x + x * spec.radius, y, center.z + z * spec.radius);
        nor.push(-x, 0.35, -z);
        const k = y === top ? 1.08 : 0.9;
        const mist = y === top ? spec.mist : y < -300 ? 1 : Math.min(1, spec.mist + 0.42);
        paint.push(c.r * shade * k, c.g * shade * k, c.b * shade * k, mist);
      }
      if (i < n) {
        const o = i * 3;
        index.push(o, o + 3, o + 1, o + 1, o + 3, o + 4, o + 1, o + 4, o + 2, o + 2, o + 4, o + 5);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('aPaint', new THREE.Float32BufferAttribute(paint, 4));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
    geo.setIndex(index);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  return group;
}

/** A stratovolcano silhouette with a thin ash plume, far across the valley. */
export function makeVolcano(center: THREE.Vector3, bearing: number, distance: number, height: number, color: string, mist = 0.8): THREE.Group {
  const group = new THREE.Group();
  group.name = 'volcano';
  const dir = new THREE.Vector3(Math.sin(bearing), 0, -Math.cos(bearing));
  const side = new THREE.Vector3(Math.cos(bearing), 0, Math.sin(bearing));
  const base = center.clone().addScaledVector(dir, distance);
  const half = height * 2.1;
  const n = 80;
  const pos: number[] = [];
  const paint: number[] = [];
  const nor: number[] = [];
  const index: number[] = [];
  const c = new THREE.Color(color);
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * 2 - 1;
    const a = Math.abs(t);
    // concave flanks that steepen toward a small, slightly notched summit
    let y = height * Math.pow(Math.max(0, 1 - a), 2.1) + height * 0.08 * Math.max(0, 1 - a * 6);
    if (a < 0.035) y = Math.min(y, height * (0.93 + 0.5 * a));
    y += (vnoise(t * 14, 3.3) - 0.5) * height * 0.03 * (1 - a);
    const x = t * half;
    for (const yy of [y - 60, -400]) {
      pos.push(base.x + side.x * x, yy, base.z + side.z * x);
      nor.push(-dir.x, 0.3, -dir.z);
      const snow = yy > 0 ? Math.max(0, Math.min(1, (y / height - 0.72) * 5)) * 0.25 : 0;
      paint.push(c.r + snow, c.g + snow, c.b + snow, yy > -300 ? mist + 0.1 * (1 - y / height) : 1);
    }
    if (i < n) {
      const o = i * 2;
      index.push(o, o + 2, o + 1, o + 1, o + 2, o + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('aPaint', new THREE.Float32BufferAttribute(paint, 4));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  geo.setIndex(index);
  const mesh = new THREE.Mesh(geo, paintMaterial('ridge'));
  mesh.frustumCulled = false;
  group.add(mesh);
  group.userData.summit = base.clone().setY(height - 60);
  group.userData.side = side;
  return group;
}
