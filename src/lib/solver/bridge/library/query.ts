/** Read helpers for drills over validated library chunks (browser-safe). */
import { EQUITY_SCALE, EV_SCALE, REACH_SCALE, STRATEGY_SCALE, type BridgeLibraryChunk, type BridgeLibraryNode, type BridgeLibraryRanges } from "./model";

export const pathKey = (tokens: readonly string[]) => tokens.join(" ");

export function findLibraryNode(chunk: BridgeLibraryChunk, tokens: readonly string[]): BridgeLibraryNode | null {
  const key = pathKey(tokens);
  return chunk.nodes.find(node => node.path === key) ?? null;
}

/** Pot in the middle, including any bet not yet called. */
export const potAt = (node: BridgeLibraryNode, startingPot: number) => startingPot + node.committed[0] + node.committed[1];
export const toCall = (node: BridgeLibraryNode) => Math.max(0, node.committed[1 - node.player] - node.committed[node.player]);

/** Price of a call: toCall / (pot after calling). 0 when not facing a bet. */
export function potOdds(node: BridgeLibraryNode, startingPot: number): number {
  const call = toCall(node);
  return call === 0 ? 0 : call / (potAt(node, startingPot) + call);
}

/** Minimum defence frequency against a bet of `bet` chips into `potBefore`: potBefore / (potBefore + bet). */
export const minimumDefenceFrequency = (potBefore: number, bet: number) => potBefore / (potBefore + bet);

/** Parse an action token: sized tokens carry the street total they bet or raise to. */
export function parseActionToken(token: string): { kind: "check" | "call" | "fold" | "bet" | "raise"; to: number | null } {
  if (token === "x") return { kind: "check", to: null };
  if (token === "c") return { kind: "call", to: null };
  if (token === "f") return { kind: "fold", to: null };
  const match = /^([br])([1-9][0-9]*)$/.exec(token);
  if (!match) throw new Error(`Not an action token: ${token}`);
  return { kind: match[1] === "b" ? "bet" : "raise", to: Number(match[2]) };
}

export interface LibraryHandRow {
  readonly combo: string;
  readonly reach: number;
  readonly ev: number | null;
  readonly equity: number | null;
  /** Actor only: probability and from-now EV of each action, in node action order. */
  readonly actions: readonly { readonly token: string; readonly probability: number; readonly ev: number | null }[] | null;
}

/** One hand's decoded row at a node, or null when its reach rounds to 0 (or it is blocked). */
export function libraryHandRow(node: BridgeLibraryNode, ranges: BridgeLibraryRanges, player: 0 | 1, combo: string): LibraryHandRow | null {
  const hand = ranges.hands[player].indexOf(combo);
  const i = hand < 0 ? -1 : node.live[player].indexOf(hand);
  if (i < 0) return null;
  const decode = (v: number | null, scale: number) => v === null ? null : v / scale;
  return {
    combo, reach: node.reach[player][i] / REACH_SCALE * node.reachMax[player], ev: decode(node.ev[player][i], EV_SCALE), equity: decode(node.equity[player][i], EQUITY_SCALE),
    actions: player === node.player
      ? node.actions.map((token, a) => ({ token, probability: node.strategy[a][i] / STRATEGY_SCALE, ev: decode(node.actionEv[a][i], EV_SCALE) }))
      : null,
  };
}

/**
 * Reach-weighted action frequencies of the acting player's whole range (combination counts
 * are not adjusted for the opponent's card removal).
 */
export function rangeActionFrequencies(node: BridgeLibraryNode): readonly { readonly token: string; readonly frequency: number }[] {
  const reach = node.reach[node.player];
  const total = reach.reduce((s, r) => s + r, 0);
  return node.actions.map((token, a) => ({
    token, frequency: total > 0 ? node.strategy[a].reduce((s, p, i) => s + p * reach[i], 0) / (total * STRATEGY_SCALE) : 0,
  }));
}

/**
 * Reach-weighted mean from-now EV of a player's range at the node (null rows skipped). An
 * approximation of the range's value: rows are not weighted by blocker-compatible opponent reach.
 */
export function rangeEv(node: BridgeLibraryNode, player: 0 | 1): number | null {
  let n = 0, d = 0;
  node.ev[player].forEach((ev, i) => { if (ev !== null) { n += ev * node.reach[player][i]; d += node.reach[player][i]; } });
  return d > 0 ? n / d / EV_SCALE : null;
}
