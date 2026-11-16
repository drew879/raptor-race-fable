// Loads model kits built by the Blender scripts and hands out geometry by object name.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { paintMaterial, type Role } from '../render/paint';

export interface Part {
  role: Role;
  geometry: THREE.BufferGeometry;
}
export type Kit = Map<string, Part[]>;

/** Casters render into the sun's shadow map on this layer. */
export const SHADOW_LAYER = 1;

const loader = new GLTFLoader();
const materials = new Map<Role, THREE.ShaderMaterial>();

export function materialFor(role: Role): THREE.ShaderMaterial {
  let m = materials.get(role);
  if (!m) {
    m = paintMaterial(role);
    materials.set(role, m);
  }
  return m;
}

function prepare(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const color = geometry.getAttribute('color');
  if (color) {
    geometry.setAttribute('aPaint', color);
    geometry.deleteAttribute('color');
  }
  if (!geometry.getAttribute('uv')) {
    const n = geometry.getAttribute('position').count;
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  }
  return geometry;
}

export async function loadKit(url: string): Promise<Kit> {
  const gltf = await loader.loadAsync(url);
  const kit: Kit = new Map();
  for (const node of gltf.scene.children) {
    const parts: Part[] = [];
    node.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.Material;
      parts.push({ role: mat.name as Role, geometry: prepare(mesh.geometry) });
    });
    kit.set(node.name, parts);
  }
  return kit;
}

function parts(kit: Kit, name: string): Part[] {
  const p = kit.get(name);
  if (!p) throw new Error(`No model named ${name}`);
  return p;
}

/** One copy of a model. */
export function instance(kit: Kit, name: string, shadow = true): THREE.Group {
  const group = new THREE.Group();
  group.name = name;
  for (const part of parts(kit, name)) {
    const mesh = new THREE.Mesh(part.geometry, materialFor(part.role));
    if (shadow) mesh.layers.enable(SHADOW_LAYER);
    group.add(mesh);
  }
  return group;
}

export interface Placement {
  position: THREE.Vector3;
  yaw: number;
  scale: number;
  tint?: THREE.Color;
  tilt?: THREE.Quaternion;
}

/** Many copies of a model drawn in one call per part. */
export function instances(
  kit: Kit,
  name: string,
  list: Placement[],
  shadow: boolean | ((role: Role) => boolean) = true,
): THREE.Group {
  const group = new THREE.Group();
  group.name = name;
  if (list.length === 0) return group;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const s = new THREE.Vector3();
  const white = new THREE.Color(1, 1, 1);
  for (const part of parts(kit, name)) {
    const mesh = new THREE.InstancedMesh(part.geometry, materialFor(part.role), list.length);
    list.forEach((pl, i) => {
      q.setFromAxisAngle(up, pl.yaw);
      if (pl.tilt) q.premultiply(pl.tilt);
      s.setScalar(pl.scale);
      m.compose(pl.position, q, s);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, pl.tint ?? white);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
    if (typeof shadow === 'function' ? shadow(part.role) : shadow) mesh.layers.enable(SHADOW_LAYER);
    group.add(mesh);
  }
  return group;
}
