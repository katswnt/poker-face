// Library-notation helpers for solver drills: cards, review keys, and a replay of a node's
// action path (history text, per-street contributions, action labels). Pure and browser-safe.
import type { CardObj } from "@/lib/poker/types";
import { parseActionToken } from "@/lib/solver/bridge/library/query";
import type { BridgeLibraryNode } from "@/lib/solver/bridge/library/model";
import { fmtChipsBb as bb } from "../format";

const SUIT: Record<string, string> = { c: "♣", d: "♦", h: "♥", s: "♠" };
const CARD = /^[2-9TJQKA][cdhs]$/;

export const isCardToken = (token: string): boolean => CARD.test(token);

/** Library card ("Th") → the app's card object ({ rank: "10", suit: "♥" }). */
export function libraryCard(card: string): CardObj {
  if (!CARD.test(card)) throw new Error(`Not a card: ${card}`);
  return { rank: card[0] === "T" ? "10" : card[0], suit: SUIT[card[1]] };
}

/** "AsQs" → two card objects. */
export const comboCards = (combo: string): CardObj[] => [libraryCard(combo.slice(0, 2)), libraryCard(combo.slice(2, 4))];

export const cardText = (card: string): string => { const c = libraryCard(card); return c.rank + c.suit; };

export { fmtChipsBb as bb, fmtSignedChipsBb as signedBb } from "../format";

// ---------------------------------------------------------------------------------------------
// Review keys: `spotId|path|combo`. The path uses the library's space-separated tokens.

export interface SolverKey { readonly spotId: string; readonly path: string; readonly combo: string; }

export const solverKey = (k: SolverKey): string => `${k.spotId}|${k.path}|${k.combo}`;

export function parseSolverKey(key: string): SolverKey | null {
  const parts = key.split("|");
  if (parts.length !== 3 || !/^[a-z0-9][a-z0-9-]*$/.test(parts[0]) || !/^[2-9TJQKA][cdhs][2-9TJQKA][cdhs]$/.test(parts[2])) return null;
  return { spotId: parts[0], path: parts[1], combo: parts[2] };
}

/** Street and board implied by a path from the flop root. */
export function streetOfPath(flop: readonly string[], path: string): { street: "flop" | "turn" | "river"; board: string[] } {
  const cards = (path === "" ? [] : path.split(" ")).filter(isCardToken);
  const street = cards.length === 0 ? "flop" : cards.length === 1 ? "turn" : "river";
  return { street, board: [...flop, ...cards] };
}

// ---------------------------------------------------------------------------------------------
// Path replay

export interface Replay {
  /** One line per street reached, e.g. "Flop K♠ 7♥ 2♦: BB checks, BTN bets 3.63 bb, BB calls". */
  readonly history: readonly string[];
  /** Chips each player has put in on the current street. */
  readonly street: readonly [number, number];
  /** Chips each player had committed when the current street started. */
  readonly streetBase: number;
  /** Total committed since the flop (must equal node.committed). */
  readonly committed: readonly [number, number];
  readonly toAct: 0 | 1;
}

const STREET_NAMES = ["Flop", "Turn", "River"] as const;

/** Replays a library path. Player 0 (out of position) acts first on every street. */
export function replayPath(flop: readonly string[], path: string, names: readonly [string, string]): Replay {
  const tokens = path === "" ? [] : path.split(" ");
  const history: string[] = [];
  let line: string[] = [];
  let header = `${STREET_NAMES[0]} ${flop.map(cardText).join(" ")}`;
  let base = 0, street: [number, number] = [0, 0], toAct: 0 | 1 = 0, streetIndex = 0;
  const flush = () => history.push(line.length ? `${header}: ${line.join(", ")}` : header);
  for (const token of tokens) {
    if (isCardToken(token)) {
      flush();
      if (street[0] !== street[1]) throw new Error(`Path ${path}: a card is dealt before the bets are equal`);
      base += street[0]; street = [0, 0]; toAct = 0; streetIndex += 1; line = [];
      header = `${STREET_NAMES[Math.min(streetIndex, 2)]} ${cardText(token)}`;
      continue;
    }
    const action = parseActionToken(token);
    const who = names[toAct];
    if (action.kind === "check") line.push(`${who} checks`);
    else if (action.kind === "fold") line.push(`${who} folds`);
    else if (action.kind === "call") { street[toAct] = street[1 - toAct]; line.push(`${who} calls`); }
    else {
      street[toAct] = action.to!;
      line.push(action.kind === "bet" ? `${who} bets ${bb(action.to!)} bb` : `${who} raises to ${bb(action.to!)} bb`);
    }
    toAct = (1 - toAct) as 0 | 1;
  }
  flush();
  return { history, street, streetBase: base, committed: [base + street[0], base + street[1]], toAct };
}

/** Replays the node's path and checks it against the node's saved contributions and actor. */
export function replayNode(flop: readonly string[], node: BridgeLibraryNode, names: readonly [string, string]): Replay {
  const replay = replayPath(flop, node.path, names);
  if (replay.committed[0] !== node.committed[0] || replay.committed[1] !== node.committed[1] || replay.toAct !== node.player) {
    throw new Error(`Path ${node.path} does not replay to the saved node`);
  }
  return replay;
}

export interface ActionInfo {
  readonly id: string;
  readonly label: string;
  /** Chips the action adds now (call amount, bet, or raise increment). */
  readonly adds: number;
  readonly allIn: boolean;
}

/** Labels with chip sizes for the actor's legal actions. */
export function describeActions(node: BridgeLibraryNode, replay: Replay, startingPot: number, effectiveStack: number): ActionInfo[] {
  const actor = node.player;
  const pot = startingPot + node.committed[0] + node.committed[1];
  const toCall = replay.street[1 - actor] - replay.street[actor];
  const stackLeft = effectiveStack - node.committed[actor];
  return node.actions.map(token => {
    const action = parseActionToken(token);
    if (action.kind === "check") return { id: token, label: "Check", adds: 0, allIn: false };
    if (action.kind === "fold") return { id: token, label: "Fold", adds: 0, allIn: false };
    if (action.kind === "call") {
      const adds = Math.min(toCall, stackLeft);
      return { id: token, label: adds === stackLeft ? `Call ${bb(adds)} bb (all-in)` : `Call ${bb(adds)} bb`, adds, allIn: adds === stackLeft };
    }
    const adds = action.to! - replay.street[actor];
    const allIn = adds >= stackLeft;
    if (action.kind === "bet") {
      const pct = Math.round((adds / pot) * 100);
      return { id: token, label: allIn ? `Bet ${bb(adds)} bb (all-in)` : `Bet ${bb(adds)} bb (${pct}% pot)`, adds, allIn };
    }
    return { id: token, label: allIn ? `Raise to ${bb(action.to!)} bb (all-in)` : `Raise to ${bb(action.to!)} bb`, adds, allIn };
  });
}
