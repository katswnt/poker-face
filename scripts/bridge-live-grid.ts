import { canonicalBridgeCombo, compareBridgeCombos, validateBridgeSpot, type BridgeSpotV1 } from "../src/lib/solver/bridge/contract";
import { parseLiveSpot, LIVE_LIMITS } from "../src/lib/solver/bridge/live/admission";
import { RIVER_DECK } from "../src/lib/solver/river/cards";

/** The original W2 sizing inputs, shared by the Node and browser measurement scripts. */
export function buildLiveSizingGrid(maxIterations = 10): BridgeSpotV1[] {
  if (!Number.isSafeInteger(maxIterations) || maxIterations < 1 || maxIterations > LIVE_LIMITS.maxIterations) {
    throw new Error("Invalid measurement iteration limit.");
  }
  const grid: BridgeSpotV1[] = [];
  for (const street of ["river", "turn"] as const) for (const width of [4, 16, 64])
    for (const scope of ["full", "first-street"] as const) for (const wide of [false, true]) {
    const board = { flop: ["Kd", "8c", "4h"] as const, turn: "2s", river: street === "river" ? "9d" : null };
    const used = new Set([...board.flop, board.turn, board.river]);
    const deck = RIVER_DECK.filter(c => !used.has(c));
    const combos = deck.flatMap((a, i) => deck.slice(i + 1).map(b => canonicalBridgeCombo(a, b))).sort(compareBridgeCombos);
    const range = Array.from({ length: width }, (_, i) => ({ combo: combos[Math.floor(i * combos.length / width)], weight: 1 }));
    const options = { bet: wide ? [{ kind: "pot", pct: 25 }, { kind: "pot", pct: 100 }] : [{ kind: "pot", pct: 50 }],
      raise: wide ? [{ kind: "prevBet", multiple: 2 }] : [] };
    const menu = { oop: options, ip: options };
    const s = validateBridgeSpot({ format: "poker-face-bridge-spot", version: 1, id: `w2-${street}-${width}-${scope}-${wide ? "wide" : "small"}`,
      board, ranges: [{ source: "W2 synthetic measurement grid, not a poker range recommendation", combos: range },
        { source: "W2 synthetic measurement grid, not a poker range recommendation", combos: range }], startingPot: 100, effectiveStack: wide ? 1000 : 100, rake: 0,
      tree: { mode: "menu", flop: null, turn: street === "turn" ? menu : null, river: menu, turnDonk: null, riverDonk: null,
        maxRaisesPerStreet: wide ? 1 : 0, addAllInThreshold: 0, forceAllInThreshold: 0, mergingThreshold: 0 },
      solve: { compression: "off", exportScope: scope, timeoutMs: 120000, maxIterations, memoryCapBytes: 256 * 1024 ** 2, targetExploitabilityPctPot: 1e-9 } });
    parseLiveSpot(JSON.stringify(s)); grid.push(s);
  }
  return grid;
}
