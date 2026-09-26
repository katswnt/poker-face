// Solve a PreflopSpotV1 to a PreflopResultV1 (node-only: results carry sha256 hashes).
//
// CFR (cfr.ts) runs in blocks of `checkEvery` iterations; after each block the average strategy
// is graded by the independent grader (grader.ts). The solve stops at the first check with
// exploitability ≤ target, or at maxIterations (then converged = false: not publishable).
// The saved strategy is rounded to 1e-6 and the saved grade is of the rounded strategy.
import { HANDS } from "../hands";
import { PREFLOP_RESULT_FORMAT, validatePreflopSpot, type PreflopNodeStrategy, type PreflopResultV1, type PreflopSpotV1 } from "./contract";
import { PreflopCfr } from "./cfr";
import { evaluatePreflopProfile, gradePreflopProfile } from "./grader";
import { hashPreflopSpot, hashRealizationTable } from "./hash";
import { aggregateStats } from "./stats";
import { buildPreflopGame, type PreflopGame } from "./terminal";
import type { PreflopProfile } from "./tree";

export const PREFLOP_MODEL_LABEL =
  "simplified preflop model; not GTO preflop: CFR on a small preflop tree, flop play valued by equity × realization factor R";

const FREQ_DECIMALS = 1e6;
const EV_DECIMALS = 1e5;

/** Round every frequency to 1e-6; the largest action absorbs the rounding residual so each class sums to exactly 1 in decimal. */
export function roundProfile(game: PreflopGame, profile: PreflopProfile): PreflopProfile {
  const out = new Map<string, number[][]>();
  for (const node of game.tree.decisions) {
    const freq = profile.get(node.id)!;
    const rounded = freq.map(row => row.map(p => Math.round(p * FREQ_DECIMALS)));
    for (let h = 0; h < game.n; h++) {
      let sum = 0, largest = 0;
      for (let a = 0; a < rounded.length; a++) {
        sum += rounded[a][h];
        if (rounded[a][h] > rounded[largest][h]) largest = a;
      }
      rounded[largest][h] += FREQ_DECIMALS - sum;
    }
    out.set(node.id, rounded.map(row => row.map(v => v / FREQ_DECIMALS)));
  }
  return out;
}

export interface SolveOptions {
  readonly onCheck?: (iteration: number, exploitability: number) => void;
  /** Override the stopping iteration count (tests / short reproductions). */
  readonly iterations?: number;
}

export interface SolveOutcome {
  readonly result: PreflopResultV1;
  readonly game: PreflopGame;
  readonly profile: PreflopProfile;
}

export function solvePreflop(spotInput: PreflopSpotV1, options: SolveOptions = {}): SolveOutcome {
  const spot = validatePreflopSpot(spotInput);
  const game = buildPreflopGame(spot);
  const cfr = new PreflopCfr(game);
  const { checkEvery, maxIterations, targetExploitability } = spot.solver;
  const curve: { iteration: number; exploitability: number }[] = [];
  const limit = options.iterations ?? maxIterations;
  while (cfr.iterations < limit) {
    cfr.run(Math.min(checkEvery, limit - cfr.iterations));
    // Grade what would be saved: the rounded average strategy.
    const exploitability = gradePreflopProfile(game, roundProfile(game, cfr.averageStrategy())).exploitability;
    curve.push({ iteration: cfr.iterations, exploitability });
    options.onCheck?.(cfr.iterations, exploitability);
    if (options.iterations === undefined && exploitability <= targetExploitability) break;
  }
  const profile = roundProfile(game, cfr.averageStrategy());
  return { result: buildResult(game, profile, cfr.iterations, curve), game, profile };
}

export function buildResult(
  game: PreflopGame, profile: PreflopProfile, iterations: number,
  curve: readonly { iteration: number; exploitability: number }[],
): PreflopResultV1 {
  const { grade, actionEv } = evaluatePreflopProfile(game, profile);
  const strategy: Record<string, PreflopNodeStrategy> = {};
  for (const node of game.tree.decisions) {
    strategy[node.id] = {
      player: node.player,
      actions: node.actions,
      freq: profile.get(node.id)!,
      actionEv: actionEv.get(node.id)!.map(row => row.map(v => v === null ? null : Math.round(v * EV_DECIMALS) / EV_DECIMALS)),
    };
  }
  const spot = game.spot;
  return {
    format: PREFLOP_RESULT_FORMAT,
    version: 1,
    label: spot.label,
    spotHash: hashPreflopSpot(spot),
    realizationHash: hashRealizationTable(spot.realization),
    spot,
    classes: game.classes.map(c => HANDS[c].label),
    iterations,
    converged: grade.exploitability <= spot.solver.targetExploitability,
    exploitabilityCurve: curve,
    grade,
    strategy,
    stats: aggregateStats(game, profile),
    provenance: {
      model: PREFLOP_MODEL_LABEL,
      equityMatrix: "src/lib/solver/equity-matrix.json (exact 169×169 all-in equity, all C(48,5) boards, card-disjoint measure)",
      realizationSource: spot.realization.source,
      notes: [
        "Chip EV in bb per hand, net from the start of the hand; no ante; rake as in spot.rake.",
        "Card removal between the two players via ordered card-disjoint combo counts; the folded players' cards are ignored.",
        "Strategies are per canonical hand class (169), not per suited combo.",
      ],
    },
  };
}

/** Rebuild the in-memory profile from a saved result. */
export function profileFromResult(result: PreflopResultV1): PreflopProfile {
  return new Map(Object.entries(result.strategy).map(([id, s]) => [id, s.freq]));
}

/** Structural and identity checks on a saved result (does not re-grade). */
export function validatePreflopResult(result: PreflopResultV1): PreflopGame {
  if (result.format !== PREFLOP_RESULT_FORMAT || result.version !== 1) throw new Error("preflop result: format/version");
  const game = buildPreflopGame(result.spot);
  if (hashPreflopSpot(result.spot) !== result.spotHash) throw new Error("preflop result: spot hash mismatch");
  if (hashRealizationTable(result.spot.realization) !== result.realizationHash) throw new Error("preflop result: realization hash mismatch");
  const labels = game.classes.map(c => HANDS[c].label);
  if (labels.join(",") !== result.classes.join(",")) throw new Error("preflop result: class list mismatch");
  const ids = game.tree.decisions.map(d => d.id).sort();
  const saved = Object.keys(result.strategy).sort();
  if (ids.join("|") !== saved.join("|")) throw new Error("preflop result: strategy nodes do not match the tree");
  for (const node of game.tree.decisions) {
    const s = result.strategy[node.id];
    if (s.player !== node.player || s.actions.join(",") !== node.actions.join(",")) throw new Error(`preflop result: node "${node.id}" actions/player mismatch`);
  }
  return game;
}
