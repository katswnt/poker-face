/** Pure observational arithmetic. A timing band is not a confidence interval or device guarantee. */
function checked(values: readonly number[]) {
  if (!values.length) throw new Error("Empty observations");
  if (values.some(n => !Number.isFinite(n) || n < 0)) throw new Error("Observations must be finite and nonnegative");
  return [...values].sort((a, b) => a - b);
}

export function summarizeTimings(values: readonly number[]) {
  const sorted = checked(values);
  const rank = (p: number) => sorted[Math.ceil(p * sorted.length) - 1];
  return { count: sorted.length, min: sorted[0], p50: rank(.5), p95: rank(.95), max: sorted.at(-1)! };
}

/** Envelope of observed solve ratios plus observed non-solve overhead. Not a fitted p95. */
export function extrapolateTimeBand(nativeSolveMs: number, ratios: readonly number[], overheadMs: readonly number[]) {
  checked([nativeSolveMs]); const r = checked(ratios), o = checked(overheadMs);
  return { lowerMs: nativeSolveMs * r[0] + o[0], upperMs: nativeSolveMs * r.at(-1)! + o.at(-1)! };
}
