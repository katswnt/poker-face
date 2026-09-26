// Preflop solver v1 contract (tasks/preflop-solver-v1-spec.md, PF0).
//
// A `PreflopSpotV1` fully describes one simplified preflop game: who posts what, dead money,
// the effective stack, rake (a v1 stub, must be 0 for published solves), the raise menu, the
// realization table R that values flop-reaching terminals, and the solver options. Its sha256
// (hash.ts, node-only) identifies the game; every result records it.
//
// Player 0 = BTN (acts first preflop, in position postflop). Player 1 = BB (out of position).
// In the `hu` structure player 0 is the button/small blind, as in pushfold.ts.
//
// This module is browser-safe (no node imports) and pure.
import { NUM_CLASSES } from "../comboCounts";

export const PREFLOP_SPOT_FORMAT = "poker-face-preflop-spot";
export const PREFLOP_RESULT_FORMAT = "poker-face-preflop-result";
export const PREFLOP_REALIZATION_FORMAT = "poker-face-preflop-realization";

export type PreflopStructureId = "6max-btn-bb" | "hu";
export type PreflopPlayer = 0 | 1;
export type PotType = "srp" | "3bp" | "4bp";
export const POT_TYPES: readonly PotType[] = ["srp", "3bp", "4bp"];
export type RealizationPosition = "ip" | "oop";

export interface PreflopStructure {
  readonly id: PreflopStructureId;
  /** Blinds posted by [player 0, player 1], in bb. */
  readonly posted: readonly [number, number];
  /** Dead money already in the pot (6-max: the folded SB's 0.5). */
  readonly dead: number;
  /** Effective stack in bb, counted from the start of the hand (blinds included). */
  readonly stack: number;
  /** v1: no antes. */
  readonly ante: 0;
}

export interface PreflopRake {
  /** Fraction of the pot, e.g. 0.05. v1 published solves use 0. */
  readonly pct: number;
  readonly capBb: number;
  /** Rake is taken only from pots that see a flop (or an all-in showdown). Must be true. */
  readonly noFlopNoDrop: true;
}

export interface PreflopMenu {
  /** "Raise to" sizes by raise level: [open, 3-bet, 4-bet, …]. Empty = no non-all-in raises. */
  readonly raises: readonly number[];
  /** Player 0 may move all-in at the root (the push/fold oracle uses this). */
  readonly openJam: boolean;
  /** After any non-all-in raise, the player facing it may move all-in. */
  readonly jamOverRaise: boolean;
  /** v1: limping is not implemented (validation rejects true). */
  readonly allowLimp: false;
}

/** R[position][potType][class]; class order = HANDS (169, grid row-major). */
export interface RealizationTableV1 {
  readonly format: typeof PREFLOP_REALIZATION_FORMAT;
  readonly version: 1;
  /** Human-readable origin, e.g. "literature defaults (spec §3.1)" or "fitted from B4 library …". */
  readonly source: string;
  readonly ip: Readonly<Record<PotType, readonly number[]>>;
  readonly oop: Readonly<Record<PotType, readonly number[]>>;
}

export type PreflopAlgorithm = "cfr+" | "dcfr";

export interface PreflopSolverOptions {
  readonly algorithm: PreflopAlgorithm;
  /** Stop once exploitability (bb/hand) is at or below this. */
  readonly targetExploitability: number;
  readonly checkEvery: number;
  readonly maxIterations: number;
  /** Linear averaging delay d (CFR+): iteration t contributes weight max(0, t − d). */
  readonly averagingDelay: number;
  /** DCFR parameters (used only when algorithm = "dcfr"). */
  readonly dcfr: { readonly alpha: number; readonly beta: number; readonly gamma: number };
}

export interface PreflopSpotV1 {
  readonly format: typeof PREFLOP_SPOT_FORMAT;
  readonly version: 1;
  readonly label: string;
  readonly structure: PreflopStructure;
  readonly rake: PreflopRake;
  readonly menu: PreflopMenu;
  readonly realization: RealizationTableV1;
  readonly solver: PreflopSolverOptions;
  /** Hand classes in the game (indices into HANDS, ascending). "all" = the 169 classes. */
  readonly classes: "all" | readonly number[];
}

/** Per-node strategy: freq[actionIndex][classPosition] over the spot's classes. */
export interface PreflopNodeStrategy {
  readonly player: PreflopPlayer;
  readonly actions: readonly string[];
  readonly freq: readonly (readonly number[])[];
  /** EV (bb, net from hand start) of each action for each class vs the opponent's strategy, given the node is reached. */
  readonly actionEv: readonly (readonly (number | null)[])[];
}

export interface PreflopGrade {
  /** Expected utility per hand (bb, net from hand start) for [player 0, player 1]. */
  readonly value: readonly [number, number];
  readonly bestResponseValue: readonly [number, number];
  readonly gains: readonly [number, number];
  /** (gain0 + gain1) / 2 in bb/hand. */
  readonly exploitability: number;
}

/**
 * Combo-weighted range statistics in % (see stats.ts for exact definitions). Keys present depend
 * on the menu: btnOpenPct, btnOpenJamPct, bbDefendPct, bbCallPct, bb3betPct, bbJamVsOpenPct,
 * btn4betOfOpenPct, btnJamVs3betOfOpenPct, btnCallVs3betOfOpenPct, btnFoldVs3betOfOpenPct,
 * bbJamVs4betOf3betPct, bbCallVs4betOf3betPct, bbCallVsJamPct (push/fold).
 */
export type PreflopAggregateStats = Readonly<Record<string, number>>;

export interface PreflopResultV1 {
  readonly format: typeof PREFLOP_RESULT_FORMAT;
  readonly version: 1;
  readonly label: string;
  readonly spotHash: string;
  readonly realizationHash: string;
  readonly spot: PreflopSpotV1;
  readonly classes: readonly string[];
  readonly iterations: number;
  readonly converged: boolean;
  /** Exploitability after each check (bb/hand). */
  readonly exploitabilityCurve: readonly { readonly iteration: number; readonly exploitability: number }[];
  /** Grade of the saved (rounded) strategy by grader.ts. */
  readonly grade: PreflopGrade;
  readonly strategy: Readonly<Record<string, PreflopNodeStrategy>>;
  readonly stats: PreflopAggregateStats;
  readonly provenance: {
    readonly model: string;
    readonly equityMatrix: string;
    readonly realizationSource: string;
    readonly notes: readonly string[];
  };
}

export const DEFAULT_SOLVER_OPTIONS: PreflopSolverOptions = {
  algorithm: "cfr+",
  targetExploitability: 0.001,
  checkEvery: 100,
  maxIterations: 100_000,
  // Spec §4 suggested d = 0; d = 100 is the default because with d = 0 the first (uniform)
  // iterations leave dust in the average strategy of rarely reached classes (e.g. KK folding
  // 3% to a 5-bet jam it almost never faces), and it converges faster (tasks/preflop-solver-v1-spec.md PF2 notes).
  averagingDelay: 100,
  dcfr: { alpha: 1.5, beta: 0, gamma: 2 },
};

export const NO_RAKE: PreflopRake = { pct: 0, capBb: 0, noFlopNoDrop: true };

/** 6-max BTN vs BB, SB folded (dead 0.5), 100bb: the formation of the B4 flop library. */
export const SIX_MAX_BTN_BB: PreflopStructure = { id: "6max-btn-bb", posted: [0, 1], dead: 0.5, stack: 100, ante: 0 };
/** Spec §2 menu: open 2.5, 3-bet 11, 4-bet 24, jam over any raise; no open-jam, no limp. */
export const V1_MENU: PreflopMenu = { raises: [2.5, 11, 24], openJam: false, jamOverRaise: true, allowLimp: false };
/** Push/fold oracle menu (pushfold.ts): jam or fold, then call or fold. */
export const JAM_FOLD_MENU: PreflopMenu = { raises: [], openJam: true, jamOverRaise: false, allowLimp: false };

export function huStructure(stack: number): PreflopStructure {
  return { id: "hu", posted: [0.5, 1], dead: 0, stack, ante: 0 };
}

// ── Validation ──────────────────────────────────────────────────────────────────────────

function fail(message: string): never {
  throw new Error(`Invalid preflop spot: ${message}`);
}

function finite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${label} must be a finite number`);
  return value;
}

function exactKeys(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, i) => key !== expected[i])) {
    fail(`${label} must have exactly the keys ${expected.join(", ")}; got ${actual.join(", ")}`);
  }
  return record;
}

export function validateRealizationTable(table: unknown): RealizationTableV1 {
  const record = exactKeys(table, ["format", "version", "source", "ip", "oop"], "realization");
  if (record.format !== PREFLOP_REALIZATION_FORMAT || record.version !== 1) fail("realization format/version");
  if (typeof record.source !== "string" || record.source.length === 0) fail("realization.source must be a non-empty string");
  for (const position of ["ip", "oop"] as const) {
    const byPot = exactKeys(record[position], POT_TYPES, `realization.${position}`);
    for (const pot of POT_TYPES) {
      const values = byPot[pot];
      if (!Array.isArray(values) || values.length !== NUM_CLASSES) fail(`realization.${position}.${pot} must have ${NUM_CLASSES} entries`);
      values.forEach((v, i) => {
        const r = finite(v, `realization.${position}.${pot}[${i}]`);
        if (r <= 0 || r > 10) fail(`realization.${position}.${pot}[${i}] = ${r} is outside (0, 10]`);
      });
    }
  }
  return table as RealizationTableV1;
}

export function validatePreflopSpot(spot: unknown): PreflopSpotV1 {
  const record = exactKeys(spot, ["format", "version", "label", "structure", "rake", "menu", "realization", "solver", "classes"], "spot");
  if (record.format !== PREFLOP_SPOT_FORMAT || record.version !== 1) fail("format/version");
  if (typeof record.label !== "string" || record.label.length === 0) fail("label must be a non-empty string");

  const structure = exactKeys(record.structure, ["id", "posted", "dead", "stack", "ante"], "structure");
  if (structure.id !== "6max-btn-bb" && structure.id !== "hu") fail(`unknown structure ${String(structure.id)}`);
  if (!Array.isArray(structure.posted) || structure.posted.length !== 2) fail("structure.posted must be [p0, p1]");
  const [post0, post1] = structure.posted.map((v, i) => finite(v, `structure.posted[${i}]`));
  const dead = finite(structure.dead, "structure.dead");
  const stack = finite(structure.stack, "structure.stack");
  if (structure.ante !== 0) fail("ante must be 0 in v1");
  if (post0 < 0 || post1 <= 0 || post0 >= post1) fail("posted blinds must satisfy 0 ≤ p0 < p1");
  if (dead < 0) fail("dead money must be ≥ 0");
  if (stack <= post1) fail("stack must exceed the big blind");
  if (structure.id === "6max-btn-bb" && (post0 !== 0 || post1 !== 1 || dead !== 0.5)) fail("6max-btn-bb posts [0, 1] with 0.5 dead");
  if (structure.id === "hu" && (post0 !== 0.5 || post1 !== 1 || dead !== 0)) fail("hu posts [0.5, 1] with no dead money");

  const rake = exactKeys(record.rake, ["pct", "capBb", "noFlopNoDrop"], "rake");
  const pct = finite(rake.pct, "rake.pct"), cap = finite(rake.capBb, "rake.capBb");
  if (pct < 0 || pct >= 0.2) fail("rake.pct must be in [0, 0.2)");
  if (cap < 0) fail("rake.capBb must be ≥ 0");
  if (rake.noFlopNoDrop !== true) fail("rake.noFlopNoDrop must be true");

  const menu = exactKeys(record.menu, ["raises", "openJam", "jamOverRaise", "allowLimp"], "menu");
  if (!Array.isArray(menu.raises) || menu.raises.length > 3) fail("menu.raises must be an array of at most 3 sizes (open, 3-bet, 4-bet)");
  let previous = post1;
  menu.raises.forEach((v, i) => {
    const to = finite(v, `menu.raises[${i}]`);
    if (!(to > previous)) fail(`menu.raises[${i}] = ${to} must exceed the previous bet ${previous}`);
    if (!(to < stack)) fail(`menu.raises[${i}] = ${to} must be below the stack ${stack} (use jam)`);
    previous = to;
  });
  if (typeof menu.openJam !== "boolean" || typeof menu.jamOverRaise !== "boolean") fail("menu jam flags must be booleans");
  if (menu.allowLimp !== false) fail("menu.allowLimp: limping is not implemented in v1");
  if (menu.raises.length === 0 && !menu.openJam) fail("menu gives player 0 no way to enter the pot");

  validateRealizationTable(record.realization);

  const solver = exactKeys(record.solver, ["algorithm", "targetExploitability", "checkEvery", "maxIterations", "averagingDelay", "dcfr"], "solver");
  if (solver.algorithm !== "cfr+" && solver.algorithm !== "dcfr") fail("solver.algorithm must be cfr+ or dcfr");
  if (!(finite(solver.targetExploitability, "solver.targetExploitability") > 0)) fail("targetExploitability must be > 0");
  for (const key of ["checkEvery", "maxIterations"] as const) {
    const v = finite(solver[key], `solver.${key}`);
    if (!Number.isSafeInteger(v) || v <= 0) fail(`solver.${key} must be a positive integer`);
  }
  const delay = finite(solver.averagingDelay, "solver.averagingDelay");
  if (!Number.isSafeInteger(delay) || delay < 0) fail("solver.averagingDelay must be a non-negative integer");
  const dcfr = exactKeys(solver.dcfr, ["alpha", "beta", "gamma"], "solver.dcfr");
  for (const key of ["alpha", "beta", "gamma"]) finite(dcfr[key], `solver.dcfr.${key}`);

  if (record.classes !== "all") {
    const classes = record.classes;
    if (!Array.isArray(classes) || classes.length < 2) fail("classes must be \"all\" or at least 2 class indices");
    classes.forEach((c, i) => {
      if (!Number.isSafeInteger(c) || c < 0 || c >= NUM_CLASSES) fail(`classes[${i}] is not a class index`);
      if (i > 0 && !(c > classes[i - 1])) fail("classes must be strictly ascending");
    });
  }
  return spot as PreflopSpotV1;
}

export function spotClasses(spot: PreflopSpotV1): number[] {
  return spot.classes === "all" ? Array.from({ length: NUM_CLASSES }, (_, i) => i) : [...spot.classes];
}

export function makeSpot(fields: {
  label: string; structure: PreflopStructure; menu: PreflopMenu; realization: RealizationTableV1;
  rake?: PreflopRake; solver?: Partial<PreflopSolverOptions>; classes?: "all" | readonly number[];
}): PreflopSpotV1 {
  return validatePreflopSpot({
    format: PREFLOP_SPOT_FORMAT, version: 1, label: fields.label,
    structure: fields.structure, rake: fields.rake ?? NO_RAKE, menu: fields.menu,
    realization: fields.realization,
    solver: { ...DEFAULT_SOLVER_OPTIONS, ...fields.solver },
    classes: fields.classes ?? "all",
  });
}
