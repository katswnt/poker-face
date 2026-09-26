// Opponent range composition at a library node: the opponent's reach-weighted combos (hero's
// cards removed) grouped by made hand and big draws, using the repo's hand evaluator.
import { bestHand, checkStr } from "@/lib/poker/eval";
import { cv } from "@/lib/poker/cards";
import type { CardObj } from "@/lib/poker/types";
import type { BridgeLibraryNode, BridgeLibraryRanges } from "@/lib/solver/bridge/library/model";
import type { RangeGroup } from "../types";
import { comboCards, libraryCard } from "./tree";

export const RANGE_GROUP_LABELS = [
  "Straight or better",
  "Two pair, trips or a set",
  "One pair",
  "No pair + flush draw or 8-out straight draw",
  "No pair, no big draw",
] as const;

/** Flush draw: four of a suit including a hole card. 8-out straight draw: two or more ranks
 *  complete a straight (open-ended or double gutshot). Only meaningful before the river. */
export function hasBigDraw(hole: readonly CardObj[], board: readonly CardObj[]): boolean {
  const all = [...hole, ...board];
  for (const suit of new Set(hole.map(c => c.suit))) if (all.filter(c => c.suit === suit).length === 4) return true;
  const values = all.map(cv);
  let completing = 0;
  for (let r = 2; r <= 14; r += 1) if (!values.includes(r) && checkStr([...values, r])) completing += 1;
  return completing >= 2;
}

export function classifyHand(hole: readonly CardObj[], board: readonly CardObj[]): number {
  const rank = bestHand([...hole], [...board]).rank;
  if (rank >= 4) return 0;
  if (rank >= 2) return 1;
  if (rank === 1) return 2;
  return board.length < 5 && hasBigDraw(hole, board) ? 3 : 4;
}

/** Shares (0..1) of the opponent's reach at the node, by group, hero's cards removed. */
export function villainRange(node: BridgeLibraryNode, ranges: BridgeLibraryRanges, villain: 0 | 1, heroCombo: string): RangeGroup[] {
  const blocked = new Set([heroCombo.slice(0, 2), heroCombo.slice(2, 4)]);
  const board = node.board.map(libraryCard);
  const weight = new Array<number>(RANGE_GROUP_LABELS.length).fill(0);
  node.live[villain].forEach((hand, i) => {
    const combo = ranges.hands[villain][hand];
    if (blocked.has(combo.slice(0, 2)) || blocked.has(combo.slice(2, 4))) return;
    weight[classifyHand(comboCards(combo), board)] += node.reach[villain][i];
  });
  const total = weight.reduce((s, w) => s + w, 0);
  return RANGE_GROUP_LABELS
    .map((label, g) => ({ label, share: total > 0 ? weight[g] / total : 0 }))
    .filter((group, g) => !(g === 3 && board.length === 5) || group.share > 0);
}
