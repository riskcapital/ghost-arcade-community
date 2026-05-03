/**
 * Ghost Arcade Community — fluidSimulation stub.
 *
 * Pro version had a GPU fluid solver (Navier-Stokes advection). OSS strips
 * it — the FluidGen plugin entry is removed from MediaTray and the
 * `fluidDistort` Premium effect is gone. This stub exists only so
 * Canvas.svelte's import statements compile; the class is never
 * instantiated at runtime in the OSS build.
 */

export type FluidMode = 'smoke' | 'water' | 'fire' | 'plasma';

export class FluidSimulation {
  width: number;
  height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  // Full call surface used by Canvas.svelte (kept for type compat).
  // Every method is a no-op; class never instantiated in OSS.
  init(..._args: unknown[]): void { /* */ }
  setMode(_mode: FluidMode, ..._rest: unknown[]): void { /* */ }
  setRenderParams(_params: Record<string, unknown>): void { /* */ }
  setParams(_params: Record<string, unknown>): void { /* */ }
  injectCamera(..._args: unknown[]): void { /* */ }
  addVelocity(..._args: unknown[]): void { /* */ }
  addDensity(..._args: unknown[]): void { /* */ }
  render(..._args: unknown[]): void { /* */ }
  resize(_w: number, _h: number): void { /* */ }
  step(..._args: unknown[]): void { /* */ }
  getTexture(): WebGLTexture | null { return null; }
  dispose(): void { /* */ }
}
