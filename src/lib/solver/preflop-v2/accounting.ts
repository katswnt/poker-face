/** Research-only chip conventions. No production policy or fitted payoff is changed. */
type Pair = readonly [number, number];
const finiteNonnegative = (n: number, name: string) => {
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be finite and nonnegative`);
};
const conserved = (actual: number, expected: number) => Math.abs(actual - expected) <= 1e-10;

/** Receipts include returned uncalled chips. Values include the original pot, less new wagers. */
export function continuationValues(pot: number, stack: number, future: Pair, receipts: Pair): [number, number] {
  finiteNonnegative(pot, "pot"); finiteNonnegative(stack, "stack");
  for (const n of future) { finiteNonnegative(n, "future contribution"); if (n > stack) throw new Error("contribution exceeds stack"); }
  for (const n of receipts) finiteNonnegative(n, "receipt");
  if (!conserved(receipts[0] + receipts[1], pot + future[0] + future[1])) throw new Error("receipts do not conserve chips");
  const values: [number, number] = [receipts[0] - future[0], receipts[1] - future[1]];
  if (values.some(g => g < -stack - 1e-10 || g > pot + stack + 1e-10)) throw new Error("value exceeds physical stack bounds");
  return values;
}

/** Equal starting stacks, no rake: refund unmatched wagers, then award the contested pot. */
export function settleContinuation(pot: number, stack: number, future: Pair, winner: 0 | 1 | "split") {
  if (winner !== 0 && winner !== 1 && winner !== "split") throw new Error("invalid winner");
  const matched = Math.min(...future), contest = pot + 2 * matched;
  const receipts: [number, number] = [future[0] - matched, future[1] - matched];
  if (winner === "split") { receipts[0] += contest / 2; receipts[1] += contest / 2; }
  else receipts[winner] += contest;
  return { receipts, values: continuationValues(pot, stack, future, receipts) };
}

/** Native root ev is zero-sum OOP/IP; preflop values are from-now IP/OOP.
 * Exact references retain the strict default. Float32 callers must explicitly opt into
 * at most the existing B2 referee bound and report the raw residual; never shift targets.
 */
export function bridgeToPreflopValues(ev: Pair, pot: number, zeroSumToleranceChips = 1e-10): [number, number] {
  finiteNonnegative(pot, "pot");
  if (!Number.isFinite(zeroSumToleranceChips) || zeroSumToleranceChips < 0 || zeroSumToleranceChips > 0.0002)
    throw new Error("tolerance must be within the existing 0.0002-chip B2 referee bound");
  if (!ev.every(Number.isFinite) || Math.abs(ev[0] + ev[1]) > zeroSumToleranceChips) throw new Error("expected zero-sum bridge root values within the declared tolerance");
  return [ev[1] + pot / 2, ev[0] + pot / 2];
}
