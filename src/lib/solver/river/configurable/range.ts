import {
  RIVER_RANKS,
  RIVER_SUITS,
  canonicalRiverCombo,
  parseRiverCombo,
  riverComboKey,
  type RiverCard,
  type RiverCombo,
  type RiverRank,
} from "../cards";

export const CONFIGURABLE_RIVER_RANGE_PARSER_VERSION = 1;

export interface ConfigurableRiverRangeEntry {
  readonly cards: RiverCombo;
  readonly weight: number;
}

export interface ParsedConfigurableRiverRange {
  readonly entries: readonly ConfigurableRiverRangeEntry[];
  readonly tokens: readonly string[];
  readonly blockedComboCount: number;
}

const RANK_INDEX = new Map(RIVER_RANKS.map((rank, index) => [rank, index]));
const CLASS_PATTERN = /^([2-9TJQKA])([2-9TJQKA])([so])?$/;

function parseWeight(raw: string | undefined, token: string): number {
  if (raw === undefined) return 1;
  const percentage = raw.endsWith("%");
  const numeric = Number(percentage ? raw.slice(0, -1) : raw);
  if (!Number.isFinite(numeric) || numeric <= 0 || (percentage && numeric > 100)) {
    throw new Error(`Range token ${token} has invalid weight ${raw}`);
  }
  return percentage ? numeric / 100 : numeric;
}

function splitWeightedToken(token: string): { readonly shape: string; readonly weight: number } {
  const pieces = token.split(":");
  if (pieces.length > 2 || !pieces[0]) throw new Error(`Invalid range token ${token}`);
  return { shape: pieces[0], weight: parseWeight(pieces[1], token) };
}

function orderedRanks(left: RiverRank, right: RiverRank): readonly [RiverRank, RiverRank] {
  return RANK_INDEX.get(left)! >= RANK_INDEX.get(right)! ? [left, right] : [right, left];
}

function expandClass(shape: string): readonly RiverCombo[] {
  if (shape.length === 4) return [parseRiverCombo(shape)];
  const match = CLASS_PATTERN.exec(shape);
  if (!match) {
    throw new Error(
      `Unsupported range token ${shape}; use an exact combo, pair, suited, offsuit, or unsuffixed class`,
    );
  }
  const [high, low] = orderedRanks(match[1] as RiverRank, match[2] as RiverRank);
  const suitedness = match[3] as "s" | "o" | undefined;
  if (high === low && suitedness) throw new Error(`Pair token ${shape} cannot use ${suitedness}`);

  const combos: RiverCombo[] = [];
  for (let left = 0; left < RIVER_SUITS.length; left += 1) {
    for (let right = 0; right < RIVER_SUITS.length; right += 1) {
      if (high === low && right <= left) continue;
      if (high !== low && suitedness === "s" && left !== right) continue;
      if (high !== low && suitedness === "o" && left === right) continue;
      combos.push(canonicalRiverCombo([
        `${high}${RIVER_SUITS[left]}` as RiverCard,
        `${low}${RIVER_SUITS[right]}` as RiverCard,
      ]));
    }
  }
  return combos;
}

/**
 * Expand deliberately small poker range syntax into the exact combinations used by the
 * solver. Board-blocked combinations are reported and removed before game construction.
 */
export function parseConfigurableRiverRange(
  input: string,
  board: readonly RiverCard[],
): ParsedConfigurableRiverRange {
  const tokens = input.split(/[\s,]+/).filter(Boolean);
  if (tokens.length === 0) throw new Error("River range text is empty");
  const boardCards = new Set(board);
  const seen = new Set<string>();
  const entries: ConfigurableRiverRangeEntry[] = [];
  let blockedComboCount = 0;

  for (const token of tokens) {
    const { shape, weight } = splitWeightedToken(token);
    for (const cards of expandClass(shape)) {
      const key = riverComboKey(cards);
      if (seen.has(key)) throw new Error(`Range tokens overlap on exact combo ${key}`);
      seen.add(key);
      if (cards.some(card => boardCards.has(card))) {
        blockedComboCount += 1;
        continue;
      }
      entries.push({ cards, weight });
    }
  }

  if (entries.length === 0) throw new Error("River range has no combinations after board blockers");
  entries.sort((left, right) => riverComboKey(left.cards).localeCompare(riverComboKey(right.cards)));
  return { entries, tokens, blockedComboCount };
}
