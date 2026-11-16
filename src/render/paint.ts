// The paint shader: one material family for the whole world.
//
// Models carry painted color in a vertex attribute (rgb = color, a = baked occlusion)
// and wind data in uv (x = sway weight, y = phase). Each face's "role" (bark, foliage,
// feather...) picks a variant here. Lighting is stylized on purpose: a sun term with a
// controllable terminator, tinted shade, backlit leaves, and mist that warms toward the sun.
// Every style direction is just a different set of values for these uniforms.

import * as THREE from 'three';
import { noiseTexture } from './noisetex';

export const world = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0.5, 0.5, -0.7).normalize() },
  uSunColor: { value: new THREE.Color(1, 0.9, 0.7) },
  uSkyAmb: { value: new THREE.Color(0.4, 0.5, 0.55) },
  uGroundAmb: { value: new THREE.Color(0.2, 0.25, 0.2) },
  // x: where the light/shade edge sits, y: its softness, z: depth of the core shade, w: light wrap
  uBand: { value: new THREE.Vector4(0.45, 0.2, 0.25, 0.3) },
  uFogColor: { value: new THREE.Color(0.6, 0.75, 0.75) },
  uFogSun: { value: new THREE.Color(1.0, 0.85, 0.6) },
  // x: density, y: base height, z: height falloff, w: max opacity
  uFog: { value: new THREE.Vector4(0.012, 0, 0.05, 0.95) },
  // x: distance fog density (uniform haze), y: sun glow power, z: sun glow amount, w: mist on far ridges
  uHaze: { value: new THREE.Vector4(0.003, 6, 0.8, 0) },
  // x: strength, y: scale, z: softness, w: how much of the ground the sun reaches (0..1)
  uDapple: { value: new THREE.Vector4(0.6, 0.22, 0.2, 0.05) },
  // x, y: direction on the ground plane, z: strength, w: speed
  uWind: { value: new THREE.Vector4(0.8, 0.6, 0.06, 1.0) },
  uShadowMap: { value: null as THREE.Texture | null },
  uShadowMatrix: { value: new THREE.Matrix4() },
  // x: texel size, y: bias, z: strength, w: 1 when the map is live
  uShadowParams: { value: new THREE.Vector4(1 / 2048, 0.0015, 1, 0) },
  // x: painterly value variation, y: its scale, z: brush wobble on the shade edge, w: pigment grain
  uBrush: { value: new THREE.Vector4(0.12, 0.6, 0.1, 0.0) },
  // x: global saturation, y: value, z: shade saturation boost, w: unused
  uGrade: { value: new THREE.Vector4(1, 1, 1, 0) },
  uShadeTint: { value: new THREE.Color(0.7, 0.8, 1.0) },
  // smooth tiling noise, read in place of working noise out per pixel
  uNoise: { value: noiseTexture() },
  // outlines fade out between these two distances (meters), so the far forest stays pure paint
  uLineFade: { value: new THREE.Vector2(1e5, 1e6) },
};

export type Role =
  | 'bark'
  | 'prop'
  | 'rock'
  | 'ground'
  | 'foliage_conifer'
  | 'foliage_ginkgo'
  | 'foliage_fern'
  | 'foliage_horsetail'
  | 'feather'
  | 'skin'
  | 'eye'
  | 'egg'
  | 'amber'
  | 'ridge';

export interface RoleLook {
  tint?: THREE.ColorRepresentation;
  sat?: number;
  val?: number;
}

interface RoleBase {
  defines: Record<string, number>;
  side: THREE.Side;
  translucency: number;
  puff: number; // bend normals toward up, so leaf masses shade as soft volumes
  sway: number;
  dapple: number;
  shadow: number;
  rim: number;
  line: number; // how strongly outlines draw on this role (0..1)
  keepLine: number; // 1: the outline never fades with distance (the things you play with)
  ao: number;
}

const solid: RoleBase = {
  defines: {},
  side: THREE.FrontSide,
  translucency: 0,
  puff: 0,
  sway: 0,
  dapple: 1,
  shadow: 1,
  rim: 0.15,
  line: 1,
  keepLine: 0,
  ao: 1,
};
const leafy: RoleBase = {
  ...solid,
  side: THREE.DoubleSide,
  translucency: 0.9,
  puff: 0.55,
  sway: 1,
  dapple: 0.5,
  shadow: 0.7,
  rim: 0,
  line: 0.3,
  ao: 0.9,
};

const ROLE_BASE: Record<Role, RoleBase> = {
  bark: { ...solid },
  prop: { ...solid, dapple: 0.2, shadow: 0.5, rim: 0.4, keepLine: 1 },
  rock: { ...solid },
  ground: { ...solid, defines: { ROLE_GROUND: 1 }, rim: 0, line: 0.5 },
  foliage_conifer: { ...leafy, translucency: 0.5, dapple: 0.25, puff: 0.5 },
  foliage_ginkgo: { ...leafy, translucency: 1.2, dapple: 0.35 },
  foliage_fern: { ...leafy, translucency: 1.0, dapple: 0.85, shadow: 0.85 },
  foliage_horsetail: { ...leafy, translucency: 0.6, puff: 0.3, dapple: 0.85 },
  feather: { ...solid, defines: { ROLE_FEATHER: 1 }, side: THREE.DoubleSide, rim: 0.55, dapple: 0.2, shadow: 0.35, keepLine: 1 },
  skin: { ...solid, rim: 0.3, dapple: 0.2, shadow: 0.35, keepLine: 1 },
  eye: { ...solid, defines: { ROLE_EYE: 1 }, dapple: 0, keepLine: 1 },
  egg: { ...solid, defines: { ROLE_EGG: 1 }, rim: 0.7, dapple: 0.1, shadow: 0.4, ao: 0, keepLine: 1 },
  amber: { ...solid, defines: { ROLE_AMBER: 1 }, dapple: 0, shadow: 0, ao: 0, keepLine: 1 },
  ridge: { ...solid, defines: { ROLE_RIDGE: 1 }, side: THREE.DoubleSide, dapple: 0, shadow: 0, rim: 0, line: 0.6, ao: 0 },
};

const NOISE = /* glsl */ `
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float hash31(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float vnoise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x),
             mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y);
}
float vnoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(hash31(i), hash31(i + vec3(1, 0, 0)), f.x),
                mix(hash31(i + vec3(0, 1, 0)), hash31(i + vec3(1, 1, 0)), f.x), f.y);
  float b = mix(mix(hash31(i + vec3(0, 0, 1)), hash31(i + vec3(1, 0, 1)), f.x),
                mix(hash31(i + vec3(0, 1, 1)), hash31(i + vec3(1, 1, 1)), f.x), f.y);
  return mix(a, b, f.z);
}
float fbm2(vec2 p) {
  return vnoise2(p) * 0.55 + vnoise2(p * 2.13 + 7.1) * 0.3 + vnoise2(p * 4.31 + 3.7) * 0.15;
}
`;

const VERT = /* glsl */ `
attribute vec4 aPaint;
uniform float uTime;
uniform vec4 uWind;
uniform float uSway;
uniform mat4 uShadowMatrix;
varying vec4 vPaint;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vObj;
varying vec4 vShadowCoord;
#ifdef USE_INSTANCING_COLOR
varying vec3 vInstColor;
#endif
#ifdef ROLE_GROUND
varying vec2 vTrail; // x: meters to the right of the trail's centerline, y: meters along it
#endif
#include <skinning_pars_vertex>

void main() {
  vPaint = aPaint;
  vObj = position;
  #ifdef ROLE_GROUND
  vTrail = uv;
  #endif
  vec3 transformed = position;
  vec3 objectNormal = normal;
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <skinning_vertex>
  #if defined(ROLE_AMBER) && defined(USE_INSTANCING)
  {
    float a = uTime * 1.6 + instanceMatrix[3].x * 2.0 + instanceMatrix[3].z * 2.0;
    mat2 spin = mat2(cos(a), -sin(a), sin(a), cos(a));
    transformed.xz = spin * transformed.xz;
    objectNormal.xz = spin * objectNormal.xz;
    transformed.y += sin(a * 1.3) * 0.12;
  }
  #endif
  mat4 m = modelMatrix;
  #ifdef USE_INSTANCING
  m = modelMatrix * instanceMatrix;
  #endif
  #ifdef USE_INSTANCING_COLOR
  vInstColor = instanceColor;
  #endif
  vec4 wp = m * vec4(transformed, 1.0);
  vNormal = normalize(mat3(m) * objectNormal);

  // wind: a slow lean plus a quicker flutter, scaled by the painted sway weight
  float sway = uv.x * uSway;
  if (sway > 0.0) {
    float t = uTime * uWind.w;
    float phase = uv.y * 6.2832 + dot(wp.xz, vec2(0.11, 0.13));
    float gust = sin(t * 0.7 + phase) + 0.5 * sin(t * 1.9 + phase * 1.7);
    float flutter = sin(t * 4.3 + phase * 3.1 + wp.y * 2.0);
    wp.xz += uWind.xy * (gust * uWind.z * sway);
    wp.y += flutter * uWind.z * 0.25 * sway;
  }

  vWorld = wp.xyz;
  vShadowCoord = uShadowMatrix * wp;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyAmb;
uniform vec3 uGroundAmb;
uniform vec4 uBand;
uniform vec3 uFogColor;
uniform vec3 uFogSun;
uniform vec4 uFog;
uniform vec4 uHaze;
uniform vec4 uDapple;
uniform vec4 uWind;
uniform highp sampler2DShadow uShadowMap;
uniform vec4 uShadowParams;
uniform vec4 uBrush;
uniform vec4 uGrade;
uniform vec3 uShadeTint;
uniform sampler2D uNoise;
uniform vec2 uLineFade;
uniform vec4 uLanes;

uniform vec3 uTint;
uniform float uSat;
uniform float uTranslucency;
uniform float uPuff;
uniform float uDappleAmt;
uniform float uShadowAmt;
uniform float uRim;
uniform float uLine;
uniform float uKeepLine;
uniform float uAo;
uniform float uCrack;
uniform vec3 uGlow;

varying vec4 vPaint;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vObj;
varying vec4 vShadowCoord;
#ifdef USE_INSTANCING_COLOR
varying vec3 vInstColor;
#endif
#ifdef ROLE_GROUND
varying vec2 vTrail;
#endif

${NOISE}

// The noise texture, addressed in cells: r and g repeat every 16 cells, b and a every 32.
#define LAYERED(p) texture2D(uNoise, (p) * 0.0625)
#define PLAIN(p) texture2D(uNoise, (p) * 0.03125)

float sunShadow() {
  if (uShadowParams.w < 0.5) return 1.0;
  vec3 sc = vShadowCoord.xyz / vShadowCoord.w;
  vec2 edge = min(sc.xy, 1.0 - sc.xy);
  float inside = smoothstep(0.0, 0.08, min(edge.x, edge.y)) * step(sc.z, 1.0);
  if (inside <= 0.0) return 1.0;
  float z = sc.z - uShadowParams.y;
  // four taps on a turned square; the hardware blends 2x2 texels for each
  float tx = uShadowParams.x * 1.25;
  float s = texture(uShadowMap, vec3(sc.xy + vec2(-0.94, -0.31) * tx, z))
          + texture(uShadowMap, vec3(sc.xy + vec2(0.31, -0.94) * tx, z))
          + texture(uShadowMap, vec3(sc.xy + vec2(0.94, 0.31) * tx, z))
          + texture(uShadowMap, vec3(sc.xy + vec2(-0.31, 0.94) * tx, z));
  return mix(1.0, s * 0.25, inside);
}

// Light breaking through a canopy we never have to draw: noise projected along the sun.
float dapple(vec3 wp) {
  vec2 p = wp.xz - uSunDir.xz * (wp.y / max(uSunDir.y, 0.15));
  // a low sun stretches each patch of light along the ground, away from the sun
  vec2 a = normalize(uSunDir.xz);
  p = vec2(dot(p, a) * (0.35 + uSunDir.y), dot(p, vec2(-a.y, a.x)));
  p = p * uDapple.y + uWind.xy * uTime * 0.03;
  float n = LAYERED(p).g;
  float th = 1.0 - uDapple.w;
  return smoothstep(th - uDapple.z, th + uDapple.z, n);
}

vec3 toDisplay(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  vec3 E = normalize(vWorld - cameraPosition); // from the eye to the surface
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  vec3 Ng = N;
  N = normalize(mix(N, vec3(0.0, 1.0, 0.0), uPuff));

  vec3 albedo = vPaint.rgb;
  float ao = mix(1.0, vPaint.a, uAo);

  #ifdef ROLE_GROUND
  {
    // fine soil and litter detail that vertex paint can't hold
    vec4 fine = PLAIN(vWorld.xz * 7.5);
    float g = LAYERED(vWorld.xz * 2.3).r * 0.6 + fine.b * 0.4;
    albedo *= 0.82 + 0.36 * g;
    float onTrail = vPaint.a;
    // Lanes without painted lines: each lane is a worn, slightly paler track, and between the
    // tracks runs a thin, broken seam of moss and litter, the way a shared trail wears in.
    // uLanes: x lane width, y strength, z half the seam's width.
    float lx = abs(vTrail.x);
    float fromSeam = abs(lx - uLanes.x * 0.5);
    vec4 rag = LAYERED(vec2(vTrail.y * 0.9, vTrail.x * 2.2 + 3.0));
    // ragged at two sizes: long wavering runs, and small clumps along their edges
    float seam = 1.0 - smoothstep(uLanes.z * 0.6, uLanes.z, fromSeam + (rag.r - 0.5) * 0.12 + (fine.b - 0.5) * 0.07);
    seam *= smoothstep(0.33, 0.43, rag.g) * onTrail * uLanes.y;
    float lu = lx > uLanes.x * 0.5 ? abs(lx - uLanes.x) : lx; // distance to the nearest lane's center
    float track = (1.0 - smoothstep(0.0, uLanes.x * 0.4, lu)) * step(lx, uLanes.x * 1.5) * onTrail * uLanes.y;
    albedo *= 1.0 + 0.1 * track;
    vec3 moss = mix(vec3(0.15, 0.22, 0.09), vec3(0.26, 0.29, 0.12), fine.a);
    moss = mix(moss, vec3(0.25, 0.17, 0.09), smoothstep(0.55, 0.7, fine.b) * 0.7); // flecks of leaf litter
    albedo = mix(albedo, moss, seam * 0.7);
    float pebble = smoothstep(0.80 - 0.1 * seam, 0.86 - 0.1 * seam, fine.a) * onTrail;
    albedo = mix(albedo, albedo * 1.35 + 0.03, pebble * 0.5);
    ao = 1.0;
  }
  #endif

  #ifdef ROLE_EGG
  float eggCrack = 0.0;
  {
    // speckles and the crack are drawn here so the crack can grow during the chase
    vec3 q = vObj * 5.0;
    float sp = smoothstep(0.6, 0.7, vnoise3(q * 1.3)) * 0.55 + smoothstep(0.68, 0.76, vnoise3(q * 3.1 + 9.0)) * 0.45;
    albedo = mix(albedo, albedo * vec3(0.5, 0.6, 0.72), sp);
    albedo *= 0.9 + 0.2 * vnoise3(q * 0.5);
    // the egg's long axis is Y in model space
    float along = vObj.y;
    float ang = atan(vObj.z, vObj.x);
    float zig = 0.14 + 0.06 * sin(ang * 5.0) + 0.04 * sin(ang * 11.0 + 1.3);
    float reach = smoothstep(-3.2 + 6.4 * uCrack, -3.2 + 6.4 * uCrack - 0.6, ang);
    float crack = (1.0 - smoothstep(0.012, 0.026, abs(along - zig))) * reach;
    // where the chick has pecked through, with two short cracks running up from it
    vec2 hp = vec2((ang - 0.6) * 0.26, along - zig - 0.03);
    float hole = (1.0 - smoothstep(0.045, 0.062, length(hp))) * step(0.3, uCrack);
    float up1 = (1.0 - smoothstep(0.009, 0.02, abs(hp.x - hp.y * 0.5))) * step(0.0, hp.y) * step(hp.y, 0.2);
    float up2 = (1.0 - smoothstep(0.009, 0.02, abs(hp.x + 0.09 + hp.y * 0.35))) * step(0.0, hp.y) * step(hp.y, 0.14);
    eggCrack = max(max(crack, hole), max(up1, up2) * step(0.3, uCrack));
    albedo = mix(albedo, vec3(0.03, 0.05, 0.06), eggCrack);
  }
  #endif

  // role and style grade
  float lum = dot(albedo, vec3(0.2126, 0.7152, 0.0722));
  albedo = mix(vec3(lum), albedo, uSat * uGrade.x) * uTint * uGrade.y;
  #ifdef USE_INSTANCING_COLOR
  albedo *= vInstColor;
  #endif

  // painterly variation: washes of slightly different value across big shapes
  float wash = LAYERED(vWorld.xz * uBrush.y + vWorld.y * 0.37).r;
  // the height is folded in at a slant, so upright surfaces vary along their length too
  vec2 slant = vWorld.xz + vWorld.y * vec2(0.37, 0.61);
  float wash2 = PLAIN(slant * uBrush.y * 3.0).b;
  albedo *= 1.0 + (wash - 0.5) * 2.0 * uBrush.x + (wash2 - 0.5) * uBrush.x;

  // sun
  float ndl = dot(N, uSunDir);
  float w = (ndl + uBand.w) / (1.0 + uBand.w);
  float wobble = (PLAIN(slant.yx * 2.6).a - 0.5) * uBrush.z;
  float lit = smoothstep(uBand.x - uBand.y, uBand.x + uBand.y, w + wobble);
  float core = smoothstep(uBand.x - 0.5 - uBand.y, uBand.x - 0.5 + uBand.y, w + wobble);

  float sh = mix(1.0, sunShadow(), uShadowAmt);
  float dp = mix(1.0, dapple(vWorld), uDappleAmt * uDapple.x);
  float sun = lit * sh * dp;

  vec3 amb = mix(uGroundAmb, uSkyAmb, N.y * 0.5 + 0.5) * ao;
  amb *= mix(1.0 - uBand.z, 1.0, core);
  // shade keeps its color: tint it instead of just dimming it
  vec3 shade = albedo * amb * mix(uShadeTint, vec3(1.0), sun);
  float slum = dot(shade, vec3(0.2126, 0.7152, 0.0722));
  shade = mix(vec3(slum), shade, uGrade.z);
  vec3 col = shade + albedo * uSunColor * sun * mix(0.75, 1.0, ao);

  // leaves light up when the sun is behind them
  float toward = max(dot(E, uSunDir), 0.0);
  float through = uTranslucency * (0.25 + 0.75 * pow(toward, 2.0)) * (1.0 - lit) * sh * dp;
  col += albedo * uSunColor * vec3(1.05, 1.0, 0.55) * through * 0.75;

  // rim light on the sun side, to pull the hero and the egg off the background
  float fres = pow(1.0 - max(dot(Ng, -E), 0.0), 3.0);
  col += uSunColor * fres * uRim * (0.25 + 0.75 * sh) * smoothstep(-0.4, 0.6, dot(Ng, uSunDir)) * 0.6;

  #ifdef ROLE_FEATHER
  {
    // a faint blue sheen across dark plumage, like a magpie
    float sheen = pow(1.0 - max(dot(Ng, -E), 0.0), 2.0) * (1.0 - smoothstep(0.08, 0.3, lum));
    col += vec3(0.10, 0.22, 0.42) * sheen * (0.35 + 0.65 * sun) * 0.9;
  }
  #endif

  #ifdef ROLE_EYE
  col += vec3(1.0) * pow(max(dot(reflect(E, Ng), uSunDir), 0.0), 40.0);
  #endif

  #ifdef ROLE_EGG
  {
    // The egg is the thing you chase, so it carries its own soft light from above the camera:
    // pale on top, deeper underneath, with a clean highlight. It reads as a solid shell in any light.
    vec3 Lv = normalize(vec3(0.0, 1.0, 0.0) * 0.95 - E * 0.55 + cross(E, vec3(0.0, 1.0, 0.0)) * 0.3);
    float form = dot(Ng, Lv);
    col *= mix(0.6, 1.34, smoothstep(-0.45, 0.85, form));
    col += uGlow * (0.02 + 0.16 * fres) * (1.0 - eggCrack);
    col += vec3(1.0, 0.98, 0.92) * pow(max(dot(reflect(E, Ng), Lv), 0.0), 18.0) * 0.5 * (1.0 - eggCrack);
  }
  #endif

  #ifdef ROLE_AMBER
  {
    // resin glows from inside: bright honey at the heart, deep orange at the edge
    float facing = max(dot(Ng, -E), 0.0);
    vec3 heart = vec3(1.0, 0.80, 0.30);
    vec3 edge = vec3(0.85, 0.33, 0.03);
    col = mix(edge, heart, pow(facing, 1.4)) * (0.85 + 0.25 * sun);
    col += vec3(1.0, 0.95, 0.8) * pow(max(dot(reflect(E, Ng), uSunDir), 0.0), 24.0) * 0.9;
    col += uGlow * 0.3;
  }
  #endif

  // mist: thicker low in the valley, warmer when you look toward the sun
  float dist = length(vWorld - cameraPosition);
  float b = uFog.z;
  float camH = cameraPosition.y - uFog.y;
  float ry = E.y;
  float ryb = abs(ry) < 0.0005 ? 0.0005 : ry;
  float heightFog = uFog.x * exp(-b * camH) * (1.0 - exp(-b * ryb * dist)) / (b * ryb);
  float fogAmt = 1.0 - exp(-(max(heightFog, 0.0) + uHaze.x * dist));
  fogAmt = min(fogAmt, uFog.w);
  #ifdef ROLE_AMBER
  fogAmt *= 0.35;
  #endif
  #ifdef ROLE_EGG
  fogAmt *= 0.5;
  #endif
  #ifdef ROLE_RIDGE
  // far ridges carry their own painted amount of mist, so the layers stack by design
  fogAmt = clamp(vPaint.a * uHaze.w, 0.0, 1.0);
  #endif
  vec3 fogCol = mix(uFogColor, uFogSun, pow(toward, uHaze.y) * uHaze.z);
  col = mix(col, fogCol, fogAmt);

  col = toDisplay(col);
  col += (hash21(gl_FragCoord.xy + fract(uTime)) - 0.5) / 255.0;
  // alpha carries how strongly outlines should draw here, fading out with the mist and with distance
  float lineFar = max(1.0 - smoothstep(uLineFade.x, uLineFade.y, dist), uKeepLine);
  gl_FragColor = vec4(col, uLine * (1.0 - fogAmt * 0.85) * lineFar);
}
`;

export interface PaintOptions {
  role: Role;
  look?: RoleLook;
}

const made: THREE.ShaderMaterial[] = [];

export function paintMaterial(role: Role): THREE.ShaderMaterial {
  const base = ROLE_BASE[role];
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    defines: { ...base.defines },
    side: base.side,
    uniforms: {
      ...world,
      uTint: { value: new THREE.Color(1, 1, 1) },
      uSat: { value: 1 },
      uTranslucency: { value: base.translucency },
      uPuff: { value: base.puff },
      uSway: { value: base.sway },
      uDappleAmt: { value: base.dapple },
      uShadowAmt: { value: base.shadow },
      uRim: { value: base.rim },
      uLine: { value: base.line },
      uKeepLine: { value: base.keepLine },
      uAo: { value: base.ao },
      uCrack: { value: 0.55 },
      uGlow: { value: new THREE.Color(0, 0, 0) },
      // x: lane width, y: how strongly the lanes show, z: half the width of the seam between lanes (ground only)
      uLanes: { value: new THREE.Vector4(0.68, 0, 0.08, 0) },
    },
  });
  mat.userData.role = role;
  mat.userData.base = base;
  made.push(mat);
  return mat;
}

/** Apply a style's per-role look (tint, saturation) to every paint material made so far. */
export function applyRoleLooks(looks: Partial<Record<Role, RoleLook>>, fallback: RoleLook = {}) {
  for (const mat of made) {
    const role = mat.userData.role as Role;
    const look = { ...fallback, ...(looks[role] ?? {}) };
    const tint = new THREE.Color(look.tint ?? '#ffffff');
    const val = look.val ?? 1;
    (mat.uniforms.uTint.value as THREE.Color).copy(tint).multiplyScalar(val);
    mat.uniforms.uSat.value = look.sat ?? 1;
  }
}

export function allPaintMaterials(): readonly THREE.ShaderMaterial[] {
  return made;
}

