import type { BehavioralStrategy } from "../../toy/game";
import type { TurnAction } from "../../turn/game";
import { TURN_CHANCE, TURN_TERMINAL } from "../compact-turn";
import { encodeVectorPolicy, type VectorTurnGame } from "./game";
import { createVectorKernelScratch, naiveTerminalValues, vectorTerminalValues } from "./kernels";

/** Independent depth-first evaluation. No session, regrets, deltas or solver traversal. */
export function gradeVectorTurn(game: VectorTurnGame, policy: BehavioralStrategy<TurnAction>, kernel: "vector" | "naive" = "vector") {
  if (kernel !== "vector" && kernel !== "naive") throw new Error("Unknown grading kernel");
  const flat = encodeVectorPolicy(game, policy);
  let workingStorageBytes = flat.byteLength;
  const evaluate = (player: 0 | 1, response: boolean) => {
    const hero = game.ranges.players[player], other = game.ranges.players[1 - player];
    const h = hero.hands.length, k = other.hands.length;
    const rows = Array.from({ length: game.maximumDepth + 1 }, () => new Float64Array(h));
    const opponentRows = Array.from({ length: rows.length }, () => new Float64Array(k));
    opponentRows[0].set(other.weights);
    const scratch = createVectorKernelScratch(k), choices = new Map<string, TurnAction>();
    workingStorageBytes = Math.max(workingStorageBytes, flat.byteLength + [...rows, ...opponentRows,
      scratch.cardMass, scratch.cardCount, scratch.weights, scratch.included].reduce((sum, a) => sum + a.byteLength, 0));
    const walk = (node: number, depth: number): Float64Array => {
      const output = rows[depth], opponents = opponentRows[depth], river = game.nodeRivers[node];
      if (game.nodeKinds[node] === TURN_TERMINAL) {
        const sign = game.terminalFoldSign[node] * (player === 0 ? 1 : -1);
        if (kernel === "vector") vectorTerminalValues(game.ranges, player, river, opponents, game.terminalScale[node], sign, output, scratch);
        else naiveTerminalValues(game.ranges, player, river, opponents, game.terminalScale[node], sign, output);
        return output;
      }
      const chance = game.nodeKinds[node] === TURN_CHANCE;
      const heroActs = !chance && game.nodePlayers[node] === player;
      output.fill(heroActs && response ? -Infinity : 0);
      for (let a = 0; a < game.nodeEdgeCounts[node]; a++) {
        const child = game.edgeChildren[game.nodeEdgeStarts[node] + a];
        const weights = opponentRows[depth + 1];
        for (let j = 0; j < k; j++) {
          const valid = other.compatibleCounts[(game.nodeRivers[child] + 1) * k + j] > 0;
          const info = !chance && !heroActs ? game.lookup[1 - player][node * k + j] : -1;
          weights[j] = valid ? opponents[j] * (!chance && !heroActs ? info < 0 ? 0 : flat[game.actionStarts[info] + a] : 1) : 0;
        }
        const continuation = walk(child, depth + 1);
        for (let i = 0; i < h; i++) {
          if (hero.compatibleCounts[(river + 1) * h + i] === 0) { output[i] = 0; continue; }
          if (chance) output[i] += continuation[i] / 44;
          else if (!heroActs) output[i] += continuation[i];
          else {
            const info = game.lookup[player][node * h + i];
            if (response) {
              // Maximize after integrating hidden hands and future river outcomes.
              if (continuation[i] > output[i]) {
                output[i] = continuation[i]; choices.set(game.index.informationSets[info].key, game.actions[node][a]);
              }
            } else output[i] += flat[game.actionStarts[info] + a] * continuation[i];
          }
        }
      }
      return output;
    };
    const root = walk(0, 0);
    let value = 0;
    for (let i = 0; i < h; i++) value += hero.weights[i] * root[i] / game.rootNormalizer;
    if (!Number.isFinite(value)) throw new Error("Non-finite vector grade");
    return { value, choices };
  };
  const value = [evaluate(0, false).value, evaluate(1, false).value] as const;
  const bestResponses = [evaluate(0, true), evaluate(1, true)] as const;
  const tolerance = 1e-10 * Math.max(1, game.request.committedPerPlayer + Math.min(...game.request.stackBehind));
  if (Math.abs(value[0] + value[1]) > tolerance) throw new Error("Vector profile value is not zero-sum");
  const gains = bestResponses.map((result, p) => {
    const gain = result.value - value[p];
    if (!Number.isFinite(gain) || gain < -tolerance) throw new Error("Invalid vector best-response gain");
    return Math.max(0, gain);
  }) as [number, number];
  return { value, bestResponses, gains, nashGap: gains[0] + gains[1], exploitability: (gains[0] + gains[1]) / 2,
    equilibriumValueIntervalPlayer0: [-bestResponses[1].value, bestResponses[0].value] as const, workingStorageBytes };
}
