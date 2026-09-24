import { createVectorKernelScratch } from "../vector/kernels";
import { validateVectorOptions, type VectorTurnOptions } from "../vector/session";
import { FLOP_CHANCE, FLOP_PLAYER, FLOP_TERMINAL, type VectorFlop } from "./compiled";
import { flopTerminalValues } from "./ranges";
export { validateFlopPolicy } from "./policy";

export interface FlopCheckpoint {
  version: 1; backend: "vector-flop"; gameIdentity: string;
  options: ReturnType<typeof validateVectorOptions>; iterations: number;
  regrets: Float64Array; strategySums: Float64Array;
}
export function validateFlopCheckpoint(game: VectorFlop, saved: FlopCheckpoint) {
  if (!saved || saved.version !== 1 || saved.backend !== "vector-flop" || saved.gameIdentity !== game.gameIdentity) throw new Error("Flop checkpoint identity differs");
  const options = validateVectorOptions(saved.options), iterations = saved.iterations;
  if (!Number.isSafeInteger(iterations) || iterations < 0 || iterations > options.iterations) throw new Error("Invalid flop checkpoint iteration");
  for (const a of [saved.regrets, saved.strategySums]) if (!(a instanceof Float64Array) || a.length !== game.preflight.actionSlots) throw new Error("Invalid flop checkpoint array");
  const span = Math.max(0, iterations - options.averagingDelay), maxAverage = options.algorithm === "vanilla" ? iterations : span * (span + 1) / 2;
  const maxRegret = 2 * iterations * (game.request.committedPerPlayer + Math.min(...game.request.stackBehind));
  for (let n = 0; n < game.kinds.length; n++) {
    if (game.kinds[n] !== FLOP_PLAYER) continue;
    const own = game.ranges.boards[game.boards[n]].view.players[game.players[n]];
    for (let h = 0; h < own.hands.length; h++) {
      const start = game.actionStarts[n] + 2 * h; let average = 0;
      for (let a = 0; a < 2; a++) {
        const r = saved.regrets[start + a], s = saved.strategySums[start + a];
        if (!Number.isFinite(r) || !Number.isFinite(s) || Math.abs(r) > maxRegret * (1 + 1e-12) || s < 0
          || options.algorithm === "cfr-plus" && r < 0 || !own.compatibleCounts[h] && (r !== 0 || s !== 0)) throw new Error("Flop checkpoint values outside bounds");
        average += s;
      }
      if (average > maxAverage * (1 + 1e-12)) throw new Error("Flop checkpoint average exceeds iteration weight");
    }
  }
  return options;
}

/** Numeric public-history/own-hand CFR; no full policy string maps or repeated private deals. */
export function createVectorFlopSession(game: VectorFlop, input: VectorTurnOptions, saved?: FlopCheckpoint) {
  const options = validateVectorOptions(input);
  if (saved && JSON.stringify(validateFlopCheckpoint(game, saved)) !== JSON.stringify(options)) throw new Error("Flop checkpoint options differ");
  const count = game.preflight.actionSlots, nodes = game.kinds.length, widths = game.ranges.players.map(p => p.hands.length);
  const regrets = saved ? saved.regrets.slice() : new Float64Array(count), sums = saved ? saved.strategySums.slice() : new Float64Array(count);
  const strategy = new Float64Array(count), reach = widths.map(w => new Float64Array(nodes * w)), values = new Float64Array(nodes * Math.max(...widths));
  const weighted = widths.map(w => new Float64Array(w)), masked = widths.map(w => new Float64Array(w)), terminal = widths.map(w => new Float64Array(w));
  const scratch = ([0, 1] as const).map(p => createVectorKernelScratch(widths[1 - p]));
  const workingStorageBytes = [regrets, sums, strategy, ...reach, values, ...weighted, ...masked, ...terminal,
    ...scratch.flatMap(s => [s.cardMass, s.cardCount, s.weights, s.included])].reduce((s, a) => s + a.byteLength, 0);
  let completed = saved?.iterations ?? 0, failed = false;
  const healthy = () => { if (failed) throw new Error("Flop session failed; discard this workspace"); };
  const rebuild = () => {
    for (let n = 0; n < nodes; n++) {
      if (game.kinds[n] !== FLOP_PLAYER) continue;
      const own = game.ranges.boards[game.boards[n]].view.players[game.players[n]];
      for (let h = 0; h < own.hands.length; h++) {
        if (!own.compatibleCounts[h]) continue;
        const s = game.actionStarts[n] + 2 * h, a = Math.max(0, regrets[s]), b = Math.max(0, regrets[s + 1]), total = a + b;
        if (!Number.isFinite(total)) throw new Error("Non-finite flop regrets");
        strategy[s] = total ? a / total : 0.5; strategy[s + 1] = total ? b / total : 0.5;
      }
    }
  };
  const forward = () => {
    for (const p of [0, 1] as const) {
      const w = widths[p], array = reach[p], root = game.ranges.boards[0].view.players[p];
      for (let h = 0; h < w; h++) array[h] = root.compatibleCounts[h] ? 1 : 0;
      for (let n = 0; n < nodes; n++) {
        const acting = game.kinds[n] === FLOP_PLAYER && game.players[n] === p;
        for (let a = 0; a < game.edgeCounts[n]; a++) {
          const child = game.edges[game.edgeStarts[n] + a], live = game.ranges.boards[game.boards[child]].view.players[p].compatibleCounts;
          for (let h = 0; h < w; h++) array[child * w + h] = live[h] ? array[n * w + h] * (acting ? strategy[game.actionStarts[n] + 2 * h + a] : 1) : 0;
        }
      }
    }
  };
  const backward = (p: 0 | 1) => {
    const own = game.ranges.players[p], other = game.ranges.players[1 - p], w = widths[p], k = widths[1 - p];
    for (let n = nodes - 1; n >= 0; n--) {
      const offset = n * w, board = game.boards[n], context = game.ranges.boards[board], live = context.view.players[p].compatibleCounts;
      if (game.kinds[n] === FLOP_TERMINAL) {
        for (let h = 0; h < k; h++) weighted[1 - p][h] = other.weights[h] * reach[1 - p][n * k + h];
        flopTerminalValues(game.ranges, p, board, weighted[1 - p], game.scales[n], game.folds[n] * (p === 0 ? 1 : -1), terminal[p], scratch[p], masked[1 - p], options.kernel === "naive");
        values.set(terminal[p], offset); continue;
      }
      const chance = game.kinds[n] === FLOP_CHANCE, acting = !chance && game.players[n] === p;
      const chanceProbability = chance ? 1 / (context.turn ? 44 : 45) : 1;
      const pastChance = context.river ? 1 / 1980 : context.turn ? 1 / 45 : 1;
      for (let h = 0; h < w; h++) {
        if (!live[h]) { values[offset + h] = 0; continue; }
        const slot = game.actionStarts[n] + 2 * h; let mixed = 0;
        for (let a = 0; a < game.edgeCounts[n]; a++) {
          const child = game.edges[game.edgeStarts[n] + a];
          mixed += (chance ? chanceProbability : acting ? strategy[slot + a] : 1) * values[child * w + h];
        }
        values[offset + h] = mixed;
        if (!acting) continue;
        const cf = own.weights[h] / game.ranges.rootNormalizer * pastChance;
        for (let a = 0; a < 2; a++) {
          const child = game.edges[game.edgeStarts[n] + a], updated = regrets[slot + a] + cf * (values[child * w + h] - mixed);
          if (!Number.isFinite(updated)) throw new Error("Non-finite flop regret update");
          // Each information row occurs once in this public tree. Updating regrets
          // now cannot change the frozen strategy used by this traversal.
          regrets[slot + a] = options.algorithm === "cfr-plus" ? Math.max(0, updated) : updated;
        }
      }
    }
  };
  const average = (weight: number) => {
    if (weight <= 0) return;
    for (let n = 0; n < nodes; n++) {
      if (game.kinds[n] !== FLOP_PLAYER) continue;
      const p = game.players[n], w = widths[p], live = game.ranges.boards[game.boards[n]].view.players[p].compatibleCounts;
      for (let h = 0; h < w; h++) {
        if (!live[h]) continue;
        const s = game.actionStarts[n] + 2 * h, mass = weight * reach[p][n * w + h];
        for (let a = 0; a < 2; a++) { sums[s + a] += mass * strategy[s + a]; if (!Number.isFinite(sums[s + a])) throw new Error("Non-finite flop average"); }
      }
    }
  };
  return Object.freeze({
    get iterations() { return completed; }, get done() { return !failed && completed === options.iterations; }, workingStorageBytes,
    advance(count: number) {
      healthy(); if (!Number.isSafeInteger(count) || count < 1) throw new Error("Flop advance needs a positive integer");
      const end = completed + Math.min(count, options.iterations - completed);
      try {
        while (completed < end) {
          if (options.algorithm === "vanilla") { rebuild(); forward(); average(1); backward(0); backward(1); }
          else { for (const p of [0, 1] as const) { rebuild(); forward(); backward(p); } rebuild(); forward(); average(Math.max(0, completed + 1 - options.averagingDelay)); }
          completed++;
        }
      } catch (error) { failed = true; throw error; }
      return completed;
    },
    snapshot() {
      healthy(); rebuild(); const policy = strategy.slice();
      for (let s = 0; s < count; s += 2) { const total = sums[s] + sums[s + 1]; if (total > 0) { policy[s] = sums[s] / total; policy[s + 1] = sums[s + 1] / total; } }
      return { backend: "vector-flop" as const, version: 1 as const, gameIdentity: game.gameIdentity, iterations: completed, options: { ...options }, policy };
    },
    checkpoint(): FlopCheckpoint { healthy(); return { backend: "vector-flop", version: 1, gameIdentity: game.gameIdentity, iterations: completed,
      options: { ...options }, regrets: regrets.slice(), strategySums: sums.slice() }; },
  });
}
export function restoreVectorFlopSession(game: VectorFlop, saved: FlopCheckpoint) { return createVectorFlopSession(game, validateFlopCheckpoint(game, saved), saved); }
