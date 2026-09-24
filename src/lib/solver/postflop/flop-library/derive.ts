import { FLOP_CHANCE, FLOP_PLAYER, FLOP_TERMINAL, type VectorFlop } from "../flop/compiled";
import { validateFlopPolicy } from "../flop/policy";
import { flopActions } from "../flop/rules";
import { FLOP_CONDITIONAL_MIN, type FlopHandFacts, type FlopViewNode, type PublicFlopFacts } from "./model";

/** Offline explanation oracle: stream one compatible private deal at a time.
 * Six columns are EV0, fold0, fold1, showdown win0, split, win1.
 * No CFR update, best response, sampling, or private-pair-by-node workspace. */
export function deriveFlopFront(game: VectorFlop, policy: Float64Array, onDeal?: (completedDeals: number) => void) {
  validateFlopPolicy(game, policy);
  const size = game.states.length, front = new Int32Array(size).fill(-1), frontNodes: number[] = [];
  game.states.forEach((s, n) => { if (s.street < 2) { front[n] = frontNodes.length; frontNodes.push(n); } });
  const parents = new Int32Array(size).fill(-1), capture = new Uint8Array(size);
  for (let n = 0; n < size; n++) for (let a = 0; a < game.edgeCounts[n]; a++) {
    const child = game.edges[game.edgeStarts[n] + a]; parents[child] = n;
    if (front[n] >= 0 && game.kinds[n] === FLOP_CHANCE) capture[child] = 1;
  }
  frontNodes.forEach(n => { capture[n] = 1; });
  const reaches = new Float64Array(size), valueMass = new Float64Array(size), supports = new Uint32Array(size);
  const width = Math.max(...game.ranges.players.map(p => p.hands.length)), slots = frontNodes.length * width;
  const handReach = new Float64Array(slots), handCheckdown = new Float64Array(slots), handSupport = new Uint32Array(slots);
  const actionMass = new Float64Array(slots * 12), summaries = Array.from({ length: game.maximumDepth + 1 }, () => new Float64Array(6));
  let deals = 0;
  for (const [h0, left] of game.ranges.players[0].hands.entries()) for (const [h1, right] of game.ranges.players[1].hands.entries()) {
    if (left.some(c => right.includes(c))) continue;
    deals++;
    const privateCards = new Set([...left, ...right]), hands = [h0, h1], allowed = new Uint8Array(game.ranges.boards.length);
    const signs = new Int8Array(allowed.length), checkdown = new Float64Array(allowed.length);
    for (const [b, board] of game.ranges.boards.entries()) {
      if ((board.turn && privateCards.has(board.turn)) || (board.river && privateCards.has(board.river))) continue;
      allowed[b] = 1;
      if (board.river) {
        signs[b] = Math.sign(board.view.players[0].ranks[h0] - board.view.players[1].ranks[h1]);
        const share = (signs[b] + 1) / 2;
        checkdown[b] = share;
        checkdown[0] += share / 1980;
        checkdown[game.ranges.byCards.get(`${board.turn}/-`)!] += share / 44;
      }
    }
    const walk = (node: number, depth: number, mass: number): Float64Array => {
      const value = summaries[depth]; value.fill(0);
      const board = game.boards[node], state = game.states[node], actor = state.actor;
      if (game.kinds[node] === FLOP_TERMINAL) {
        const sign = state.folded === null ? signs[board] : state.folded === 0 ? -1 : 1;
        value[0] = sign * game.scales[node]; value[state.folded === 0 ? 1 : state.folded === 1 ? 2 : sign > 0 ? 3 : sign === 0 ? 4 : 5] = 1;
      } else {
        const chance = game.kinds[node] === FLOP_CHANCE, slot = actor === null ? -1 : game.actionStarts[node] + 2 * hands[actor];
        for (let a = 0; a < game.edgeCounts[node]; a++) {
          const child = game.edges[game.edgeStarts[node] + a]; if (!allowed[game.boards[child]]) continue;
          const probability = chance ? 1 / (state.street === 0 ? 45 : 44) : policy[slot + a];
          // Zero-frequency actions still have a well-defined forced continuation.
          const continuation = walk(child, depth + 1, mass * probability);
          for (let k = 0; k < 6; k++) value[k] += probability * continuation[k];
          if (front[node] >= 0 && actor !== null) {
            const offset = (front[node] * width + hands[actor]) * 12 + a * 6;
            for (let k = 0; k < 6; k++) actionMass[offset + k] += mass * continuation[k];
          }
        }
      }
      if (capture[node]) { reaches[node] += mass; valueMass[node] += mass * value[0]; supports[node]++; }
      if (front[node] >= 0 && actor !== null) {
        const slot = front[node] * width + hands[actor];
        handReach[slot] += mass; handSupport[slot]++;
        handCheckdown[slot] += mass * (actor === 0 ? checkdown[board] : 1 - checkdown[board]);
      }
      return value;
    };
    walk(0, 0, game.ranges.players[0].weights[h0] * game.ranges.players[1].weights[h1] / game.ranges.rootNormalizer);
    onDeal?.(deals);
  }
  if (deals !== game.ranges.compatibleDeals || Math.abs(reaches[0] - 1) > 1e-12) throw new Error("Flop explanation root mass/count mismatch");
  const summary = (n: number): PublicFlopFacts => ({ reach: reaches[n], support: supports[n],
    value0: reaches[n] > FLOP_CONDITIONAL_MIN ? valueMass[n] / reaches[n] : null });
  const node = (n: number): FlopViewNode => {
    const state = game.states[n], f = front[n], hands: FlopHandFacts[] = [];
    if (f >= 0 && state.actor !== null) for (let h = 0; h < game.ranges.players[state.actor].hands.length; h++) {
      const slot = f * width + h, reach = handReach[slot]; if (!handSupport[slot]) continue;
      const known = reach > FLOP_CONDITIONAL_MIN;
      hands.push({ hand: h, reach, checkdownShare: known ? handCheckdown[slot] / reach : null,
        actions: [0, 1].map(a => {
          const offset = slot * 12 + a * 6, normalized = known ? Array.from(actionMass.subarray(offset, offset + 6), v => v / reach) : null;
          return { ev: normalized ? normalized[0] * (state.actor === 0 ? 1 : -1) : null,
            outcomes: normalized ? state.actor === 0 ? normalized.slice(1) : [normalized[2], normalized[1], normalized[5], normalized[4], normalized[3]] : null };
        }) });
    }
    const actions = flopActions(state);
    return { id: n, parent: parents[n] < 0 ? null : parents[n], state,
      edges: Array.from(game.edges.subarray(game.edgeStarts[n], game.edgeStarts[n] + game.edgeCounts[n]), (child, a) => ({ node: child,
        label: state.phase === "card" ? (state.street === 0 ? game.states[child].turn! : game.states[child].river!) : actions[a],
        preview: state.phase === "card" && f >= 0 ? summary(child) : null })),
      policy: game.kinds[n] === FLOP_PLAYER ? game.ranges.players[state.actor!].hands.map((_, h) => Array.from(policy.subarray(game.actionStarts[n] + 2 * h, game.actionStarts[n] + 2 * h + 2))) : null,
      summary: f >= 0 ? summary(n) : null, hands };
  };
  // One deal's allowed-card mask, outcome signs and check-down shares are live at
  // a time. Include them; this still excludes JS objects and GC-delayed reclamation.
  const perDealBytes = game.ranges.boards.length * (Uint8Array.BYTES_PER_ELEMENT + Int8Array.BYTES_PER_ELEMENT + Float64Array.BYTES_PER_ELEMENT);
  const workingBytes = perDealBytes + [front, parents, capture, reaches, valueMass, supports, handReach, handCheckdown, handSupport, actionMass, ...summaries].reduce((s, a) => s + a.byteLength, 0);
  return { node, rootValue0: valueMass[0], workingBytes, frontNodes: frontNodes.length, deals };
}
