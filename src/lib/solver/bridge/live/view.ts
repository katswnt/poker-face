import type { BridgeResultV1, BridgeSpotV1 } from "../contract";
import { bridgeActionLabel } from "../referee";

export interface RootSummary {
  spotHash: string; spotId: string; engineCommit: string; iterations: number;
  exploitability: number; target: number; reached: boolean; exportedNodes: number;
  hands: string[]; actions: string[]; strategy: number[][]; ev: number[]; equity: number[];
}
/** Projection only: no solve, no per-action EVs, no weighting incompatible hands together. */
export function rootSummary(result: BridgeResultV1): RootSummary {
  const root = result.tree[0];
  if (root.kind !== "player" || root.player !== 0 || root.strategy.some(row => row.some(p => p === null))) {
    throw new Error("Expected an unblocked first-player root decision.");
  }
  return { spotHash: result.spotHash, spotId: result.spotId, engineCommit: result.engine.commit, iterations: result.iterations,
    exploitability: result.exploitability.chips, target: result.exploitability.target, reached: result.exploitability.reached,
    exportedNodes: result.counts.exportedNodes, hands: [...result.hands[0]], actions: root.actions.map(a => bridgeActionLabel(a.action)),
    strategy: root.strategy.map(row => row as number[]), ev: [...result.root.ev[0]], equity: [...result.root.equity[0]] };
}
export function actionText(label: string): string {
  if (label === "check") return "Check";
  if (label === "fold") return "Fold";
  if (label === "call") return "Call";
  if (/^(bet|raise)\d+$/.test(label)) return label.replace(/^(bet|raise)(\d+)$/, (_, kind, amount) => `${kind === "bet" ? "Bet to" : "Raise to"} ${amount} chips`);
  if (label === "x") return "Check";
  if (label === "f") return "Fold";
  if (label === "c") return "Call";
  if (/^[br]\d+$/.test(label)) return `${label[0] === "b" ? "Bet to" : "Raise to"} ${label.slice(1)} chips`;
  // WASM previews use engine labels, not exchange labels.
  if (/^(Bet|Raise|AllIn)\(\d+\)$/.test(label)) return label.replace(/^(Bet|Raise|AllIn)\((\d+)\)$/, (_, kind, amount) =>
    `${kind === "AllIn" ? "All-in to" : `${kind} to`} ${amount} chips`);
  return label;
}
export function hasCompatibleOpponent(spot: BridgeSpotV1, hand: string): boolean {
  return spot.ranges[1].combos.some(other => new Set([hand.slice(0, 2), hand.slice(2), other.combo.slice(0, 2), other.combo.slice(2)]).size === 4);
}
export interface SavedLiveExample {
  format: "poker-face-live-example"; version: 1; spot: BridgeSpotV1; summary: RootSummary;
  independent: { exploitability: number; value0: number; toleranceChips: number; source: string };
  payloadHash: string;
}
