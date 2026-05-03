/**
 * Ghost Arcade Community — particleSystem3D stub.
 *
 * Pro version had a GPU 3D particle system. OSS removes the plugin entry
 * from MediaTray; this stub exists only so Canvas.svelte compiles. Never
 * instantiated at runtime in OSS.
 */

export class ParticleSystem3D {
  width: number;
  height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  // Full call surface used by Canvas.svelte. All no-ops.
  init(..._args: unknown[]): void { /* */ }
  setParams(_params: Record<string, unknown>): void { /* */ }
  setMouse(..._args: unknown[]): void { /* */ }
  step(..._args: unknown[]): void { /* */ }
  update(_dt: number): void { /* */ }
  renderToTarget(..._args: unknown[]): void { /* */ }
  resize(_w: number, _h: number): void { /* */ }
  getTexture(): WebGLTexture | null { return null; }
  dispose(): void { /* */ }
}
