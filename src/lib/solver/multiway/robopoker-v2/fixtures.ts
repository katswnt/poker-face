import { compileRiverFixture, digest, sequentialWitness, type CompiledFixture, type CompiledNode } from "../robopoker/contract";
import { gradeMultiwayStrategy } from "../best-response";
import { type MultiwayExtensiveFormGame } from "../game";

export type Fixture = CompiledFixture & { profile?: number[][] };
const terminal = (value: number): CompiledNode => ({ kind: "terminal", player: -1, info: -1, children: [], utility: [value, -value / 2, -value / 2] });
const player = (owner: number, info: number, children: number[]): CompiledNode => ({ kind: "player", player: owner, info, children, utility: [] });
const definition = (owner: number, id: number, count = 2) => ({ key: `player-${owner}-info-${id}`, player: owner, actions: Array.from({ length: count }, (_, i) => `action-${i}`) });
function tiny(id: string, nodes: CompiledNode[], informationSets: CompiledFixture["informationSets"], deals: CompiledFixture["deals"] = [], profile?: number[][]): Fixture {
  return { version: 1, id, fixtureHash: digest({ nodes, informationSets, deals }), nodes, informationSets, deals, ...(profile ? { profile } : {}) };
}
export function fixtures(): Fixture[] {
  return [sequentialWitness().fixture, compileRiverFixture(),
    tiny("r0-v2-weighted-hidden-sequential", [
      { kind: "chance", player: -1, info: -1, utility: [], children: [1, 1, 1, 2] },
      player(0, 0, [3, 5]), player(0, 0, [4, 6]), terminal(4), terminal(4),
      player(0, 1, [7, 8]), player(0, 1, [9, 10]), terminal(-10), terminal(10), terminal(100), terminal(-20),
    ], [definition(0, 0), definition(0, 1)], [{ node: 1, tickets: 3, probability: 0.75 }, { node: 2, tickets: 1, probability: 0.25 }]),
    tiny("r0-v2-zero-opponent-reach", [
      player(1, 0, [1, 2]), terminal(2), player(0, 1, [3, 4]), terminal(-5),
      player(0, 2, [5, 6]), terminal(-10), terminal(10),
    ], [definition(1, 0), definition(0, 1), definition(0, 2)], [], [[1, 0], [0.5, 0.5], [0.5, 0.5]]),
    tiny("r0-v2-thirds-normalization", [player(0, 0, [1, 2, 3]), terminal(-10), terminal(1), terminal(10)], [definition(0, 0, 3)]),
  ];
}
export function gameFor(f: Fixture): MultiwayExtensiveFormGame<number, string, number> {
  return {
    id: f.id, playerCount: 3, initialState: () => 0,
    node(id) {
      const n = f.nodes[id];
      if (n.kind === "terminal") return { kind: "terminal", utility: n.utility };
      if (n.kind === "player") return { kind: "player", player: n.player, actions: f.informationSets[n.info].actions };
      return { kind: "chance", outcomes: f.deals.map(d => ({ outcome: d.node, probability: d.probability })) };
    },
    nextChance: (_, outcome) => outcome,
    nextAction: (id, action) => f.nodes[id].children[f.informationSets[f.nodes[id].info].actions.indexOf(action)],
    informationSet: id => f.informationSets[f.nodes[id].info].key,
  };
}
export function gradeTiny(f: Fixture, profile: readonly (readonly number[])[], exhaustive = false) {
  const strategy = new Map(f.informationSets.map((info, i) => [info.key, { actions: info.actions, probabilities: profile[i] }]));
  return gradeMultiwayStrategy(gameFor(f), strategy, undefined, exhaustive ? "exhaustive" : "information-set");
}
export function imperfectRecallFixture(): Fixture {
  // Later info is reached after both distinct earlier own actions.
  return tiny("r0-v2-imperfect-recall-refusal", [player(0, 0, [1, 2]), player(0, 1, [3, 4]), player(0, 1, [3, 4]), terminal(-1), terminal(1)], [definition(0, 0), definition(0, 1)]);
}
