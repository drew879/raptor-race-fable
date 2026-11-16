// A tiling texture of smooth noise, made once at startup. The paint shader and the finishing
// pass read it where they used to work noise out for every pixel, which costs a phone far less.
//
// What each channel holds, across one tile:
//   r  layered noise: 16 cells, plus finer layers at 32 and 64
//   g  the same recipe from other random numbers, with a fourth layer at 48 (dappled light)
//   b  plain noise, 32 cells
//   a  plain noise, 32 cells, from other random numbers

import * as THREE from 'three';

const SIZE = 512;

function lattice(cells: number, seed: number): Float32Array {
  const out = new Float32Array(cells * cells);
  let a = seed >>> 0;
  for (let i = 0; i < out.length; i++) {
    // mulberry32
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    out[i] = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return out;
}

/** Smooth noise that wraps at the tile's edge. x and y are in cells. */
function sample(lat: Float32Array, cells: number, x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let fx = x - xi;
  let fy = y - yi;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const x0 = ((xi % cells) + cells) % cells;
  const y0 = ((yi % cells) + cells) % cells;
  const x1 = (x0 + 1) % cells;
  const y1 = (y0 + 1) % cells;
  const a = lat[y0 * cells + x0];
  const b = lat[y0 * cells + x1];
  const c = lat[y1 * cells + x0];
  const d = lat[y1 * cells + x1];
  return a + (b - a) * fx + (c - a + (a - b - c + d) * fx) * fy;
}

let made: THREE.DataTexture | null = null;

export function noiseTexture(): THREE.DataTexture {
  if (made) return made;
  const r = [lattice(16, 11), lattice(32, 23), lattice(64, 37)];
  const g = [lattice(16, 101), lattice(32, 211), lattice(64, 307), lattice(48, 401)];
  const b = lattice(32, 503);
  const a = lattice(32, 601);
  // Noise built on a grid peaks on the grid, and a cut through it (dappled light, pebbles)
  // then shows dots in rows. So the page is read through a gentle, wrapping warp, and each
  // layer sits a different part-cell off the others.
  const warpU = lattice(8, 701);
  const warpV = lattice(8, 809);
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    const v0 = (y + 0.5) / SIZE;
    for (let x = 0; x < SIZE; x++) {
      const u0 = (x + 0.5) / SIZE;
      const u = u0 + (sample(warpU, 8, u0 * 8, v0 * 8) - 0.5) * 0.07;
      const v = v0 + (sample(warpV, 8, u0 * 8, v0 * 8) - 0.5) * 0.07;
      const layered = (l: Float32Array[]) =>
        sample(l[0], 16, u * 16, v * 16) * 0.55 +
        sample(l[1], 32, u * 32 + 0.37, v * 32 + 0.61) * 0.3 +
        sample(l[2], 64, u * 64 + 0.71, v * 64 + 0.23) * 0.15;
      const i = (y * SIZE + x) * 4;
      data[i] = Math.round(layered(r) * 255);
      data[i + 1] = Math.round((layered(g) * 0.7 + sample(g[3], 48, u * 48 + 0.53, v * 48 + 0.19) * 0.3) * 255);
      data[i + 2] = Math.round(sample(b, 32, u * 32, v * 32) * 255);
      data[i + 3] = Math.round(sample(a, 32, u * 32 + 0.41, v * 32 + 0.67) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  made = tex;
  return tex;
}
