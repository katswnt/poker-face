// Deterministic flop-texture classifier (spec §3.2): assigns each of the 22,100 flops to one of
// the 12 B4 library flops (the strata), so the library's texture-picked flops can be weighted
// by how often their texture occurs. The rules are a modelling input, stated here in full:
//
//   monotone                                   → Qs9s4s
//   paired / trips: paired rank ≥ T            → JcJd4s,  else → 8s8d3h
//   two-tone, unpaired: ace-high               → AhTh5c
//                       connected, high ≤ 7    → 7c6c5d
//                       connected, high ≥ 8    → 9h8h6c
//                       otherwise              → Td7d3c
//   rainbow, unpaired:  connected, ≥ 2 cards ≥ T → KhQdTc
//                       ace-high               → Ad8c3s
//                       connected, high ≤ 7    → 5h4c2d
//                       connected, high ≥ 8    → Tc9d7s
//                       high ≥ J               → Ks7h2d
//                       otherwise              → Td7d3c
//
// "Connected" = three distinct ranks inside one five-rank window (ace also low), the library
// descriptor's `straightPossible`.

const RANKS = "23456789TJQKA";
const SUITS = "cdhs";

export const TEXTURE_STRATA = [
  "srp-btn-bb-ks7h2d", "srp-btn-bb-ad8c3s", "srp-btn-bb-khqdtc", "srp-btn-bb-9h8h6c",
  "srp-btn-bb-qs9s4s", "srp-btn-bb-td7d3c", "srp-btn-bb-8s8d3h", "srp-btn-bb-5h4c2d",
  "srp-btn-bb-tc9d7s", "srp-btn-bb-ahth5c", "srp-btn-bb-jcjd4s", "srp-btn-bb-7c6c5d",
] as const;
export type TextureStratum = (typeof TEXTURE_STRATA)[number];

/** Card index 0..51 = rank·4 + suit (rank 0 = deuce), or −1 if malformed. */
export function parseCard(card: string): number {
  const r = RANKS.indexOf(card[0]), s = SUITS.indexOf(card[1]);
  if (card.length !== 2 || r < 0 || s < 0) throw new Error(`bad card "${card}"`);
  return r * 4 + s;
}

export const cardName = (index: number) => RANKS[index >> 2] + SUITS[index & 3];

function connected(values: readonly number[]): boolean {
  if (new Set(values).size !== 3) return false;
  for (let low = -1; low <= 8; low++) {
    if (values.every(v => (v >= low && v <= low + 4) || (v === 12 && low === -1))) return true;
  }
  return false;
}

/** Stratum of a flop given as three card indices. */
export function classifyFlopTexture(cards: readonly [number, number, number]): TextureStratum {
  const values = cards.map(c => c >> 2).sort((a, b) => b - a); // 0 = deuce … 12 = ace
  const suits = new Set(cards.map(c => c & 3)).size;
  const distinct = new Set(values).size;
  const high = values[0], ten = RANKS.indexOf("T");
  if (suits === 1) return "srp-btn-bb-qs9s4s";
  if (distinct < 3) {
    const paired = values[0] === values[1] ? values[0] : values[1];
    return paired >= ten ? "srp-btn-bb-jcjd4s" : "srp-btn-bb-8s8d3h";
  }
  const isConnected = connected(values);
  const seven = RANKS.indexOf("7");
  if (suits === 2) {
    if (high === 12) return "srp-btn-bb-ahth5c";
    if (isConnected) return high <= seven ? "srp-btn-bb-7c6c5d" : "srp-btn-bb-9h8h6c";
    return "srp-btn-bb-td7d3c";
  }
  if (isConnected && values.filter(v => v >= ten).length >= 2) return "srp-btn-bb-khqdtc";
  if (high === 12) return "srp-btn-bb-ad8c3s";
  if (isConnected) return high <= seven ? "srp-btn-bb-5h4c2d" : "srp-btn-bb-tc9d7s";
  if (high >= RANKS.indexOf("J")) return "srp-btn-bb-ks7h2d";
  return "srp-btn-bb-td7d3c";
}

/** All C(52,3) = 22,100 flops as sorted card-index triples, with their stratum. */
export const ALL_FLOPS: readonly { readonly cards: readonly [number, number, number]; readonly stratum: TextureStratum }[] = (() => {
  const out: { cards: [number, number, number]; stratum: TextureStratum }[] = [];
  for (let a = 0; a < 52; a++) for (let b = a + 1; b < 52; b++) for (let c = b + 1; c < 52; c++) {
    out.push({ cards: [a, b, c], stratum: classifyFlopTexture([a, b, c]) });
  }
  return out;
})();

/** Fraction of all 22,100 flops in each stratum (sums to 1). */
export function stratumWeights(): Record<TextureStratum, number> {
  const counts = Object.fromEntries(TEXTURE_STRATA.map(s => [s, 0])) as Record<TextureStratum, number>;
  for (const f of ALL_FLOPS) counts[f.stratum] += 1;
  for (const s of TEXTURE_STRATA) counts[s] /= ALL_FLOPS.length;
  return counts;
}

/**
 * For one two-card combo: fraction of the flops that do not contain its cards (C(50,3) = 19,600)
 * falling in each stratum. This is the combo's own texture distribution (e.g. AA sees fewer
 * ace-high flops).
 */
export function comboStratumWeights(c1: number, c2: number): Record<TextureStratum, number> {
  const counts = Object.fromEntries(TEXTURE_STRATA.map(s => [s, 0])) as Record<TextureStratum, number>;
  let total = 0;
  for (const f of ALL_FLOPS) {
    const [a, b, c] = f.cards;
    if (a === c1 || a === c2 || b === c1 || b === c2 || c === c1 || c === c2) continue;
    counts[f.stratum] += 1;
    total += 1;
  }
  for (const s of TEXTURE_STRATA) counts[s] /= total;
  return counts;
}
