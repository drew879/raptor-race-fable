// The finishing pass. The scene is drawn into an offscreen image with depth, then this pass
// adds what makes each style: ink outlines found from depth, paper grain, the ragged edge
// of a wash, and a final grade. With every effect at zero it is a plain copy.

import * as THREE from 'three';
import { NOISE } from './paint';

export const postUniforms = {
  tColor: { value: null as THREE.Texture | null },
  tDepth: { value: null as THREE.Texture | null },
  uRes: { value: new THREE.Vector2(1, 1) },
  uNearFar: { value: new THREE.Vector2(0.3, 2500) },
  uDpr: { value: 1 },
  // x: strength, y: thickness in points, z: sensitivity (lower finds more edges), w: hand wobble in points
  uLine: { value: new THREE.Vector4(0, 1, 0.03, 0) },
  uLineColor: { value: new THREE.Color('#2a2018') },
  // x: grain strength, y: grain size in points, z: how far the painting fades to bare paper at the edges, w: pigment pooling at wash edges
  uPaper: { value: new THREE.Vector4(0, 2, 0, 0) },
  uPaperColor: { value: new THREE.Color('#f3ead8') },
  // x: saturation, y: contrast, z: vignette, w: unused
  uFinal: { value: new THREE.Vector4(1, 1, 0, 0) },
};

const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uRes;
uniform vec2 uNearFar;
uniform float uDpr;
uniform vec4 uLine;
uniform vec3 uLineColor;
uniform vec4 uPaper;
uniform vec3 uPaperColor;
uniform vec4 uFinal;
varying vec2 vUv;
${NOISE}

// 1 / view depth. It is linear across any flat surface on screen, so its second
// difference is zero on planes and spikes at silhouettes and creases.
float invZ(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  return (uNearFar.y - d * (uNearFar.y - uNearFar.x)) / (uNearFar.x * uNearFar.y);
}

void main() {
  vec2 px = 1.0 / uRes;
  vec2 pt = vUv * uRes / uDpr; // position in points, so effects look the same on any screen
  vec4 c = texture2D(tColor, vUv);
  vec3 col = c.rgb;

  if (uLine.x > 0.0) {
    vec2 wob = (vec2(vnoise2(pt / 23.0), vnoise2(pt / 23.0 + 19.0)) - 0.5) * 2.0 * uLine.w * uDpr * px;
    vec2 uv = vUv + wob;
    float weight = 0.7 + 0.6 * vnoise2(pt / 55.0 + 3.0);
    vec2 o = px * uLine.y * uDpr * weight;
    float z0 = invZ(uv);
    vec2 offs[4];
    offs[0] = vec2(o.x, 0.0); offs[1] = vec2(-o.x, 0.0); offs[2] = vec2(0.0, o.y); offs[3] = vec2(0.0, -o.y);
    float zs[4];
    float nearest = z0;
    float lw = texture2D(tColor, uv).a;
    for (int i = 0; i < 4; i++) {
      zs[i] = invZ(uv + offs[i]);
      if (zs[i] > nearest) { nearest = zs[i]; lw = texture2D(tColor, uv + offs[i]).a; }
    }
    float lap = abs(zs[0] + zs[1] - 2.0 * z0) + abs(zs[2] + zs[3] - 2.0 * z0);
    float rel = lap / max(nearest, 1e-6);
    float edge = smoothstep(uLine.z, uLine.z * 3.0, rel);
    // a dry pen skips a little
    edge *= 0.75 + 0.25 * smoothstep(0.25, 0.6, vnoise2(pt / 6.0));
    col = mix(col, uLineColor, clamp(edge * uLine.x * lw, 0.0, 1.0));
    // pigment pools a little along the edges of a wash
    if (uPaper.w > 0.0) {
      vec2 o2 = o * 3.0;
      float lap2 = abs(invZ(uv + vec2(o2.x, 0.0)) + invZ(uv - vec2(o2.x, 0.0)) - 2.0 * z0)
                 + abs(invZ(uv + vec2(0.0, o2.y)) + invZ(uv - vec2(0.0, o2.y)) - 2.0 * z0);
      float pool = smoothstep(uLine.z * 2.0, uLine.z * 12.0, lap2 / max(nearest, 1e-6));
      col *= 1.0 - pool * uPaper.w * lw;
    }
  }

  if (uPaper.x > 0.0 || uPaper.z > 0.0) {
    vec2 g = pt / uPaper.y;
    float grain = fbm2(g) * 0.6 + vnoise2(vec2(g.x * 0.18, g.y * 1.9)) * 0.4;
    float tooth = (grain - 0.5) * 2.0;
    // darker paint shows more of the paper's tooth
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col *= 1.0 - uPaper.x * tooth * (0.5 + 0.8 * (1.0 - lum));
    // toward the edge of the page the wash thins out to bare paper, with a ragged edge
    if (uPaper.z > 0.0) {
      vec2 q = min(vUv, 1.0 - vUv) * vec2(uRes.x / uRes.y, 1.0);
      float d = min(q.x * 1.6, q.y);
      float ragged = d + (fbm2(pt / 34.0) - 0.5) * 0.045 * uPaper.z + (vnoise2(pt / 7.0) - 0.5) * 0.012;
      float inside = smoothstep(0.004, 0.004 + 0.06 * uPaper.z, ragged);
      vec3 bare = uPaperColor * (1.0 - uPaper.x * tooth * 0.6);
      col = mix(bare, col, inside);
    }
  }

  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(l), col, uFinal.x);
  col = (col - 0.5) * uFinal.y + 0.5;
  vec2 v = vUv - 0.5;
  col *= 1.0 - uFinal.z * smoothstep(0.25, 0.85, dot(v, v) * 2.0);
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

export class Post {
  private target: THREE.WebGLRenderTarget;
  private quad: THREE.Mesh;
  private quadScene = new THREE.Scene();
  private quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  enabled = true;

  constructor(private renderer: THREE.WebGLRenderer, samples = 4) {
    this.target = new THREE.WebGLRenderTarget(4, 4, {
      samples,
      depthTexture: new THREE.DepthTexture(4, 4, THREE.UnsignedIntType),
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
    });
    this.target.depthTexture!.minFilter = THREE.NearestFilter;
    this.target.depthTexture!.magFilter = THREE.NearestFilter;
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

  setSize(width: number, height: number, dpr: number) {
    const w = Math.max(2, Math.round(width * dpr));
    const h = Math.max(2, Math.round(height * dpr));
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
