/** Exact finite joint card law; deliberately separate from texture/model fitting. */
export interface WeightedHand { readonly cards: readonly [number, number]; readonly weight: number }
type Seat = 0 | 1;
const choose = (n: number, k: number) => { let x = 1; for (let i = 1; i <= k; i++) x *= (n - i + 1) / i; return Math.round(x); };
const disjoint = (a: readonly number[], b: readonly number[]) => !a.some(c => b.includes(c));

export function jointMeasure(deckSize: number, boardSize: number, input: readonly [readonly WeightedHand[], readonly WeightedHand[]]) {
  if (!Number.isInteger(deckSize) || deckSize < 4 || deckSize > 52 || !Number.isInteger(boardSize) || boardSize < 0 || boardSize > deckSize - 4)
    throw new Error("invalid deck/board size");
  const validCards = (cards: readonly number[], length: number) => {
    if (cards.length !== length || new Set(cards).size !== length || cards.some(c => !Number.isInteger(c) || c < 0 || c >= deckSize))
      throw new Error("invalid cards or duplicate card");
  };
  const ranges = input.map(range => {
    const seen = new Set<string>();
    return range.map(hand => {
      validCards(hand.cards, 2);
      if (!Number.isFinite(hand.weight) || hand.weight <= 0 || hand.weight > 1) throw new Error("invalid hand weight");
      const cards = [...hand.cards].sort((a, b) => a - b) as [number, number], key = cards.join(",");
      if (seen.has(key)) throw new Error("duplicate range hand"); seen.add(key);
      return { cards, weight: hand.weight };
    });
  });
  const marginal = ranges.map(r => new Float64Array(r.length));
  const pairs: { h: number; k: number; weight: number }[] = [];
  let partition = 0;
  for (let h = 0; h < ranges[0].length; h++) for (let k = 0; k < ranges[1].length; k++) {
    const a = ranges[0][h], b = ranges[1][k]; if (!disjoint(a.cards, b.cards)) continue;
    const weight = a.weight * b.weight; partition += weight; marginal[0][h] += weight; marginal[1][k] += weight;
    pairs.push({ h, k, weight });
  }
  if (!(partition > 0)) throw new Error("no compatible private hands");
  const denominator = partition * choose(deckSize - 4, boardSize);
  const hand = (player: Seat, index: number) => {
    if ((player !== 0 && player !== 1) || !Number.isInteger(index) || index < 0 || index >= ranges[player].length) throw new Error("invalid hand index");
    return ranges[player][index];
  };
  const handMass = (player: Seat, index: number) => { hand(player, index); return marginal[player][index] / partition; };
  const jointMass = (h: number, k: number, board: readonly number[]) => {
    const a = hand(0, h), b = hand(1, k); validCards(board, boardSize);
    return disjoint(a.cards, b.cards) && disjoint(board, a.cards) && disjoint(board, b.cards) ? a.weight * b.weight / denominator : 0;
  };
  const boardMass = (board: readonly number[]) => {
    validCards(board, boardSize); let raw = 0;
    for (const p of pairs) if (disjoint(board, ranges[0][p.h].cards) && disjoint(board, ranges[1][p.k].cards)) raw += p.weight;
    return raw / denominator;
  };
  const handBoardMass = (player: Seat, index: number, board: readonly number[]) => {
    hand(player, index); validCards(board, boardSize);
    return ranges[1 - player].reduce((sum, _, other) => sum + (player === 0 ? jointMass(index, other, board) : jointMass(other, index, board)), 0);
  };
  const conditional = (joint: number, mass: number) => { if (!(mass > 0)) throw new Error("conditioning event has zero mass"); return joint / mass; };
  return { partition, handMass, jointMass, boardMass, handBoardMass,
    handGivenBoard: (player: Seat, index: number, board: readonly number[]) => conditional(handBoardMass(player, index, board), boardMass(board)),
    boardGivenHand: (player: Seat, index: number, board: readonly number[]) => conditional(handBoardMass(player, index, board), handMass(player, index)),
  };
}

/** Horvitz–Thompson total / known full-population mass. Values already include orbit size.
 * Each stratum must be a simple random sample without replacement, disjoint from known units.
 * This function estimates a numerator; it does not infer uncertainty or renormalize its sample.
 */
export function estimateJointNumerator(denominator: number, known: readonly number[],
  strata: readonly { readonly populationSize: number; readonly values: readonly number[] }[]) {
  if (!Number.isFinite(denominator) || denominator <= 0 || !known.every(Number.isFinite)) throw new Error("invalid full-population denominator or values");
  let total = known.reduce((a, b) => a + b, 0);
  for (const { populationSize, values } of strata) {
    if (!Number.isInteger(populationSize) || populationSize < 1 || values.length < 1 || values.length > populationSize || !values.every(Number.isFinite))
      throw new Error("invalid sampled stratum");
    total += populationSize / values.length * values.reduce((a, b) => a + b, 0);
  }
  return total / denominator;
}
