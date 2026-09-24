import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { compileTurnV2 } from "../src/lib/solver/postflop/configurable-turn/game";
import { TURN_V2_CORPUS, TURN_V2_HELD_OUT } from "../src/lib/solver/postflop/configurable-turn/fixtures";
import { oracleTurnV2Utility, replayTurnV2Money } from "../src/lib/solver/postflop/configurable-turn/oracle";
import { createReadableTurnV2, type ReadableTurnV2State } from "../src/lib/solver/postflop/configurable-turn/readable";
import { turnV2InformationKey, type TurnV2Request } from "../src/lib/solver/postflop/configurable-turn/rules";
import { gradeVectorTurn } from "../src/lib/solver/postflop/vector/scorekeeper";
import { uniformStrategy } from "../src/lib/solver/toy/game";
import { deserializeBehavioralStrategy } from "../src/lib/solver/toy/artifact";
import { deriveTurnExplorer } from "../src/lib/solver/postflop/explorer/derive";
import { validateExplorerChunk } from "../src/lib/solver/postflop/explorer/load";
import { callPrice, conditionalStatus, CONDITIONAL_MIN_REACH, type ExplorerCatalog, type NodeView } from "../src/lib/solver/postflop/explorer/model";
import { handScore } from "../src/lib/poker/eval";
import { RIVER_DECK, riverCardObject, riverComboKey } from "../src/lib/solver/river/cards";

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= eps, `${a} != ${b}`);
const sum = (a: readonly number[]) => a.reduce((x, y) => x + y, 0);
const catalog = JSON.parse(readFileSync("src/lib/solver/postflop/explorer/artifacts/catalog.json", "utf8")) as ExplorerCatalog;

for (const scenario of catalog.scenarios) test(`saved explorer covers every legal public node and hand, with exact hashes and bounded chunks: ${scenario.id}`, () => {
  const game = compileTurnV2(scenario.request), artifact = JSON.parse(readFileSync(`src/lib/solver/postflop/configurable-turn/artifacts/${scenario.id}.json`, "utf8"));
  const policy = deserializeBehavioralStrategy(game.index, artifact.strategy);
  const generated = deriveTurnExplorer(game, policy, artifact.payloadHash), nodes: NodeView[] = [];
  let totalRaw = 0, totalGzip = 0;
  for (const chunk of generated) {
    const ref = scenario.chunks[chunk.card ?? "turn"], bytes = readFileSync(`public${ref.url}`);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), ref.sha256);
    assert.equal(bytes.length, ref.bytes);
    assert.ok(bytes.length <= (chunk.card ? 1024 ** 2 : 256 * 1024));
    const saved = validateExplorerChunk(JSON.parse(bytes.toString()), scenario, chunk.card);
    assert.deepEqual(saved, chunk); nodes.push(...saved.nodes); totalRaw += bytes.length; totalGzip += gzipSync(bytes).length;
  }
  assert.ok(totalRaw < 32 * 1024 ** 2 && totalGzip < 5 * 1024 ** 2);
  nodes.sort((a, b) => a.id - b.id); assert.equal(nodes.length, game.publicStates.length);
  let informationSets = 0;
  for (const node of nodes) {
    assert.deepEqual(node.state, game.publicStates[node.id]);
    const replay = replayTurnV2Money(scenario.request, node.state.histories, node.state.river);
    assert.deepEqual(replay.state, node.state);
    if (node.state.actor !== null && node.children.some(c => c.label === "call")) {
      const child = node.children.find(c => c.label === "call")!, after = replayTurnV2Money(scenario.request, nodes[child.node].state.histories, nodes[child.node].state.river);
      const price = callPrice(scenario.request, node.state);
      assert.equal(price.potAfterCall, 2 * (scenario.request.committedPerPlayer + after.state.carried));
      assert.equal(price.cost, replay.cash[node.state.actor] - after.cash[node.state.actor]);
      near(price.shareRequired!, price.cost / price.potAfterCall);
    }
    if (node.reach > CONDITIONAL_MIN_REACH && node.children.length) near(sum(node.children.map(c => c.probability!)), 1, 1e-12);
    if (node.mix) near(sum(node.mix), 1, 1e-12);
    informationSets += node.hands.length;
    for (const hand of node.hands) {
      const actor = node.state.actor!, own = game.ranges.players[actor].hands[hand.hand];
      assert.ok(!own.includes(node.state.river!));
      const saved = policy.get(turnV2InformationKey(game.request, node.state, actor, own))!;
      assert.deepEqual(hand.actions.map(a => a.frequency), saved.probabilities);
      if (!hand.opponent) { assert.ok(hand.reach <= CONDITIONAL_MIN_REACH); for (const a of hand.actions) assert.equal(a.ev, null); continue; }
      near(sum(hand.opponent), 1, 1e-12);
      hand.opponent.forEach((weight, i) => {
        const other = game.ranges.players[1 - actor].hands[i];
        if (own.some(c => other.includes(c)) || other.includes(node.state.river!)) assert.equal(weight, 0);
      });
      for (const a of hand.actions) {
        near(sum(a.outcomes!), 1, 1e-12); assert.ok(a.behindBest! >= 0);
        near(a.evFromNow!, a.ev! + scenario.request.committedPerPlayer + node.state.carried + node.state.streetPaid[actor]);
        if (a.action === "fold") near(a.evFromNow!, 0);
        if (a.responses.length) near(sum(a.responses.map(r => r.probability!)), 1, 1e-12);
        for (const r of a.responses) if (r.opponent) near(sum(r.opponent), 1, 1e-12);
      }
    }
  }
  assert.equal(informationSets, game.index.informationSets.length);
  const root = nodes[0], grade = gradeVectorTurn(game, policy);
  near(sum(root.hands.map(h => h.reach * sum(h.actions.map(a => a.frequency * a.ev!)))), grade.value[0]);
  // Every chance preview averages back to the value BEFORE revealing the card.
  for (const node of nodes.filter(n => n.state.phase === "river-card" && n.reach > 1e-8)) {
    const parent = nodes[node.parent!], childIndex = parent.children.findIndex(c => c.node === node.id);
    near(sum(node.children.map(c => (c.probability ?? 0) * (c.value0 ?? 0))), parent.children[childIndex].value0!);
  }
});

const tiny: TurnV2Request = { ...TURN_V2_HELD_OUT[0], stackBehind: [17, 11],
  streets: [{ openingTargets: [3, 5], raiseTargets: [8], raiseLimit: 1, includeAllIn: false },
    { openingTargets: [2], raiseTargets: [4], raiseLimit: 1, includeAllIn: false }] };

test("every weighted explanation matches repeated-state reach, slow money/showdown, forced continuation and Bayes response", () => {
  const game = compileTurnV2(tiny), readable = createReadableTurnV2(tiny), policy = new Map(uniformStrategy(game.index));
  let seed = 19243;
  for (const [key, row] of policy) {
    const weights = row.actions.map(() => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return 0.1 + seed / 2 ** 32; });
    policy.set(key, { actions: row.actions, probabilities: weights.map(w => w / sum(weights)) });
  }
  const facts = deriveTurnExplorer(game, policy, "test").flatMap(c => c.nodes);
  interface RecordNode { state: ReadableTurnV2State; reach: number; value: number[]; children: RecordNode[] }
  const byPublic = new Map<string, RecordNode[]>(), identity = (s: ReadableTurnV2State) => JSON.stringify([s.public.histories, s.public.river]);
  const settle = new Map<string, readonly number[]>();
  const visit = (state: ReadableTurnV2State, reach: number): RecordNode => {
    const node = readable.node(state), children: RecordNode[] = [], value = [0, 0, 0, 0, 0, 0];
    const row = { state, reach, value, children };
    if (state.hands) { const key = identity(state), list = byPublic.get(key) ?? []; list.push(row); byPublic.set(key, list); }
    if (node.kind === "terminal") {
      const key = JSON.stringify([state.hands, state.public.river, state.public.carried, state.public.folded]);
      if (!settle.has(key)) settle.set(key, oracleTurnV2Utility(tiny, state.public.histories, state.public.river, state.hands!));
      value[0] = settle.get(key)![0];
      value[state.public.folded === 0 ? 1 : state.public.folded === 1 ? 2 : value[0] > 0 ? 3 : value[0] === 0 ? 4 : 5] = 1;
    } else {
      const branches = node.kind === "chance" ? node.outcomes.map(r => ({ probability: r.probability, state: readable.nextChance(state, r.outcome) }))
        : node.actions.map((action, i) => ({ probability: policy.get(readable.informationSet(state, node.player))!.probabilities[i], state: readable.nextAction(state, action) }));
      for (const branch of branches) { const child = visit(branch.state, reach * branch.probability); children.push(child); child.value.forEach((v, i) => value[i] += branch.probability * v); }
    }
    return row;
  };
  visit(readable.initialState(), 1);
  let nonuniform = false, showdownDiffers = false;
  const shares = new Map<string, number>();
  for (const fact of facts) {
    const records = byPublic.get(JSON.stringify([fact.state.histories, fact.state.river])) ?? [];
    near(fact.reach, sum(records.map(r => r.reach)), 1e-12);
    for (const h of fact.hands) {
      const actor = fact.state.actor!, cards = game.ranges.players[actor].hands[h.hand];
      const selected = records.filter(r => riverComboKey(r.state.hands![actor]) === riverComboKey(cards));
      near(h.reach, sum(selected.map(r => r.reach)), 1e-12);
      if (!h.opponent) continue;
      let equity = 0;
      for (const r of selected) {
        const key = JSON.stringify([r.state.hands, fact.state.river]);
        if (!shares.has(key)) {
          const rivers = fact.state.river ? [fact.state.river] : RIVER_DECK.filter(c => !tiny.board.includes(c) && !r.state.hands!.some(hand => hand.includes(c)));
          const share = sum(rivers.map(card => {
            const board = [...tiny.board, card].map(riverCardObject);
            const a = handScore(r.state.hands![0].map(riverCardObject), board), b = handScore(r.state.hands![1].map(riverCardObject), board);
            return a === b ? 0.5 : a > b ? 1 : 0;
          })) / rivers.length;
          shares.set(key, share);
        }
        equity += r.reach / h.reach * (actor === 0 ? shares.get(key)! : 1 - shares.get(key)!);
      }
      near(h.checkdownShare!, equity, 1e-12);
      h.actions.forEach((action, i) => {
        const values = Array<number>(6).fill(0);
        for (const r of selected) r.children[i].value.forEach((v, k) => values[k] += r.reach / h.reach * v);
        near(action.ev!, values[0] * (actor === 0 ? 1 : -1));
        const expected = actor === 0 ? values.slice(1) : [values[2], values[1], values[5], values[4], values[3]];
        expected.forEach((v, k) => near(action.outcomes![k], v, 1e-12));
        const show = sum(expected.slice(2)); near(action.showdownShare ?? 0, show > 1e-12 ? (expected[2] + expected[3] / 2) / show : 0, 1e-12);
        if (action.showdownShare !== null && Math.abs(action.showdownShare - h.checkdownShare!) > 0.01) showdownDiffers = true;
        action.responses.forEach((response, j) => {
          const mass = game.ranges.players[1 - actor].hands.map(other => sum(selected.filter(r => riverComboKey(r.state.hands![1 - actor]) === riverComboKey(other)).map(r => {
            const after = r.children[i].state, key = readable.informationSet(after, (1 - actor) as 0 | 1);
            return r.reach / h.reach * policy.get(key)!.probabilities[j];
          })));
          near(response.probability!, sum(mass), 1e-12); mass.forEach((v, k) => near(response.opponent![k], v / sum(mass), 1e-12));
        });
      });
    }
    if (fact.mix && fact.hands.length > 1) fact.mix.forEach((v, i) => { if (Math.abs(v - sum(fact.hands.map(h => h.actions[i].frequency)) / fact.hands.length) > 0.01) nonuniform = true; });
  }
  assert.ok(nonuniform, "must catch equal-hand averaging"); assert.ok(showdownDiffers, "must distinguish checkdown and selected showdowns");
});

test("off-path and zero-frequency actions keep saved frequencies without inventing conditional values", () => {
  const game = compileTurnV2(tiny), policy = new Map(uniformStrategy(game.index));
  for (const [key, row] of policy) policy.set(key, { actions: row.actions, probabilities: row.actions.map((_, i) => Number(i === 0)) });
  const nodes = deriveTurnExplorer(game, policy, "test").flatMap(c => c.nodes), root = nodes.find(n => n.id === 0)!;
  assert.ok(root.hands.every(h => h.actions[1].frequency === 0 && h.actions[1].ev !== null));
  assert.ok(nodes.some(n => n.hands.some(h => h.reach === 0)));
  for (const node of nodes) for (const h of node.hands) if (h.reach === 0) {
    assert.equal(h.opponent, null); assert.equal(h.checkdownShare, null);
    for (const a of h.actions) { assert.equal(a.ev, null); assert.equal(a.outcomes, null); assert.equal(a.showdownShare, null); }
  }
  assert.ok(root.hands.some(h => h.actions.some(a => a.responses.some(r => r.probability === 0 && r.opponent === null))));
  assert.equal(conditionalStatus(0), "off"); assert.equal(conditionalStatus(1e-14), "tiny"); assert.equal(conditionalStatus(1e-8), "rare"); assert.equal(conditionalStatus(0.1), "reached");
});

test("derivation refuses the wide offline policy instead of silently pruning it", () => {
  const game = compileTurnV2(TURN_V2_CORPUS[0]);
  assert.throws(() => deriveTurnExplorer(game, uniformStrategy(game.index), "test"), /bounded/);
});

test("positive but numerically tiny reach withholds conditional values without calling it exact zero", () => {
  const game = compileTurnV2(tiny), policy = new Map(uniformStrategy(game.index));
  for (const info of game.index.informationSets.filter(info => info.key.endsWith("turn=start:river-actions=start"))) {
    policy.set(info.key, { actions: info.actions, probabilities: info.actions.map((_, i) => i === 0 ? 1 - 1e-14 : i === 1 ? 1e-14 : 0) });
  }
  const nodes = deriveTurnExplorer(game, policy, "test").flatMap(c => c.nodes);
  const tinyHands = nodes.flatMap(n => n.hands).filter(h => h.reach > 0 && h.reach <= CONDITIONAL_MIN_REACH);
  assert.ok(tinyHands.length > 0);
  for (const hand of tinyHands) { assert.equal(conditionalStatus(hand.reach), "tiny"); assert.equal(hand.opponent, null); assert.equal(hand.actions[0].ev, null); }
});
