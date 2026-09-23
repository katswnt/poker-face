import { TURN_CHANCE, TURN_PLAYER, TURN_TERMINAL } from "../compact-turn";
import { validateCompactTurnOptions } from "../session";
import { decodeVectorPolicy, type VectorCoreGame } from "./core";
import { createVectorKernelScratch, naiveTerminalValues, vectorTerminalValues } from "./kernels";

export interface VectorTurnOptions {
  readonly iterations: number;
  readonly algorithm?: "vanilla" | "cfr-plus";
  readonly averagingDelay?: number;
  /** Naive is an explicit-pair oracle/benchmark, not the published fast backend. */
  readonly kernel?: "vector" | "naive";
}
export function validateVectorOptions(input: VectorTurnOptions) {
  const checked = validateCompactTurnOptions(input);
  if (checked.checkpointIterations.length) throw new Error("Vector sessions use full restart checkpoints, not retained policy checkpoints");
  const kernel = input.kernel ?? "vector";
  if (kernel !== "vector" && kernel !== "naive") throw new Error("Unknown vector terminal kernel");
  return Object.freeze({ iterations: checked.iterations, algorithm: checked.algorithm, averagingDelay: checked.averagingDelay, kernel });
}
export interface VectorCheckpoint {
  readonly schemaVersion: 1;
  readonly backend: "vector-turn";
  readonly backendVersion: 1;
  readonly gameIdentity: string;
  readonly options: ReturnType<typeof validateVectorOptions>;
  readonly iterations: number;
  readonly regrets: readonly number[];
  readonly strategySums: readonly number[];
}

function validateCheckpoint<Action extends string>(game: VectorCoreGame<Action>, checkpoint: VectorCheckpoint) {
  if (!checkpoint || checkpoint.schemaVersion !== 1 || checkpoint.backend !== "vector-turn" || checkpoint.backendVersion !== 1
    || checkpoint.gameIdentity !== game.gameIdentity) throw new Error("Checkpoint version or game identity mismatch");
  const options = validateVectorOptions(checkpoint.options), iterations = checkpoint.iterations;
  if (!Number.isSafeInteger(iterations) || iterations < 0 || iterations > options.iterations) throw new Error("Invalid checkpoint iteration");
  for (const values of [checkpoint.regrets, checkpoint.strategySums]) {
    if (!Array.isArray(values) || values.length !== game.actionSlotCount || values.some(v => !Number.isFinite(v))) throw new Error("Invalid checkpoint array");
  }
  const span = Math.max(0, iterations - options.averagingDelay);
  const maxAverage = options.algorithm === "vanilla" ? iterations : span * (span + 1) / 2;
  for (let i = 0; i < game.index.informationSets.length; i++) {
    let sum = 0;
    for (let a = 0; a < game.actionCounts[i]; a++) {
      const slot = game.actionStarts[i] + a, regret = checkpoint.regrets[slot], average = checkpoint.strategySums[slot];
      const maxRegret = 2 * iterations * (game.request.committedPerPlayer + Math.min(...game.request.stackBehind));
      if ((options.algorithm === "cfr-plus" && regret < 0) || Math.abs(regret) > maxRegret * (1 + 1e-12)
        || average < 0 || (iterations === 0 && regret !== 0)) throw new Error("Checkpoint regret or average outside bounds");
      sum += average;
    }
    if (sum > maxAverage * (1 + 1e-12)) throw new Error("Checkpoint average exceeds iteration weight");
  }
  return options;
}

/** Public-node × own-hand work, never public-node × compatible-deal work. */
export function createVectorTurnSession<Action extends string>(game: VectorCoreGame<Action>, input: VectorTurnOptions, saved?: VectorCheckpoint) {
  const options = validateVectorOptions(input);
  if (saved && JSON.stringify(validateCheckpoint(game, saved)) !== JSON.stringify(options)) throw new Error("Checkpoint options mismatch");
  const regrets = saved ? Float64Array.from(saved.regrets) : new Float64Array(game.actionSlotCount);
  const sums = saved ? Float64Array.from(saved.strategySums) : new Float64Array(game.actionSlotCount);
  const strategy = new Float64Array(game.actionSlotCount), deltas = new Float64Array(game.actionSlotCount);
  const reach = game.ranges.players.map(range => new Float64Array(game.nodeKinds.length * range.hands.length));
  const values = reach.map(array => new Float64Array(array.length));
  const weighted = game.ranges.players.map(range => new Float64Array(range.hands.length));
  const terminal = game.ranges.players.map(range => new Float64Array(range.hands.length));
  const scratch = ([0, 1] as const).map(p => createVectorKernelScratch(game.ranges.players[1 - p].hands.length));
  const workingStorageBytes = [regrets, sums, strategy, deltas, ...reach, ...values, ...weighted, ...terminal,
    ...scratch.flatMap(s => [s.cardMass, s.cardCount, s.weights, s.included])].reduce((total, array) => total + array.byteLength, 0);
  let completed = saved?.iterations ?? 0, failed = false;
  const healthy = () => { if (failed) throw new Error("Vector session failed; discard this workspace"); };
  const rebuild = () => {
    for (let i = 0; i < game.index.informationSets.length; i++) {
      const start = game.actionStarts[i], count = game.actionCounts[i];
      let total = 0;
      for (let a = 0; a < count; a++) total += Math.max(0, regrets[start + a]);
      if (!Number.isFinite(total)) throw new Error("Non-finite vector regret sum");
      for (let a = 0; a < count; a++) strategy[start + a] = total > 0 ? Math.max(0, regrets[start + a]) / total : 1 / count;
    }
  };
  const forward = () => {
    for (const p of [0, 1] as const) {
      const own = game.ranges.players[p], width = own.hands.length, array = reach[p];
      for (let h = 0; h < width; h++) array[h] = own.compatibleCounts[h] > 0 ? 1 : 0;
      for (let n = 0; n < game.nodeKinds.length; n++) {
        const acting = game.nodeKinds[n] === TURN_PLAYER && game.nodePlayers[n] === p;
        for (let a = 0; a < game.nodeEdgeCounts[n]; a++) {
          const child = game.edgeChildren[game.nodeEdgeStarts[n] + a], row = (game.nodeRivers[child] + 1) * width;
          for (let h = 0; h < width; h++) {
            if (own.compatibleCounts[row + h] === 0) { array[child * width + h] = 0; continue; }
            const info = acting ? game.lookup[p][n * width + h] : -1;
            array[child * width + h] = array[n * width + h] * (acting
              ? info < 0 ? 0 : strategy[game.actionStarts[info] + a] : 1);
          }
        }
      }
    }
  };
  const backward = (target: 0 | 1 | null) => {
    deltas.fill(0);
    for (const p of [0, 1] as const) {
      if (target !== null && target !== p) continue;
      const own = game.ranges.players[p], opponent = game.ranges.players[1 - p];
      const width = own.hands.length, otherWidth = opponent.hands.length, value = values[p];
      for (const n of game.postorder) {
        const offset = n * width, river = game.nodeRivers[n];
        if (game.nodeKinds[n] === TURN_TERMINAL) {
          for (let h = 0; h < otherWidth; h++) weighted[1 - p][h] = opponent.weights[h] * reach[1 - p][n * otherWidth + h];
          const fold = game.terminalFoldSign[n] * (p === 0 ? 1 : -1);
          if (options.kernel === "vector") vectorTerminalValues(game.ranges, p, river, weighted[1 - p], game.terminalScale[n], fold, terminal[p], scratch[p]);
          else naiveTerminalValues(game.ranges, p, river, weighted[1 - p], game.terminalScale[n], fold, terminal[p]);
          value.set(terminal[p], offset); continue;
        }
        const acting = game.nodeKinds[n] === TURN_PLAYER && game.nodePlayers[n] === p;
        for (let h = 0; h < width; h++) {
          const info = acting ? game.lookup[p][offset + h] : -1;
          let mixed = 0;
          for (let a = 0; a < game.nodeEdgeCounts[n]; a++) {
            const child = game.edgeChildren[game.nodeEdgeStarts[n] + a];
            // Opponent strategy is already in the child's weighted reach: sum it
            // once, rather than multiplying that action probability a second time.
            const probability = game.nodeKinds[n] === TURN_CHANCE ? 1 / 44
              : acting ? info < 0 ? 0 : strategy[game.actionStarts[info] + a] : 1;
            mixed += probability * value[child * width + h];
          }
          value[offset + h] = mixed;
          if (info < 0) continue;
          const counterfactualScale = own.weights[h] / game.rootNormalizer * (river < 0 ? 1 : 1 / 44);
          for (let a = 0; a < game.nodeEdgeCounts[n]; a++) {
            const child = game.edgeChildren[game.nodeEdgeStarts[n] + a];
            deltas[game.actionStarts[info] + a] = counterfactualScale * (value[child * width + h] - mixed);
          }
        }
      }
    }
  };
  const apply = (target: 0 | 1 | null) => {
    for (let i = 0; i < game.index.informationSets.length; i++) {
      if (target !== null && game.infoPlayers[i] !== target) continue;
      for (let a = 0; a < game.actionCounts[i]; a++) {
        const slot = game.actionStarts[i] + a, updated = regrets[slot] + deltas[slot];
        if (!Number.isFinite(updated)) throw new Error("Non-finite vector regret");
        regrets[slot] = options.algorithm === "cfr-plus" ? Math.max(0, updated) : updated;
      }
    }
  };
  const average = (weight: number) => {
    if (weight <= 0) return;
    for (let i = 0; i < game.index.informationSets.length; i++) {
      const p = game.infoPlayers[i], ownReach = reach[p][game.infoNodes[i] * game.ranges.players[p].hands.length + game.infoHands[i]];
      for (let a = 0; a < game.actionCounts[i]; a++) {
        const slot = game.actionStarts[i] + a;
        sums[slot] += weight * ownReach * strategy[slot];
        if (!Number.isFinite(sums[slot])) throw new Error("Non-finite vector average");
      }
    }
  };
  const maps = (array: Float64Array) => new Map(game.index.informationSets.map((info, i) => [info.key,
    Array.from(array.subarray(game.actionStarts[i], game.actionStarts[i] + game.actionCounts[i]))]));
  return Object.freeze({
    get iterations() { return completed; }, get done() { return !failed && completed === options.iterations; },
    advance(count: number) {
      healthy();
      if (!Number.isSafeInteger(count) || count < 1) throw new Error("Advance requires a positive safe integer");
      const end = completed + Math.min(count, options.iterations - completed);
      try {
        while (completed < end) {
          if (options.algorithm === "vanilla") { rebuild(); forward(); backward(null); average(1); apply(null); }
          else {
            for (const p of [0, 1] as const) { rebuild(); forward(); backward(p); apply(p); }
            rebuild(); forward(); average(Math.max(0, completed + 1 - options.averagingDelay));
          }
          completed++;
        }
      } catch (error) { failed = true; throw error; }
      return completed;
    },
    checkpoint(): VectorCheckpoint {
      healthy();
      return { schemaVersion: 1, backend: "vector-turn", backendVersion: 1, gameIdentity: game.gameIdentity,
        options: { ...options }, iterations: completed, regrets: Array.from(regrets), strategySums: Array.from(sums) };
    },
    snapshot() {
      healthy(); rebuild();
      const probabilities = new Float64Array(strategy);
      for (let i = 0; i < game.index.informationSets.length; i++) {
        const start = game.actionStarts[i], count = game.actionCounts[i];
        let total = 0;
        for (let a = 0; a < count; a++) total += sums[start + a];
        if (total > 0) for (let a = 0; a < count; a++) probabilities[start + a] = sums[start + a] / total;
      }
      return { backend: "vector-turn" as const, backendVersion: 1 as const, options: { ...options }, iterations: completed,
        done: completed === options.iterations, workingStorageBytes, regretPasses: completed * (options.algorithm === "vanilla" ? 1 : 2),
        currentStrategy: decodeVectorPolicy(game, strategy), averageStrategy: decodeVectorPolicy(game, probabilities),
        cumulativeRegrets: maps(regrets), strategySums: maps(sums),
        kernelObservationsSinceStart: { calls: scratch[0].calls + scratch[1].calls,
          queries: scratch[0].queries + scratch[1].queries, fallbackQueries: scratch[0].fallbackQueries + scratch[1].fallbackQueries } };
    },
  });
}
export function restoreVectorTurnSession<Action extends string>(game: VectorCoreGame<Action>, checkpoint: VectorCheckpoint) {
  return createVectorTurnSession(game, validateCheckpoint(game, checkpoint), checkpoint);
}
