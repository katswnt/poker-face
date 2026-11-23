import { createHash } from "node:crypto";
import { deserializeMultiwayStrategy, type SerializedMultiwayStrategy } from "../artifact";
import { gradeMultiwayStrategy } from "../best-response";
import { MULTIWAY_RIVER_V1_SCENARIO, multiwayRiverV1Game } from "../fixture";
import { buildMultiwayGameTreeIndex, uniformMultiwayStrategy, type MultiwayExtensiveFormGame } from "../game";

export interface CompiledNode {
  kind: "chance" | "player" | "terminal";
  player: number;
  info: number;
  children: number[];
  utility: number[];
}
export interface CompiledFixture {
  version: 1;
  id: string;
  fixtureHash: string;
  nodes: CompiledNode[];
  informationSets: { key: string; player: number; actions: string[] }[];
  deals: { node: number; tickets: number; probability: number }[];
}
export function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function compileRiverFixture(): CompiledFixture {
  const game = multiwayRiverV1Game;
  const index = buildMultiwayGameTreeIndex(game);
  const informationSets = index.informationSets.map(info => ({
    key: info.key, player: info.player, actions: [...info.actions],
  }));
  const ids = new Map(informationSets.map((info, i) => [info.key, i]));
  const nodes: CompiledNode[] = [];
  const deals: CompiledFixture["deals"] = [];
  const visit = (state: ReturnType<typeof game.initialState>): number => {
    const node = game.node(state);
    const id = nodes.length;
    const compiled: CompiledNode = { kind: node.kind, player: -1, info: -1, children: [], utility: [] };
    nodes.push(compiled);
    if (node.kind === "terminal") compiled.utility = [...node.utility];
    else if (node.kind === "player") {
      compiled.player = node.player;
      compiled.info = ids.get(game.informationSet(state, node.player))!;
      compiled.children = node.actions.map(action => visit(game.nextAction(state, action)));
    } else {
      for (const { outcome, probability } of node.outcomes) {
        const tickets = outcome.hands.reduce((product, hand, player) => {
          const entry = MULTIWAY_RIVER_V1_SCENARIO.ranges[player].find(entry =>
            entry.cards.every(card => hand.includes(card)));
          if (!entry) throw new Error("Unknown private hand");
          return product * entry.weight;
        }, 1);
        if (!Number.isSafeInteger(tickets) || tickets < 1) throw new Error("Non-integer chance tickets");
        const child = visit(game.nextChance(state, outcome));
        deals.push({ node: child, tickets, probability });
        compiled.children.push(...Array<number>(tickets).fill(child));
      }
    }
    return id;
  };
  visit(game.initialState());
  const total = deals.reduce((sum, deal) => sum + deal.tickets, 0);
  for (const deal of deals) if (deal.tickets / total !== deal.probability) throw new Error("Chance measure changed");
  return { version: 1, id: game.id, fixtureHash: digest(MULTIWAY_RIVER_V1_SCENARIO), nodes, informationSets, deals };
}

export function verifyProfile(fixture: CompiledFixture, profile: readonly (readonly number[])[]) {
  if (profile.length !== fixture.informationSets.length) throw new Error("Wrong information-set count");
  const serialized: SerializedMultiwayStrategy = Object.fromEntries(fixture.informationSets.map((info, i) => {
    if (profile[i].length !== info.actions.length) throw new Error("Wrong action count");
    return [info.key, Object.fromEntries(info.actions.map((action, j) => [action, profile[i][j]]))];
  }));
  return gradeMultiwayStrategy(multiwayRiverV1Game, deserializeMultiwayStrategy(serialized));
}

export function sequentialWitness() {
  const game: MultiwayExtensiveFormGame<number, "take" | "continue" | "lose" | "win", never> = {
    id: "r0-sequential-response-witness-v1", playerCount: 3, initialState: () => 0,
    node(state) {
      if (state === 0) return { kind: "player", player: 0, actions: ["take", "continue"] };
      if (state === 1) return { kind: "player", player: 0, actions: ["lose", "win"] };
      const value = state === 2 ? 1 : state === 3 ? -10 : 10;
      return { kind: "terminal", utility: [value, -value / 2, -value / 2] };
    },
    nextAction: (_, action) => ({ take: 2, continue: 1, lose: 3, win: 4 })[action],
    nextChance: () => { throw new Error("No chance"); },
    informationSet: state => `player-0-decision-${state}`,
  };
  const index = buildMultiwayGameTreeIndex(game);
  const profile = uniformMultiwayStrategy(index);
  const nodes = [0, 1, 2, 3, 4].map(state => {
    const node = game.node(state);
    return {
      kind: node.kind, player: node.kind === "player" ? 0 : -1,
      info: node.kind === "player" ? state : -1,
      children: state === 0 ? [2, 1] : state === 1 ? [3, 4] : [],
      utility: node.kind === "terminal" ? [...node.utility] : [],
    };
  });
  const fixture: CompiledFixture = {
    version: 1, id: game.id, fixtureHash: digest(nodes), nodes,
    informationSets: index.informationSets.map(info => ({ key: info.key, player: 0, actions: [...info.actions] })), deals: [],
  };
  return {
    fixture, grade: gradeMultiwayStrategy(game, profile, index),
    exhaustive: gradeMultiwayStrategy(game, profile, index, "exhaustive"),
  };
}
