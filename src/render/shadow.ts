// The sun's shadow map: one orthographic view from the sun around a focus point.
// Only objects on SHADOW_LAYER are drawn into it.

import * as THREE from 'three';
import { world } from './paint';
import { SHADOW_LAYER } from '../world/assets';

const SIZE = 2048;

export class SunShadow {
  readonly target: THREE.WebGLRenderTarget;
  readonly camera: THREE.OrthographicCamera;
  private depthMaterial: THREE.ShaderMaterial;
  private bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);

  constructor(private halfExtent = 26, private depth = 160) {
    this.target = new THREE.WebGLRenderTarget(SIZE, SIZE, {
      depthTexture: new THREE.DepthTexture(SIZE, SIZE, THREE.UnsignedIntType),
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
    });
    // comparison sampling lets the GPU blend neighboring shadow tests, which smooths the edges
    this.target.depthTexture!.compareFunction = THREE.LessEqualCompare;
    this.target.depthTexture!.minFilter = THREE.LinearFilter;
    this.target.depthTexture!.magFilter = THREE.LinearFilter;
    this.camera = new THREE.OrthographicCamera(-halfExtent, halfExtent, halfExtent, -halfExtent, 1, depth);
    this.camera.layers.set(SHADOW_LAYER);
    this.depthMaterial = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      colorWrite: false,
      vertexShader: /* glsl */ `
        #include <skinning_pars_vertex>
        void main() {
          vec3 transformed = position;
          #include <skinbase_vertex>
          #include <skinning_vertex>
          mat4 m = modelMatrix;
          #ifdef USE_INSTANCING
          m = modelMatrix * instanceMatrix;
          #endif
          gl_Position = projectionMatrix * viewMatrix * m * vec4(transformed, 1.0);
        }`,
      fragmentShader: /* glsl */ `void main() { gl_FragColor = vec4(1.0); }`,
    });
  }

  private right = new THREE.Vector3();
  private upL = new THREE.Vector3();
  private snapped = new THREE.Vector3();

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, focusIn: THREE.Vector3) {
    const sun = world.uSunDir.value;
    // Move the map in whole-texel steps. Shadows of things that stand still then land on
    // exactly the same texels after every refresh, so nothing shimmers as the runner moves.
    this.right.set(0, 1, 0).cross(sun).normalize();
    this.upL.copy(sun).cross(this.right).normalize();
    const texel = (this.halfExtent * 2) / SIZE;
    const fr = focusIn.dot(this.right);
    const fu = focusIn.dot(this.upL);
    const focus = this.snapped
      .copy(focusIn)
      .addScaledVector(this.right, Math.round(fr / texel) * texel - fr)
      .addScaledVector(this.upL, Math.round(fu / texel) * texel - fu);
    this.camera.position.copy(focus).addScaledVector(sun, this.depth * 0.6);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(focus);
    this.camera.updateMatrixWorld();
    this.camera.updateProjectionMatrix();

    const prevOverride = scene.overrideMaterial;
    const prevTarget = renderer.getRenderTarget();
    scene.overrideMaterial = this.depthMaterial;
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, this.camera);
    renderer.setRenderTarget(prevTarget);
    scene.overrideMaterial = prevOverride;

    world.uShadowMatrix.value
      .copy(this.bias)
      .multiply(this.camera.projectionMatrix)
      .multiply(this.camera.matrixWorldInverse);
    world.uShadowMap.value = this.target.depthTexture;
    world.uShadowParams.value.set(1 / SIZE, 0.0016, 1, 1);
  }
}
