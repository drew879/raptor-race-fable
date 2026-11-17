// The finishing pass. The scene is drawn into an offscreen image with depth, then this pass
// adds what makes each style: ink outlines found from depth, paper grain and a final grade.
// With every effect at zero it is a plain copy.

import * as THREE from 'three';
import { noiseTexture } from './noisetex';

export const postUniforms = {
  tColor: { value: null as THREE.Texture | null },
  tDepth: { value: null as THREE.Texture | null },
  uNoise: { value: noiseTexture() },
  uRes: { value: new THREE.Vector2(1, 1) },
  uNearFar: { value: new THREE.Vector2(0.3, 2500) },
  uDpr: { value: 1 },
  // x: strength, y: thickness in points, z: sensitivity (lower finds more edges), w: hand wobble in points
  uLine: { value: new THREE.Vector4(0, 1, 0.03, 0) },
  uLineColor: { value: new THREE.Color('#2a2018') },
  // x: grain strength, y: grain size in points, z: unused, w: pigment pooling at wash edges
  uPaper: { value: new THREE.Vector4(0, 2, 0, 0) },
  // x: saturation, y: contrast, z: vignette, w: unused
  uFinal: { value: new THREE.Vector4(1, 1, 0, 0) },
};

const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D uNoise;
uniform vec2 uRes;
uniform vec2 uNearFar;
uniform float uDpr;
uniform vec4 uLine;
uniform vec3 uLineColor;
uniform vec4 uPaper;
uniform vec4 uFinal;
varying vec2 vUv;

// 1 / view depth. It is linear across any flat surface on screen, so its second
// difference is zero on planes and spikes at silhouettes and creases.
float invZ(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  return (uNearFar.y - d * (uNearFar.y - uNearFar.x)) / (uNearFar.x * uNearFar.y);
}

void main() {
  vec2 px = 1.0 / uRes;
  vec2 pt = vUv * uRes / uDpr; // position in points, so effects look the same on any screen
  vec3 col = texture2D(tColor, vUv).rgb;

  if (uLine.x > 0.0) {
    // one read of the noise gives the hand's wobble (b, a) and the pen's changing weight (r)
    vec4 hand = texture2D(uNoise, pt / 736.0);
    vec2 uv = vUv + (hand.ba - 0.5) * 2.0 * uLine.w * uDpr * px;
    vec2 o = px * uLine.y * uDpr * (0.7 + 0.6 * hand.r);
    float z0 = invZ(uv);
    float zr = invZ(uv + vec2(o.x, 0.0));
    float zl = invZ(uv - vec2(o.x, 0.0));
    float zu = invZ(uv + vec2(0.0, o.y));
    float zd = invZ(uv - vec2(0.0, o.y));
    float nearest = max(z0, max(max(zr, zl), max(zu, zd)));
    float lap = abs(zr + zl - 2.0 * z0) + abs(zu + zd - 2.0 * z0);
    float edge = smoothstep(uLine.z, uLine.z * 3.0, lap / max(nearest, 1e-6));
    // pigment pools a little along the edges of a wash
    float pool = 0.0;
    if (uPaper.w > 0.0) {
      vec2 o2 = o * 3.0;
      float lap2 = abs(invZ(uv + vec2(o2.x, 0.0)) + invZ(uv - vec2(o2.x, 0.0)) - 2.0 * z0)
                 + abs(invZ(uv + vec2(0.0, o2.y)) + invZ(uv - vec2(0.0, o2.y)) - 2.0 * z0);
      pool = smoothstep(uLine.z * 2.0, uLine.z * 12.0, lap2 / max(nearest, 1e-6)) * uPaper.w;
    }
    if (edge + pool > 0.0) {
      // the line's weight belongs to whichever surface is in front
      vec2 at = uv;
      if (zr == nearest) at = uv + vec2(o.x, 0.0);
      else if (zl == nearest) at = uv - vec2(o.x, 0.0);
      else if (zu == nearest) at = uv + vec2(0.0, o.y);
      else if (zd == nearest) at = uv - vec2(0.0, o.y);
      float lw = texture2D(tColor, at).a;
      // a dry pen skips a little
      edge *= 0.75 + 0.25 * smoothstep(0.25, 0.6, texture2D(uNoise, pt / 192.0).b);
      col = mix(col, uLineColor, clamp(edge * uLine.x * lw, 0.0, 1.0));
      col *= 1.0 - pool * lw;
    }
  }

  if (uPaper.x > 0.0) {
    // paper tooth: two reads at different sizes and angles, so the tile never shows
    vec2 g = pt / uPaper.y;
    vec2 g1 = vec2(g.x * 0.956 - g.y * 0.292, g.x * 0.292 + g.y * 0.956);
    vec2 g2 = vec2(g.x * 0.996 + g.y * 0.087, g.y * 0.996 - g.x * 0.087);
    float grain = texture2D(uNoise, g1 / 32.0).b * 0.6 + texture2D(uNoise, vec2(g2.x * 0.18, g2.y * 1.9) / 32.0).a * 0.4;
    float tooth = (grain - 0.5) * 2.0;
    // darker paint shows more of the paper's tooth
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col *= 1.0 - uPaper.x * tooth * (0.5 + 0.8 * (1.0 - lum));
  }

  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(l), col, uFinal.x);
  col = (col - 0.5) * uFinal.y + 0.5;
  vec2 v = vUv - 0.5;
  col *= 1.0 - uFinal.z * smoothstep(0.25, 0.85, dot(v, v) * 2.0);
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

/**
 * Edge smoothing samples per pixel. It was 4. On the phone, warm and several minutes into a
 * session, full sharpness at 4 could not hold 60 frames a second while the speed test (short
 * bursts) said it had room to spare. At two pixels per point, 2 is hard to tell from 4 by eye
 * and moves half as much memory every frame.
 */
export const SAMPLES = 2;

export class Post {
  private target: THREE.WebGLRenderTarget;
  private w = 4;
  private h = 4;
  private quad: THREE.Mesh;
  private quadScene = new THREE.Scene();
  private quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  enabled = true;

  constructor(private renderer: THREE.WebGLRenderer, private samples = SAMPLES) {
    this.target = this.makeTarget();
    const mat = new THREE.ShaderMaterial({
      uniforms: postUniforms,
      depthTest: false,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: FRAG,
    });
    // one big triangle covering the screen
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.quad = new THREE.Mesh(geo, mat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  private makeTarget(): THREE.WebGLRenderTarget {
    const target = new THREE.WebGLRenderTarget(this.w, this.h, {
      samples: this.samples,
      depthTexture: new THREE.DepthTexture(this.w, this.h, THREE.UnsignedIntType),
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
    });
    target.depthTexture!.minFilter = THREE.NearestFilter;
    target.depthTexture!.magFilter = THREE.NearestFilter;
    return target;
  }

  /** Edge smoothing samples: SAMPLES for the game, 0 to switch it off (the speed test compares them). */
  setSamples(samples: number) {
    if (samples === this.samples) return;
    this.samples = samples;
    this.target.depthTexture?.dispose();
    this.target.dispose();
    this.target = this.makeTarget();
  }

  setSize(width: number, height: number, dpr: number) {
    const w = Math.max(2, Math.round(width * dpr));
    const h = Math.max(2, Math.round(height * dpr));
    this.w = w;
    this.h = h;
    this.target.setSize(w, h);
    postUniforms.uRes.value.set(w, h);
    postUniforms.uDpr.value = dpr;
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    const r = this.renderer;
    if (!this.enabled) {
      r.setRenderTarget(null);
      r.render(scene, camera);
      return;
    }
    postUniforms.uNearFar.value.set(camera.near, camera.far);
    r.setRenderTarget(this.target);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(scene, camera);
    postUniforms.tColor.value = this.target.texture;
    postUniforms.tDepth.value = this.target.depthTexture;
    r.setRenderTarget(null);
    r.render(this.quadScene, this.quadCamera);
  }
}
