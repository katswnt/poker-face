// Deterministic randomness for the drills. Every question is a pure function of
// (type, seed, level); the salt keeps the same seed from producing correlated numbers
// across drill types.
import { mulberry32 } from "@/lib/poker/equity";
import type { DrillType, Level } from "./types";

export type Rng = () => number;

function salt(text: string): number {
  // FNV-1a, 32-bit.
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function questionRng(type: DrillType, seed: number, level: Level): Rng {
  return mulberry32((salt(`${type}:${level}`) ^ (seed >>> 0)) >>> 0);
}

export function sessionRng(seed: number): Rng {
  return mulberry32(seed >>> 0);
}

/** Uniform integer in [lo, hi]. */
export function randInt(rng: Rng, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

/** Uniform multiple of 0.5 in [lo, hi] (lo, hi multiples of 0.5). */
export function randHalf(rng: Rng, lo: number, hi: number): number {
  return randInt(rng, lo * 2, hi * 2) / 2;
}

/** A fresh 32-bit seed. */
export function nextSeed(rng: Rng): number {
  return Math.floor(rng() * 0x1_0000_0000) >>> 0;
}
