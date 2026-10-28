// Scene-change detection on tiny grayscale thumbnails. Pure: works on pixel arrays.

export const THUMB_W = 32;
export const THUMB_H = 18;

export function toGray(rgba: ArrayLike<number>): Uint8Array {
  const g = new Uint8Array(rgba.length / 4);
  for (let i = 0; i < g.length; i++) g[i] = (rgba[i * 4] * 299 + rgba[i * 4 + 1] * 587 + rgba[i * 4 + 2] * 114) / 1000;
  return g;
}

/** Mean absolute difference, 0 (same) .. 1 (inverted). */
export function diff(a: Uint8Array, b: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length / 255;
}

/** DRM players hand back black frames to screen capture. */
export function isBlack(g: Uint8Array): boolean {
  let sum = 0;
  for (const v of g) sum += v;
  return sum / g.length < 6;
}

/**
 * A keyframe is a frame that differs from the last keyframe and has settled
 * (the next sample looks the same), so slide transitions and scrolling are skipped.
 */
export class SceneDetector {
  private key?: Uint8Array;
  private prev?: Uint8Array;

  constructor(private threshold = 0.06) {}

  push(g: Uint8Array): boolean {
    const prev = this.prev;
    this.prev = g;
    if (!this.key) {
      this.key = g;
      return true;
    }
    const changed = diff(g, this.key) > this.threshold;
    const settled = !!prev && diff(g, prev) < this.threshold / 2;
    if (changed && settled) {
      this.key = g;
      return true;
    }
    return false;
  }

  reset() {
    this.key = this.prev = undefined;
  }
}
