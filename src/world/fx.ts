// Soft things: drifting mist, shafts of sunlight, glows, and the shadow blob under a runner.
// They blend over the scene and leave the outline channel (alpha) alone.

import * as THREE from 'three';
import { world } from '../render/paint';

function softBlend(mat: THREE.ShaderMaterial, additive: boolean) {
  mat.transparent = true;
  mat.depthWrite = false;
  mat.blending = THREE.CustomBlending;
  mat.blendEquation = THREE.AddEquation;
  mat.blendSrc = THREE.SrcAlphaFactor;
  mat.blendDst = additive ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor;
  mat.blendSrcAlpha = THREE.ZeroFactor;
  mat.blendDstAlpha = THREE.OneFactor;
}

const DISPLAY = /* glsl */ `
vec3 toDisplay(vec3 c) { c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
`;

export const fxUniforms = {
  uMistAmount: { value: 0.5 },
  uShaftAmount: { value: 0.5 },
  uShaftColor: { value: new THREE.Color('#ffe2a8') },
};

/** A big soft sheet of mist that always faces the camera. */
export function makeMist(position: THREE.Vector3, width: number, height: number, seed: number, tint?: string, amount = 1): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: world.uTime,
      uNoise: world.uNoise,
      uFogColor: world.uFogColor,
      uFogSun: world.uFogSun,
      uSunDir: world.uSunDir,
      uHaze: world.uHaze,
      uAmount: fxUniforms.uMistAmount,
      uSeed: { value: seed },
      uTint: { value: new THREE.Color(tint ?? '#ffffff') },
      uTinted: { value: tint ? amount : 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vWorld;
      void main() { vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uAmount, uSeed, uTinted; uniform vec3 uFogColor, uFogSun, uSunDir, uTint; uniform vec4 uHaze;
      uniform sampler2D uNoise;
      varying vec2 vUv; varying vec3 vWorld;
      ${DISPLAY}
      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float body = (1.0 - smoothstep(0.35, 1.0, abs(p.x))) * (1.0 - smoothstep(0.1, 1.0, abs(p.y)));
        float n = texture2D(uNoise, vec2(vUv.x * 3.0 + uTime * 0.012 + uSeed, vUv.y * 1.6 + uSeed * 0.37) * 0.0625).r;
        float a = body * smoothstep(0.25, 0.75, n) * uAmount;
        float near = smoothstep(2.0, 14.0, length(vWorld - cameraPosition));
        vec3 E = normalize(vWorld - cameraPosition);
        vec3 col = mix(uFogColor, uFogSun, pow(max(dot(E, uSunDir), 0.0), uHaze.y) * uHaze.z);
        if (uTinted > 0.0) { col = mix(uFogColor, uTint, 0.55); a = body * smoothstep(0.2, 0.7, n) * uTinted; }
        gl_FragColor = vec4(toDisplay(col), a * near);
      }`,
  });
  softBlend(mat, false);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
  mesh.position.copy(position);
  mesh.onBeforeRender = (_r, _s, camera) => {
    mesh.quaternion.copy(camera.quaternion);
    mesh.updateMatrixWorld();
  };
  mesh.frustumCulled = false;
  mesh.name = 'mist';
  return mesh;
}

/** A shaft of sunlight: a long strip lying along the sun's direction, turned to face the camera. */
export function makeShaft(top: THREE.Vector3, length: number, width: number, seed: number): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: world.uTime,
      uNoise: world.uNoise,
      uColor: fxUniforms.uShaftColor,
      uAmount: fxUniforms.uShaftAmount,
      uSeed: { value: seed },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vWorld;
      void main() { vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uAmount, uSeed; uniform vec3 uColor;
      uniform sampler2D uNoise;
      varying vec2 vUv; varying vec3 vWorld;
      ${DISPLAY}
      void main() {
        float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
        float streak = 0.55 + 0.45 * texture2D(uNoise, vec2(vUv.x * 7.0 + uSeed, uTime * 0.05 + uSeed) * 0.03125).b;
        float along = smoothstep(0.0, 0.18, vUv.y) * smoothstep(1.0, 0.45, vUv.y);
        float a = pow(across, 1.6) * streak * along * uAmount;
        float near = smoothstep(1.5, 9.0, length(vWorld - cameraPosition));
        gl_FragColor = vec4(toDisplay(uColor), a * near);
      }`,
  });
  softBlend(mat, true);
  mat.side = THREE.DoubleSide;
  const geo = new THREE.PlaneGeometry(width, length);
  geo.translate(0, -length / 2, 0); // hang down from the top point
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(top);
  const down = new THREE.Vector3();
  const toCam = new THREE.Vector3();
  const xAxis = new THREE.Vector3();
  const zAxis = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  mesh.onBeforeRender = (_r, _s, camera) => {
    down.copy(world.uSunDir.value).negate();
    toCam.copy(camera.position).sub(mesh.position);
    xAxis.crossVectors(down, toCam).normalize();
    zAxis.crossVectors(xAxis, down).normalize();
    // local +Y points back up toward the sun, so the strip hangs along the light
    basis.makeBasis(xAxis, down.clone().negate(), zAxis);
    mesh.quaternion.setFromRotationMatrix(basis);
    mesh.updateMatrixWorld();
  };
  mesh.frustumCulled = false;
  mesh.name = 'shaft';
  return mesh;
}

/** Many sheets of mist drawn in one call. Each one always faces the camera. */
export interface MistField {
  mesh: THREE.Mesh;
  /** Set up sheet i. A tint makes it a colored cloud (the volcano's plume) of the given strength. */
  set(i: number, width: number, height: number, seed: number, tint?: string, amount?: number): void;
  move(i: number, center: THREE.Vector3): void;
}

export function makeMistField(count: number): MistField {
  const geo = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1);
  geo.setIndex(quad.getIndex());
  geo.setAttribute('position', quad.getAttribute('position'));
  geo.setAttribute('uv', quad.getAttribute('uv'));
  const centers = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  const shapes = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4); // width, height, seed, tint strength
  const tints = new THREE.InstancedBufferAttribute(new Float32Array(count * 3).fill(1), 3);
  centers.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aCenter', centers);
  geo.setAttribute('aShape', shapes);
  geo.setAttribute('aTint', tints);
  geo.instanceCount = count;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: world.uTime,
      uNoise: world.uNoise,
      uFogColor: world.uFogColor,
      uFogSun: world.uFogSun,
      uSunDir: world.uSunDir,
      uHaze: world.uHaze,
      uAmount: fxUniforms.uMistAmount,
    },
    vertexShader: /* glsl */ `
      attribute vec3 aCenter; attribute vec4 aShape; attribute vec3 aTint;
      varying vec2 vUv; varying vec3 vWorld; varying vec2 vSeedTint; varying vec3 vTint;
      void main() {
        vUv = uv; vSeedTint = aShape.zw; vTint = aTint;
        // the camera's own right and up, so the sheet faces it squarely
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vWorld = aCenter + right * (position.x * aShape.x) + up * (position.y * aShape.y);
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uAmount; uniform vec3 uFogColor, uFogSun, uSunDir; uniform vec4 uHaze;
      uniform sampler2D uNoise;
      varying vec2 vUv; varying vec3 vWorld; varying vec2 vSeedTint; varying vec3 vTint;
      ${DISPLAY}
      void main() {
        float seed = vSeedTint.x;
        vec2 p = vUv * 2.0 - 1.0;
        float body = (1.0 - smoothstep(0.35, 1.0, abs(p.x))) * (1.0 - smoothstep(0.1, 1.0, abs(p.y)));
        float n = texture2D(uNoise, vec2(vUv.x * 3.0 + uTime * 0.012 + seed, vUv.y * 1.6 + seed * 0.37) * 0.0625).r;
        float a = body * smoothstep(0.25, 0.75, n) * uAmount;
        float near = smoothstep(2.0, 14.0, length(vWorld - cameraPosition));
        vec3 E = normalize(vWorld - cameraPosition);
        vec3 col = mix(uFogColor, uFogSun, pow(max(dot(E, uSunDir), 0.0), uHaze.y) * uHaze.z);
        if (vSeedTint.y > 0.0) { col = mix(uFogColor, vTint, 0.55); a = body * smoothstep(0.2, 0.7, n) * vSeedTint.y; }
        gl_FragColor = vec4(toDisplay(col), a * near);
      }`,
  });
  softBlend(mat, false);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.name = 'mist';
  const color = new THREE.Color();
  return {
    mesh,
    set(i, width, height, seed, tint, amount = 1) {
      shapes.setXYZW(i, width, height, seed, tint ? amount : 0);
      if (tint) tints.setXYZ(i, ...color.set(tint).toArray() as [number, number, number]);
      shapes.needsUpdate = true;
      tints.needsUpdate = true;
    },
    move(i, center) {
      centers.setXYZ(i, center.x, center.y, center.z);
      centers.needsUpdate = true;
    },
  };
}

/** Many shafts of sunlight drawn in one call. Each hangs from its top point along the sun's direction. */
export interface ShaftField {
  mesh: THREE.Mesh;
  set(i: number, length: number, width: number, seed: number): void;
  move(i: number, top: THREE.Vector3): void;
}

export function makeShaftField(count: number): ShaftField {
  const geo = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1);
  geo.setIndex(quad.getIndex());
  geo.setAttribute('position', quad.getAttribute('position'));
  geo.setAttribute('uv', quad.getAttribute('uv'));
  const tops = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  const shapes = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3); // length, width, seed
  tops.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aTop', tops);
  geo.setAttribute('aShape', shapes);
  geo.instanceCount = count;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: world.uTime,
      uNoise: world.uNoise,
      uSunDir: world.uSunDir,
      uColor: fxUniforms.uShaftColor,
      uAmount: fxUniforms.uShaftAmount,
    },
    vertexShader: /* glsl */ `
      attribute vec3 aTop; attribute vec3 aShape;
      uniform vec3 uSunDir;
      varying vec2 vUv; varying vec3 vWorld; varying float vSeed;
      void main() {
        vUv = uv; vSeed = aShape.z;
        // a strip lying along the light, turned about that line to face the camera
        vec3 down = -uSunDir;
        vec3 across = normalize(cross(down, cameraPosition - aTop));
        vWorld = aTop + across * (position.x * aShape.y) + down * ((0.5 - position.y) * aShape.x);
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uAmount; uniform vec3 uColor;
      uniform sampler2D uNoise;
      varying vec2 vUv; varying vec3 vWorld; varying float vSeed;
      ${DISPLAY}
      void main() {
        float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
        float streak = 0.55 + 0.45 * texture2D(uNoise, vec2(vUv.x * 7.0 + vSeed, uTime * 0.05 + vSeed) * 0.03125).b;
        float along = smoothstep(0.0, 0.18, vUv.y) * smoothstep(1.0, 0.45, vUv.y);
        float a = pow(across, 1.6) * streak * along * uAmount;
        float dist = length(vWorld - cameraPosition);
        float near = smoothstep(1.5, 9.0, dist);
        // shafts far down the trail thin out, so a long row of them never adds up to a glare
        float far = 1.0 - 0.6 * smoothstep(35.0, 95.0, dist);
        gl_FragColor = vec4(toDisplay(uColor), a * near * far);
      }`,
  });
  softBlend(mat, true);
  mat.side = THREE.DoubleSide;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.name = 'shaft';
  return {
    mesh,
    set(i, length, width, seed) {
      shapes.setXYZ(i, length, width, seed);
      shapes.needsUpdate = true;
    },
    move(i, top) {
      tops.setXYZ(i, top.x, top.y, top.z);
      tops.needsUpdate = true;
    },
  };
}

/** A soft round glow that faces the camera. Used behind amber and the egg. */
export function makeGlow(color: THREE.ColorRepresentation, size: number, strength = 1): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uStrength: { value: strength }, uTime: world.uTime },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uStrength, uTime; varying vec2 vUv;
      ${DISPLAY}
      void main() {
        float d = length(vUv * 2.0 - 1.0);
        float a = pow(max(0.0, 1.0 - d), 2.2) * uStrength;
        gl_FragColor = vec4(toDisplay(uColor), a);
      }`,
  });
  softBlend(mat, true);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
  mesh.onBeforeRender = (_r, _s, camera) => {
    mesh.quaternion.copy(camera.quaternion);
    if (mesh.parent) {
      const pq = new THREE.Quaternion();
      mesh.parent.getWorldQuaternion(pq);
      mesh.quaternion.premultiply(pq.invert());
    }
    mesh.updateMatrixWorld();
  };
  mesh.name = 'glow';
  return mesh;
}

/** A soft dark patch on the ground under a runner or a prop, so it sits on the trail in any light. */
export function makeContactShadow(width: number, length: number, strength = 0.5): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uStrength: { value: strength } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uStrength; varying vec2 vUv;
      void main() {
        float d = length(vUv * 2.0 - 1.0);
        float a = pow(max(0.0, 1.0 - d), 1.5) * uStrength;
        gl_FragColor = vec4(0.03, 0.05, 0.07, a);
      }`,
  });
  softBlend(mat, false);
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -2;
  mat.polygonOffsetUnits = -2;
  const geo = new THREE.PlaneGeometry(width, length);
  geo.rotateX(-Math.PI / 2); // lie flat: local +Y is the ground normal
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 1;
  mesh.name = 'contact-shadow';
  return mesh;
}

/** Many soft glows drawn in one call (one per amber piece). Scale an instance to zero to hide it. */
export function makeGlowField(count: number, color: THREE.ColorRepresentation, strength = 1): THREE.InstancedMesh {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uStrength: { value: strength } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 center = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float size = length(instanceMatrix[0].xyz);
        vec4 mv = viewMatrix * center;
        mv.xy += position.xy * size;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uStrength; varying vec2 vUv;
      ${DISPLAY}
      void main() {
        float d = length(vUv * 2.0 - 1.0);
        float a = pow(max(0.0, 1.0 - d), 2.2) * uStrength;
        gl_FragColor = vec4(toDisplay(uColor), a);
      }`,
  });
  softBlend(mat, true);
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, count);
  mesh.frustumCulled = false;
  mesh.name = 'glow-field';
  return mesh;
}
