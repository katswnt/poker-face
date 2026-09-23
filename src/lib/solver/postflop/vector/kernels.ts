import type { VectorRange, VectorRanges } from "./ranges";

export function createVectorKernelScratch(opponentHands: number) {
  return { cardMass: new Float64Array(52), cardCount: new Uint16Array(52),
    weights: new Float64Array(opponentHands), included: new Uint8Array(opponentHands), total: 0, count: 0,
    calls: 0, queries: 0, fallbackQueries: 0 };
}
export type VectorKernelScratch = ReturnType<typeof createVectorKernelScratch>;

function clearPool(scratch: VectorKernelScratch) {
  scratch.cardMass.fill(0); scratch.cardCount.fill(0); scratch.included.fill(0);
  scratch.total = 0; scratch.count = 0;
}
function add(scratch: VectorKernelScratch, opponent: VectorRange, hand: number) {
  const weight = scratch.weights[hand];
  if (weight === 0) return;
  scratch.total += weight; scratch.count++;
  scratch.cardMass[opponent.card0[hand]] += weight; scratch.cardMass[opponent.card1[hand]] += weight;
  scratch.cardCount[opponent.card0[hand]]++; scratch.cardCount[opponent.card1[hand]]++;
  scratch.included[hand] = 1;
}
function query(scratch: VectorKernelScratch, own: VectorRange, opponent: VectorRange, hand: number): number {
  scratch.queries++;
  const a = own.card0[hand], b = own.card1[hand], same = own.sameOpponent[hand];
  const includedSame = same >= 0 && scratch.included[same] === 1;
  const count = scratch.count - scratch.cardCount[a] - scratch.cardCount[b] + Number(includedSame);
  if (count < 0) throw new Error("Negative compatible support count");
  if (count === 0) return 0;
  const mass = scratch.total - scratch.cardMass[a] - scratch.cardMass[b] + (includedSame ? scratch.weights[same] : 0);
  // Cancellation can hide small positive compatible mass. Never turn that into an
  // impossible hand or negative probability; recover it from an explicit sum.
  // With at most 64 additions, keep ample relative precision even when this mass
  // becomes the entire root normalizer. Merely testing mass > epsilon*total is
  // insufficient: it can retain a large relative error in a tiny legal population.
  if (mass > 0.02 * scratch.total) return mass;
  scratch.fallbackQueries++;
  let exact = 0;
  for (let j = 0; j < opponent.hands.length; j++) {
    if (!scratch.included[j] || opponent.card0[j] === a || opponent.card1[j] === a
      || opponent.card0[j] === b || opponent.card1[j] === b) continue;
    exact += scratch.weights[j];
  }
  return exact;
}

/** Caller supplies opponent root-weight × action-reach, not a normalized posterior. */
export function vectorTerminalValues(ranges: VectorRanges, player: 0 | 1, river: number,
  opponentWeights: Float64Array, scale: number, foldSign: number, out: Float64Array,
  scratch: VectorKernelScratch): void {
  const own = ranges.players[player], opponent = ranges.players[1 - player];
  if (out.length !== own.hands.length || opponentWeights.length !== opponent.hands.length
    || scratch.weights.length !== opponent.hands.length) throw new Error("Vector kernel dimensions disagree");
  if (!Number.isFinite(scale) || scale < 0 || ![-1, 0, 1].includes(foldSign)
    || !Number.isInteger(river) || river < -1 || river >= 48 || (foldSign === 0 && river < 0)) {
    throw new Error("Invalid vector terminal request");
  }
  scratch.calls++;
  const card = river < 0 ? -1 : ranges.riverCardIds[river];
  for (let j = 0; j < opponent.hands.length; j++) {
    const weight = opponentWeights[j];
    if (!Number.isFinite(weight) || weight < 0 || weight > 1) throw new Error("Opponent reach weight must be finite and in [0,1]");
    scratch.weights[j] = opponent.card0[j] === card || opponent.card1[j] === card ? 0 : weight;
  }
  out.fill(0);
  if (foldSign !== 0) {
    clearPool(scratch);
    for (let j = 0; j < opponent.hands.length; j++) add(scratch, opponent, j);
    for (let i = 0; i < own.hands.length; i++) {
      if (own.compatibleCounts[(river + 1) * own.hands.length + i] === 0) continue;
      out[i] = foldSign * scale * query(scratch, own, opponent, i);
    }
    return;
  }
  const ownOrder = own.rankOrders[river], otherOrder = opponent.rankOrders[river];
  const ownOffset = river * own.hands.length, otherOffset = river * opponent.hands.length;
  // Two strict sweeps avoid deriving tiny stronger mass by subtracting nearly
  // equal totals. Equal ranks are excluded from both: ties have zero net utility.
  for (const direction of [1, -1]) {
    clearPool(scratch);
    let cursor = direction === 1 ? 0 : otherOrder.length - 1;
    for (let ordinal = 0; ordinal < ownOrder.length; ordinal++) {
      const i = ownOrder[direction === 1 ? ordinal : ownOrder.length - 1 - ordinal];
      const rank = own.ranks[ownOffset + i];
      while (cursor >= 0 && cursor < otherOrder.length
        && direction * opponent.ranks[otherOffset + otherOrder[cursor]] < direction * rank) {
        add(scratch, opponent, otherOrder[cursor]); cursor += direction;
      }
      if (own.compatibleCounts[(river + 1) * own.hands.length + i] > 0) {
        out[i] += direction * scale * query(scratch, own, opponent, i);
      }
    }
  }
}

/** Deliberately quadratic oracle. Does not use incidence sums, same-hand lookup or rank sweeps. */
export function naiveTerminalValues(ranges: VectorRanges, player: 0 | 1, river: number,
  opponentWeights: Float64Array, scale: number, foldSign: number, out: Float64Array): void {
  const own = ranges.players[player], opponent = ranges.players[1 - player];
  const card = river < 0 ? undefined : ranges.rivers[river];
  out.fill(0);
  own.hands.forEach((hand, i) => {
    if (card && hand.includes(card)) return;
    opponent.hands.forEach((other, j) => {
      if ((card && other.includes(card)) || hand.some(c => other.includes(c))) return;
      const sign = foldSign || Math.sign(own.ranks[river * own.hands.length + i] - opponent.ranks[river * opponent.hands.length + j]);
      out[i] += opponentWeights[j] * sign * scale;
    });
  });
}
