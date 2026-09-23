import { validateStrategy, type BehavioralStrategy } from "../toy/game";
import type { TurnAction } from "../turn/game";
import { compactTurnInformationSet, compactTurnNodeIsLive, compactTurnUtility0,
  TURN_CHANCE, TURN_PLAYER, TURN_TERMINAL, type CompiledCompactTurn } from "./compact-turn";

export interface CompactTurnOptions {
  readonly iterations: number;
  readonly algorithm?: "vanilla" | "cfr-plus";
  readonly averagingDelay?: number;
  readonly checkpointIterations?: readonly number[];
}

export function validateCompactTurnOptions(input: CompactTurnOptions) {
  if (!input || !Number.isSafeInteger(input.iterations) || input.iterations < 1 || input.iterations > 100_000) {
    throw new Error("Compact turn iterations must be an integer between 1 and 100000");
  }
  const algorithm = input.algorithm ?? "vanilla";
  const averagingDelay = input.averagingDelay ?? 0;
  if (algorithm !== "vanilla" && algorithm !== "cfr-plus") throw new Error("Unknown compact turn algorithm");
  if (!Number.isSafeInteger(averagingDelay) || averagingDelay < 0 || averagingDelay > 100_000
    || (algorithm === "vanilla" && averagingDelay !== 0)) throw new Error("Invalid compact turn averaging delay");
  const checkpoints = input.checkpointIterations ?? [];
  if (!Array.isArray(checkpoints) || checkpoints.length > 16 || new Set(checkpoints).size !== checkpoints.length
    || checkpoints.some(n => !Number.isSafeInteger(n) || n < 1 || n > input.iterations)) {
    throw new Error("Invalid compact turn checkpoints (at most 16 distinct completed iterations)");
  }
  return Object.freeze({ iterations: input.iterations, algorithm, averagingDelay,
    checkpointIterations: Object.freeze([...checkpoints]) });
}

export interface CompactTurnCheckpoint {
  readonly iteration: number;
  readonly averageStrategy: BehavioralStrategy<TurnAction>;
}

export interface CompactTurnSnapshot {
  readonly gameId: string;
  readonly backend: "shared-public-turn";
  readonly algorithmVersion: 1;
  readonly algorithm: "vanilla" | "cfr-plus";
  readonly averagingDelay: number;
  readonly iterations: number;
  readonly requestedIterations: number;
  readonly done: boolean;
  readonly regretPasses: number;
  readonly workingStorageBytes: number;
  readonly currentStrategy: BehavioralStrategy<TurnAction>;
  readonly averageStrategy: BehavioralStrategy<TurnAction>;
  readonly cumulativeRegrets: ReadonlyMap<string, readonly number[]>;
  readonly checkpoints: readonly CompactTurnCheckpoint[];
}

/** One workspace, resumed only at iteration boundaries. Compiled input is trusted/read-only. */
export function createCompactTurnSession(game: CompiledCompactTurn, input: CompactTurnOptions) {
  const options = validateCompactTurnOptions(input);
  const regrets = new Float64Array(game.actionSlotCount);
  const sums = new Float64Array(game.actionSlotCount);
  const strategy = new Float64Array(game.actionSlotCount);
  const deltas = new Float64Array(game.actionSlotCount);
  const ownReach = new Float64Array(game.index.informationSets.length);
  const reach0 = new Float64Array(game.nodeKinds.length);
  const reach1 = new Float64Array(game.nodeKinds.length);
  const value0 = new Float64Array(game.nodeKinds.length);
  const value1 = new Float64Array(game.nodeKinds.length);
  const workingStorageBytes = [regrets, sums, strategy, deltas, ownReach, reach0, reach1, value0, value1]
    .reduce((sum, array) => sum + array.byteLength, 0);
  const checkpoints: CompactTurnCheckpoint[] = [];
  const requestedCheckpoints = new Set(options.checkpointIterations);
  let completed = 0, regretPasses = 0, failed = false;
  const assertHealthy = () => { if (failed) throw new Error("Compact turn session failed; discard this workspace"); };
  const rebuild = () => {
    for (let i = 0; i < ownReach.length; i++) {
      const start = game.actionStarts[i], count = game.actionCounts[i];
      let total = 0;
      for (let a = 0; a < count; a++) total += Math.max(0, regrets[start + a]);
      if (!Number.isFinite(total)) throw new Error("Non-finite compact turn regret sum");
      for (let a = 0; a < count; a++) strategy[start + a] = total > 0 ? Math.max(0, regrets[start + a]) / total : 1 / count;
    }
  };
  const pass = (target: 0 | 1 | null, values: boolean) => {
    // Reuse one public-node workspace per deal. Player reach excludes chance;
    // duplicate appearances of an information set must have the same own reach.
    ownReach.fill(Number.NaN);
    deltas.fill(0);
    for (let deal = 0; deal < game.dealProbabilities.length; deal++) {
      reach0[0] = reach1[0] = 1;
      for (let n = 0; n < game.nodeKinds.length; n++) {
        if (!compactTurnNodeIsLive(game, deal, n) || game.nodeKinds[n] === TURN_TERMINAL) continue;
        const start = game.nodeEdgeStarts[n], count = game.nodeEdgeCounts[n];
        const player = game.nodePlayers[n];
        const info = game.nodeKinds[n] === TURN_PLAYER ? compactTurnInformationSet(game, deal, n) : -1;
        if (info >= 0) {
          const reach = player === 0 ? reach0[n] : reach1[n];
          if (Number.isNaN(ownReach[info])) ownReach[info] = reach;
          else if (Math.abs(ownReach[info] - reach) > 1e-12) throw new Error("Compact turn own reach violates perfect recall");
        }
        for (let a = 0; a < count; a++) {
          const child = game.edgeChildren[start + a];
          const probability = info < 0 ? 1 : strategy[game.actionStarts[info] + a];
          reach0[child] = info >= 0 && player === 0 ? reach0[n] * probability : reach0[n];
          reach1[child] = info >= 0 && player === 1 ? reach1[n] * probability : reach1[n];
        }
      }
      if (!values) continue;
      for (const n of game.postorder) {
        // Blocked branches may contain old workspace values. Never read them.
        if (!compactTurnNodeIsLive(game, deal, n)) continue;
        const kind = game.nodeKinds[n];
        if (kind === TURN_TERMINAL) {
          value0[n] = compactTurnUtility0(game, deal, n);
          value1[n] = -value0[n];
          continue;
        }
        const start = game.nodeEdgeStarts[n], count = game.nodeEdgeCounts[n];
        const info = kind === TURN_PLAYER ? compactTurnInformationSet(game, deal, n) : -1;
        let v0 = 0, v1 = 0;
        for (let a = 0; a < count; a++) {
          const child = game.edgeChildren[start + a];
          if (!compactTurnNodeIsLive(game, deal, child)) continue;
          const probability = kind === TURN_CHANCE ? 1 / 44 : strategy[game.actionStarts[info] + a];
          v0 += probability * value0[child];
          v1 += probability * value1[child];
        }
        value0[n] = v0; value1[n] = v1;
        const player = game.nodePlayers[n];
        if (info < 0 || (target !== null && player !== target)) continue;
        // Past chance weights regrets, while the backward river expectation above
        // weights future outcomes. Neither factor belongs in either player's reach.
        const chanceReach = game.dealProbabilities[deal] * (game.nodeRivers[n] < 0 ? 1 : 1 / 44);
        const counterfactualReach = chanceReach * (player === 0 ? reach1[n] : reach0[n]);
        for (let a = 0; a < count; a++) {
          const child = game.edgeChildren[start + a];
          deltas[game.actionStarts[info] + a] += counterfactualReach * (player === 0 ? value0[child] - v0 : value1[child] - v1);
        }
      }
    }
    if (values) regretPasses++;
  };
  const apply = (player: 0 | 1 | null, clip: boolean) => {
    for (let i = 0; i < ownReach.length; i++) {
      if (player !== null && game.informationSetPlayers[i] !== player) continue;
      for (let a = 0; a < game.actionCounts[i]; a++) {
        const slot = game.actionStarts[i] + a;
        const updated = regrets[slot] + deltas[slot];
        if (!Number.isFinite(updated)) throw new Error("Non-finite compact turn regret");
        regrets[slot] = clip ? Math.max(0, updated) : updated;
      }
    }
  };
  const accumulate = (weight: number) => {
    // Once per information set, not once per private deal or river history copy.
    if (weight <= 0) return;
    for (let i = 0; i < ownReach.length; i++) {
      if (!Number.isFinite(ownReach[i])) throw new Error("Missing compact turn own reach");
      for (let a = 0; a < game.actionCounts[i]; a++) {
        const slot = game.actionStarts[i] + a;
        sums[slot] += weight * ownReach[i] * strategy[slot];
        if (!Number.isFinite(sums[slot])) throw new Error("Non-finite compact turn average");
      }
    }
  };
  const decode = (average: boolean): BehavioralStrategy<TurnAction> => new Map(game.index.informationSets.map((entry, i) => {
    const start = game.actionStarts[i], count = game.actionCounts[i];
    let total = 0;
    for (let a = 0; a < count; a++) total += sums[start + a];
    return [entry.key, { actions: [...entry.actions], probabilities: Array.from({ length: count }, (_, a) =>
      average && total > 0 ? sums[start + a] / total : strategy[start + a]) }];
  }));
  const copyStrategy = (policy: BehavioralStrategy<TurnAction>): BehavioralStrategy<TurnAction> =>
    new Map([...policy].map(([key, entry]) => [key, { actions: [...entry.actions], probabilities: [...entry.probabilities] }]));
  return Object.freeze({
    get iterations() { return completed; },
    get done() { return completed === options.iterations && !failed; },
    advance(count: number): number {
      assertHealthy();
      if (!Number.isSafeInteger(count) || count <= 0) throw new Error("Advance requires a positive safe integer");
      const end = completed + Math.min(count, options.iterations - completed);
      try {
        while (completed < end) {
          if (options.algorithm === "vanilla") {
            // Both regret updates use one frozen strategy profile.
            rebuild(); pass(null, true); accumulate(1); apply(null, false);
          } else {
            for (const player of [0, 1] as const) { rebuild(); pass(player, true); apply(player, true); }
            rebuild(); pass(null, false); accumulate(Math.max(0, completed + 1 - options.averagingDelay));
          }
          completed++;
          // Ordinary CFR's zero-average-mass checkpoint fallback is pre-update;
          // snapshot() deliberately rebuilds the post-update current policy instead.
          if (requestedCheckpoints.has(completed)) checkpoints.push({ iteration: completed, averageStrategy: decode(true) });
        }
      } catch (error) { failed = true; throw error; }
      return completed;
    },
    snapshot(): CompactTurnSnapshot {
      assertHealthy();
      rebuild();
      const currentStrategy = decode(false), averageStrategy = decode(true);
      validateStrategy(game.index, currentStrategy); validateStrategy(game.index, averageStrategy);
      return { gameId: game.source.id, backend: "shared-public-turn", algorithmVersion: 1,
        algorithm: options.algorithm, averagingDelay: options.averagingDelay, iterations: completed,
        requestedIterations: options.iterations, done: completed === options.iterations,
        regretPasses, workingStorageBytes, currentStrategy, averageStrategy,
        cumulativeRegrets: new Map(game.index.informationSets.map((entry, i) => [entry.key,
          Array.from(regrets.subarray(game.actionStarts[i], game.actionStarts[i] + game.actionCounts[i]))])),
        checkpoints: checkpoints.map(checkpoint => ({ iteration: checkpoint.iteration, averageStrategy: copyStrategy(checkpoint.averageStrategy) })),
      };
    },
  });
}
