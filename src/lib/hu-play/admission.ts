/** A necessary reach-mass bound, NOT a solver admission verdict or a quality estimate. */
export interface ReachCapacityBound {
  readonly totalHands: number;
  readonly retainedMass: number;
  readonly handsForTarget: number;
  readonly possible: boolean;
}

export function reachCapacityBound(weights: readonly number[], limit: number, target: number): ReachCapacityBound {
  if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isFinite(target) || target <= 0 || target > 1) {
    throw new Error("Invalid reach capacity or retained-mass target");
  }
  if (!weights.length || weights.some(w => !Number.isFinite(w) || w < 0)) throw new Error("Invalid reach weights");
  const maximum = weights.reduce((m, w) => Math.max(m, w), 0);
  if (maximum === 0) throw new Error("Range has no positive reach");
  const sorted = weights.filter(w => w > 0).map(w => {
    const scaled = w / maximum;
    if (scaled === 0) throw new Error("Reach scaling would underflow a positive hand");
    return scaled;
  }).sort((a, b) => b - a);
  // Compensated prefix sums. Scaling first keeps finite input magnitudes from overflowing.
  let sum = 0, correction = 0;
  const prefixes = sorted.map(w => {
    const y = w - correction, next = sum + y;
    correction = (next - sum) - y; sum = next; return sum;
  });
  const retainedMass = prefixes[Math.min(limit, sorted.length) - 1] / sum;
  const handsForTarget = prefixes.findIndex(v => v / sum >= target) + 1;
  return { totalHands: sorted.length, retainedMass, handsForTarget, possible: retainedMass >= target };
}
