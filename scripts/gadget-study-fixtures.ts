/** Offline, frozen expanded-game comparators. Not a production action translator. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { deserializeBehavioralStrategy } from "../src/lib/solver/toy/artifact";
import { buildGameTreeIndex, uniformStrategy, type BehavioralStrategy, type ExtensiveFormGame } from "../src/lib/solver/toy/game";
import { prepareSubgame } from "../src/lib/solver/river/resolving";
import { configurableRiverV3DemoGame, CONFIGURABLE_RIVER_V3_DEMO_SCENARIO } from "../src/lib/solver/river/configurable-v3/fixture";
import { createConfigurableRiverV3Game, type ConfigurableRiverV3State } from "../src/lib/solver/river/configurable-v3/game";
import type { ConfigurableRiverAction as Action } from "../src/lib/solver/river/configurable/game";
import { createReadableTurnV2, type ReadableTurnV2State } from "../src/lib/solver/postflop/configurable-turn/readable";
import { TURN_V2_CORPUS } from "../src/lib/solver/postflop/configurable-turn/fixtures";
import { pseudoHarmonicProbabilityChips } from "../src/lib/hu-play/translation";

function readBlueprint<S, C>(path: string, game: ExtensiveFormGame<S, Action, C>) {
  const bytes = readFileSync(path), artifact = JSON.parse(bytes.toString("utf8"));
  return { saved: deserializeBehavioralStrategy(buildGameTreeIndex(game), artifact.strategy),
    inputFiles: [{ path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }] };
}
/** Expose the extra action at exactly one public node, not everywhere the engine menu offers it. */
function expandAt<S, C>(base: ExtensiveFormGame<S, Action, C>, parent: (s: S) => boolean, added: Action) {
  const game: ExtensiveFormGame<S, Action, C> = { ...base, id: `${base.id}:p4-expanded`,
    node(s) { const n = base.node(s); return n.kind === "player" && !parent(s)
      ? { ...n, actions: n.actions.filter(a => a !== added) } : n; },
    nextAction(s, a) {
      const n = game.node(s); assert.ok(n.kind === "player" && n.actions.includes(a));
      return base.nextAction(s, a);
    } };
  return game;
}

function fixture<S, C>(args: {
  name: string; game: ExtensiveFormGame<S, Action, C>; saved: BehavioralStrategy<Action>;
  inputFiles: { path: string; bytes: number; sha256: string }[];
  parent(s: S): boolean; cut(s: S): boolean; opponentKey(s: S): string; dealKey(s: S): string;
  neighbor(s: S, bet: number): S; parentOf(s: S): S;
  sizes: { lower: number; upper: number; actual: number; pot: number };
}) {
  const { game, saved, sizes } = args, newAction = `bet-to-${sizes.actual}` as Action;
  const lowerWeight = pseudoHarmonicProbabilityChips(sizes.pot, sizes.lower, sizes.upper, sizes.actual);
  const index = buildGameTreeIndex(game), blueprint = new Map(uniformStrategy(index));
  for (const i of index.informationSets) {
    const old = saved.get(i.key);
    if (old) {
      assert.ok(old.actions.every(a => i.actions.includes(a)), "Expansion cannot remove any saved action");
      blueprint.set(i.key, { actions: i.actions, probabilities: i.actions.map(a => {
        const k = old.actions.indexOf(a); return k < 0 ? 0 : old.probabilities[k];
      }) });
    }
  }
  const neighborEntries = (s: S) => [sizes.lower, sizes.upper].map(bet => {
    const state = args.neighbor(s, bet), entry = saved.get(game.informationSet(state, 0));
    assert.ok(entry, "Neighboring saved response must exist"); return entry;
  });
  const seen = new Set<string>();
  const translate = (s: S, inBranch: boolean): void => {
    const n = game.node(s); inBranch ||= args.cut(s);
    if (n.kind === "terminal") return;
    if (n.kind === "chance") { for (const o of n.outcomes) translate(game.nextChance(s, o.outcome), inBranch); return; }
    const key = game.informationSet(s, n.player);
    if (inBranch && n.player === 0) {
      assert.ok(args.cut(s), "The frozen translation has only one AI decision; no unmodeled latent coin history");
      const neighbors = neighborEntries(s);
      assert.ok(neighbors.every(e => e.actions.every(a => n.actions.includes(a))), "No guessed projection of illegal raise sizes");
      const probabilities = n.actions.map(a => neighbors.reduce((sum, e, i) => {
        const ix = e.actions.indexOf(a); return sum + (ix < 0 ? 0 : e.probabilities[ix]) * (i === 0 ? lowerWeight : 1 - lowerWeight);
      }, 0));
      const entry = { actions: n.actions, probabilities };
      if (seen.has(key)) assert.deepEqual(blueprint.get(key), entry, "Translation may not depend on the opponent's private hand");
      blueprint.set(key, entry); seen.add(key);
    }
    for (const a of n.actions) translate(game.nextAction(s, a), inBranch);
  };
  translate(game.initialState(), false); assert.ok(seen.size > 0);
  const parent = prepareSubgame({ game, blueprint, ai: 0, cut: args.parent, opponentKey: args.opponentKey });
  const modeledParent = new Map(parent.roots.map(r => [args.dealKey(r.state), r.modeledWeight]));
  const problem = prepareSubgame({ game, blueprint, ai: 0, cut: args.cut, opponentKey: args.opponentKey,
    modeledWeight(s) {
      const prior = modeledParent.get(args.dealKey(s)); assert.notEqual(prior, undefined);
      const entry = saved.get(game.informationSet(args.parentOf(s), 1))!;
      const likelihood = [sizes.lower, sizes.upper].reduce((sum, bet, i) => {
        const a = entry.actions.indexOf(`bet-to-${bet}`); assert.ok(a >= 0);
        return sum + entry.probabilities[a] * (i === 0 ? lowerWeight : 1 - lowerWeight);
      }, 0);
      return prior! * likelihood;
    } });
  return { name: args.name, game, saved, inputFiles: args.inputFiles, problem, parent, newAction, lowerWeight, sizes, neighborEntries };
}
export type GadgetStudyFixture<S, C> = ReturnType<typeof fixture<S, C>>;

export function buildRiverStudyFixture() {
  const base = configurableRiverV3DemoGame;
  const saved = readBlueprint("src/lib/solver/river/configurable-v3/artifacts/configurable-river-v3.json", base);
  const parent = (s: ConfigurableRiverV3State) => !!s.hands && s.public.history.join("/") === "check";
  const cut = (s: ConfigurableRiverV3State) => !!s.hands && s.public.history.join("/") === "check/bet-to-150";
  const expanded = createConfigurableRiverV3Game({ ...CONFIGURABLE_RIVER_V3_DEMO_SCENARIO, openingBetSizes: [50, 100, 150, 200] });
  const game = expandAt(expanded, parent, "bet-to-150");
  const replay = (s: ConfigurableRiverV3State, bet?: number) => {
    let node = base.nextChance(base.initialState(), { hands: s.hands! });
    node = base.nextAction(node, "check");
    return bet === undefined ? node : base.nextAction(node, `bet-to-${bet}`);
  };
  return fixture({ ...saved, name: "river-v3-demo-plus-IP-150", game, parent, cut,
    opponentKey: s => s.hands![1].join(""), dealKey: s => JSON.stringify(s.hands),
    neighbor: replay, parentOf: s => replay(s), sizes: { lower: 100, upper: 200, actual: 150, pot: 100 } });
}

export function buildTurnStudyFixture() {
  const request = TURN_V2_CORPUS[1], base = createReadableTurnV2(request);
  const saved = readBlueprint("src/lib/solver/postflop/configurable-turn/artifacts/turn-v2-dry-value.json", base);
  const onRiver = (s: ReadableTurnV2State) => !!s.hands && s.public.street === 1 && s.public.river === "Ks"
    && s.public.histories[0].join("/") === "check/check";
  const parent = (s: ReadableTurnV2State) => onRiver(s) && s.public.histories[1].join("/") === "check";
  const cut = (s: ReadableTurnV2State) => onRiver(s) && s.public.histories[1].join("/") === "check/bet-to-20";
  const expanded = createReadableTurnV2({ ...request, streets: [request.streets[0], { ...request.streets[1], openingTargets: [10, 20, 25] }] });
  const game = expandAt(expanded, parent, "bet-to-20");
  const replay = (s: ReadableTurnV2State, bet?: number) => {
    let node = base.nextChance(base.initialState(), { kind: "deal", hands: s.hands! });
    node = base.nextAction(base.nextAction(node, "check"), "check");
    node = base.nextChance(node, { kind: "river", card: "Ks" });
    node = base.nextAction(node, "check");
    return bet === undefined ? node : base.nextAction(node, `bet-to-${bet}`);
  };
  return fixture({ ...saved, name: "turn-v2-dry-value-plus-IP-river-20", game, parent, cut,
    opponentKey: s => s.hands![1].join(""), dealKey: s => JSON.stringify(s.hands),
    neighbor: replay, parentOf: s => replay(s), sizes: { lower: 10, upper: 25, actual: 20, pot: 100 } });
}
