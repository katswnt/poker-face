import { createVectorKernelScratch } from "../vector/kernels";
import { FLOP_CHANCE, FLOP_PLAYER, FLOP_TERMINAL, type VectorFlop } from "./compiled";
import { flopTerminalValues } from "./ranges";
import { validateFlopPolicy } from "./policy";

/** Independent recursive profile/best-response evaluator. No solver buffers or updates. */
export function gradeVectorFlop(game: VectorFlop, policy: Float64Array, naive = false) {
  validateFlopPolicy(game, policy);
  let workingStorageBytes = 0;
  const evaluate = (player: 0 | 1, response: boolean) => {
    const hero = game.ranges.players[player], other = game.ranges.players[1 - player], h = hero.hands.length, k = other.hands.length;
    const values = Array.from({ length: game.maximumDepth + 1 }, () => new Float64Array(h));
    const reaches = values.map(() => new Float64Array(k)); reaches[0].set(other.weights);
    const scratch = createVectorKernelScratch(k), masked = new Float64Array(k);
    const choices = response ? new Int8Array(game.preflight.actionSlots / 2).fill(-1) : null;
    workingStorageBytes = Math.max(workingStorageBytes, [...values, ...reaches, masked, scratch.cardMass, scratch.cardCount, scratch.weights, scratch.included]
      .reduce((s, a) => s + a.byteLength, choices?.byteLength ?? 0));
    const walk = (node: number, depth: number): Float64Array => {
      const board = game.boards[node], context = game.ranges.boards[board], live = context.view.players[player].compatibleCounts;
      const output = values[depth], opponents = reaches[depth];
      if (game.kinds[node] === FLOP_TERMINAL) {
        flopTerminalValues(game.ranges, player, board, opponents, game.scales[node], game.folds[node] * (player === 0 ? 1 : -1), output, scratch, masked, naive);
        return output;
      }
      const chance = game.kinds[node] === FLOP_CHANCE, heroActs = game.kinds[node] === FLOP_PLAYER && game.players[node] === player;
      output.fill(heroActs && response ? -Infinity : 0);
      for (let a = 0; a < game.edgeCounts[node]; a++) {
        const child = game.edges[game.edgeStarts[node] + a], allowed = game.ranges.boards[game.boards[child]].view.players[1 - player].compatibleCounts;
        for (let j = 0; j < k; j++) reaches[depth + 1][j] = allowed[j]
          ? opponents[j] * (!chance && !heroActs ? policy[game.actionStarts[node] + 2 * j + a] : 1) : 0;
        const continuation = walk(child, depth + 1);
        for (let i = 0; i < h; i++) {
          if (!live[i]) { output[i] = 0; continue; }
          if (chance) output[i] += continuation[i] / (context.turn ? 44 : 45);
          else if (!heroActs) output[i] += continuation[i];
          else if (response) {
            if (continuation[i] > output[i]) { output[i] = continuation[i]; choices![game.actionStarts[node] / 2 + i] = a; }
          } else output[i] += policy[game.actionStarts[node] + 2 * i + a] * continuation[i];
        }
      }
      return output;
    };
    const root = walk(0, 0); let value = 0;
    for (let i = 0; i < h; i++) value += hero.weights[i] * root[i] / game.ranges.rootNormalizer;
    if (!Number.isFinite(value)) throw new Error("Non-finite flop grade");
    return { value, choices };
  };
  const value = [evaluate(0, false).value, evaluate(1, false).value] as const;
  const bestResponses = [evaluate(0, true), evaluate(1, true)] as const;
  const tolerance = 1e-10 * (game.request.committedPerPlayer + Math.min(...game.request.stackBehind));
  if (Math.abs(value[0] + value[1]) > tolerance) throw new Error("Flop grade is not zero-sum");
  const gains = bestResponses.map((r, p) => {
    const gain = r.value - value[p]; if (!Number.isFinite(gain) || gain < -tolerance) throw new Error("Flop best response lost value"); return Math.max(0, gain);
  });
  return { value, bestResponses, gains, exploitability: (gains[0] + gains[1]) / 2, nashGap: gains[0] + gains[1],
    equilibriumValueIntervalPlayer0: [-bestResponses[1].value, bestResponses[0].value], workingStorageBytes };
}
