// PF3: estimate the realization factor R per hand class from the B4 flop library (spec §3.2).
//
// Pipeline, per position p (IP = BTN, OOP = BB), SRP only (the library has no 3BP/4BP):
//  1. Samples: every combo x on every library flop f, with its flop-root range weight r
//     (postflop-solver's normalizedWeight: range weight × blocker-compatible opponent weight),
//     pot share s = (rootEv + P/2) / P and all-in equity e vs the opponent's flop-root range.
//  2. Flop weights: w_f(x) = fraction of the flops disjoint from x in f's texture stratum
//     (texture.ts), renormalized over the library flops on which x appears.
//  3. Ratio estimator: S̄(c) = Σ w r s / Σ w r, Ē(c) = Σ w r e / Σ w r, R̂(c) = S̄ / Ē (flop luck
//     cancels: a hand that hits has both high share and high equity). Kish size over flops:
//     n_c = (Σ_f m_f)² / Σ_f m_f², m_f = Σ_{x∈c} w r.
//  4. Shrinkage to the class's bucket: R̃ = (n R̂ + κ R̂_bucket) / (n + κ); classes the library
//     never deals take R̂_bucket; empty buckets take the default.
//  5. Target share vs the library's own opponent range over all boards: T(c) = R̃(c)·E_mat(c),
//     E_mat = exact matrix equity vs that range (Ē vs E_mat is reported as a sampling diagnostic).
//  6. Fit: the terminal form a/(a+b) is not linear in R, so iterate R ← clamp(R·T / M(R)) for both
//     positions jointly, M = model share vs the library ranges, until max |M − T| < tolerance
//     over unclamped classes or maxSteps. Clamps to [0.3, 1.6] are reported.
import { classOfCards, DISJOINT, NUM_CLASSES } from "../comboCounts";
import { HANDS } from "../hands";
import type { BridgeLibraryRoot } from "../bridge/library/model";
import { PREFLOP_REALIZATION_FORMAT, validateRealizationTable, type PotType, type RealizationPosition, type RealizationTableV1 } from "./contract";
import { CLASS_BUCKETS, HAND_BUCKETS, REALIZATION_DEFAULTS, type HandBucket } from "./realization";
import { EQ, flopShareIp } from "./terminal";
import { comboStratumWeights, parseCard, TEXTURE_STRATA, stratumWeights, type TextureStratum } from "./texture";

/** Spec §3.2 `RealizationSample`: one library spot, flop-root values per combo, per position. */
export interface RealizationSample {
  readonly spotId: TextureStratum;
  readonly spotHash: string;
  readonly potType: PotType;
  readonly startingPot: number;
  readonly rangesHash: string;
  readonly exploitabilityPctPot: number;
  readonly flop: readonly [string, string, string];
  /** Fraction of all 22,100 flops in this spot's texture stratum. */
  readonly flopWeight: number;
  readonly perCombo: Readonly<Record<RealizationPosition, {
    readonly hands: readonly string[];
    readonly weight: readonly number[];
    readonly normalizedWeight: readonly number[];
    readonly rootEv: readonly number[];
    readonly rootEquity: readonly number[];
  }>>;
}

/** Adapter over B4 root.json files (players[0] = BB out of position, players[1] = BTN in position). */
export function realizationSamples(roots: readonly BridgeLibraryRoot[]): RealizationSample[] {
  const weights = stratumWeights();
  const seen = new Set<string>();
  return roots.map(root => {
    if (!(TEXTURE_STRATA as readonly string[]).includes(root.spotId)) throw new Error(`root ${root.spotId} is not a texture stratum`);
    if (seen.has(root.spotId)) throw new Error(`duplicate root ${root.spotId}`);
    seen.add(root.spotId);
    if (root.potType !== "srp") throw new Error(`root ${root.spotId}: only SRP libraries are supported`);
    const [oop, ip] = root.players;
    if (!/^BB/.test(oop.role) || !/^BTN/.test(ip.role)) throw new Error(`root ${root.spotId}: unexpected player roles ${oop.role} / ${ip.role}`);
    for (const p of root.players) {
      const len = p.hands.length;
      if ([p.weight, p.normalizedWeight, p.rootEv, p.rootEquity].some(a => a.length !== len)) throw new Error(`root ${root.spotId}: ragged player arrays`);
    }
    const strip = (p: BridgeLibraryRoot["players"][number]) => ({
      hands: p.hands, weight: p.weight, normalizedWeight: p.normalizedWeight, rootEv: p.rootEv, rootEquity: p.rootEquity,
    });
    return {
      spotId: root.spotId as TextureStratum, spotHash: root.spotHash, potType: "srp" as const, startingPot: root.startingPot,
      rangesHash: root.rangesHash, exploitabilityPctPot: root.exploitabilityPctPot,
      flop: root.flop.cards, flopWeight: weights[root.spotId as TextureStratum],
      perCombo: { oop: strip(oop), ip: strip(ip) },
    };
  });
}

export interface FitOptions {
  readonly kappa: number;
  readonly clamp: readonly [number, number];
  readonly tolerance: number;
  readonly maxSteps: number;
  /** Shift unpinned targets by δ so they conserve the pot (default true; false is a diagnostic: the fit then cannot converge). */
  readonly conservePot: boolean;
}

export const PF3_REALIZATION_SOURCE =
  "fitted per class from the 12 B4 SRP flop-root solves (hand-written input ranges); 3BP/4BP cells are spec §3.1 defaults (no library)";

export const DEFAULT_FIT_OPTIONS: FitOptions = { kappa: 4, clamp: [0.3, 1.6], tolerance: 0.005, maxSteps: 50, conservePot: true };

/** Per-class measurement for one position (class-level sums of the ratio estimator). */
export interface ClassMeasurement {
  /** Σ w r over the class's samples (0 = the library never deals this class to this position). */
  readonly mass: number;
  readonly share: number;
  readonly equity: number;
  readonly kish: number;
}

export interface PositionMeasurement {
  readonly classes: readonly ClassMeasurement[];
  readonly buckets: Readonly<Record<HandBucket, ClassMeasurement>>;
  /** Library preflop range per class: mean combo weight (0..1). */
  readonly range: readonly number[];
}

function combosOf(hand: string): [number, number, number] {
  const c1 = parseCard(hand.slice(0, 2)), c2 = parseCard(hand.slice(2, 4));
  return [c1, c2, classOfCards(c1, c2)];
}

/** Steps 1–3: flop-weighted ratio-estimator sums per class and per bucket. */
export function measureLibrary(samples: readonly RealizationSample[]): Record<RealizationPosition, PositionMeasurement> {
  const comboWeights = new Map<string, Record<TextureStratum, number>>();
  const stratumOf = (c1: number, c2: number) => {
    const key = `${c1},${c2}`;
    let w = comboWeights.get(key);
    if (!w) { w = comboStratumWeights(c1, c2); comboWeights.set(key, w); }
    return w;
  };
  const out = {} as Record<RealizationPosition, PositionMeasurement>;
  for (const position of ["ip", "oop"] as const) {
    // Which flops each combo appears on, to renormalize its stratum weights.
    const appearances = new Map<string, TextureStratum[]>();
    const rangeWeight = new Map<string, number>();
    for (const sample of samples) {
      const p = sample.perCombo[position];
      p.hands.forEach((hand, i) => {
        const list = appearances.get(hand) ?? [];
        list.push(sample.spotId);
        appearances.set(hand, list);
        const previous = rangeWeight.get(hand);
        if (previous !== undefined && previous !== p.weight[i]) throw new Error(`${hand}: range weight differs between flops`);
        rangeWeight.set(hand, p.weight[i]);
      });
    }
    // Per class and bucket, per flop: Σ w r, Σ w r s, Σ w r e.
    const zero = () => TEXTURE_STRATA.map(() => [0, 0, 0]);
    const perClass = Array.from({ length: NUM_CLASSES }, zero);
    const perBucket = Object.fromEntries(HAND_BUCKETS.map(b => [b, zero()])) as Record<HandBucket, number[][]>;
    samples.forEach(sample => {
      const f = TEXTURE_STRATA.indexOf(sample.spotId), pot = sample.startingPot;
      const p = sample.perCombo[position];
      p.hands.forEach((hand, i) => {
        const [c1, c2, cls] = combosOf(hand);
        const own = stratumOf(c1, c2);
        const available = appearances.get(hand)!;
        let norm = 0;
        for (const s of available) norm += own[s];
        const w = own[sample.spotId] / norm;
        const r = p.normalizedWeight[i];
        if (r <= 0) return;
        const share = (p.rootEv[i] + pot / 2) / pot, eq = p.rootEquity[i];
        for (const acc of [perClass[cls][f], perBucket[CLASS_BUCKETS[cls]][f]]) {
          acc[0] += w * r; acc[1] += w * r * share; acc[2] += w * r * eq;
        }
      });
    });
    const summarize = (byFlop: number[][]): ClassMeasurement => {
      let m = 0, s = 0, e = 0, sq = 0;
      for (const [mf, sf, ef] of byFlop) { m += mf; s += sf; e += ef; sq += mf * mf; }
      return m > 0 ? { mass: m, share: s / m, equity: e / m, kish: (m * m) / sq } : { mass: 0, share: 0, equity: 0, kish: 0 };
    };
    const range = new Array<number>(NUM_CLASSES).fill(0);
    for (const [hand, weight] of rangeWeight) range[combosOf(hand)[2]] += weight;
    for (let c = 0; c < NUM_CLASSES; c++) range[c] /= HANDS[c].weight;
    out[position] = {
      classes: perClass.map(summarize),
      buckets: Object.fromEntries(HAND_BUCKETS.map(b => [b, summarize(perBucket[b])])) as Record<HandBucket, ClassMeasurement>,
      range,
    };
  }
  return out;
}

/** Exact matrix equity of class c vs a class-level range (card-removal weighted). */
export function matrixEquityVsRange(c: number, range: readonly number[]): number {
  let num = 0, den = 0;
  for (let k = 0; k < NUM_CLASSES; k++) {
    const w = DISJOINT[c][k] * range[k];
    num += w * EQ[c][k]; den += w;
  }
  return den > 0 ? num / den : 0.5;
}

/** SRP model share of class c for `position` vs the opponent's class range, under R tables (ip, oop). */
export function modelShare(position: RealizationPosition, c: number, opponentRange: readonly number[], rIp: readonly number[], rOop: readonly number[]): number {
  let num = 0, den = 0;
  for (let k = 0; k < NUM_CLASSES; k++) {
    const w = DISJOINT[c][k] * opponentRange[k];
    if (w === 0) continue;
    const s = position === "ip" ? flopShareIp(EQ[c][k], rIp[c], rOop[k]) : 1 - flopShareIp(EQ[k][c], rIp[k], rOop[c]);
    num += w * s; den += w;
  }
  return den > 0 ? num / den : 0.5;
}

export type CellSource = "measured" | "bucket" | "default";

export interface ClassFitRow {
  readonly hand: string;
  readonly bucket: HandBucket;
  readonly source: CellSource;
  readonly libraryRange: number;
  readonly measuredShare: number | null;
  readonly measuredEquity: number | null;
  readonly matrixEquity: number;
  readonly ratio: number | null;
  readonly kish: number;
  readonly shrunk: number;
  /** R̃ · E_mat before the conservation shift. */
  readonly baseTargetShare: number;
  /** Effective target: base + δ, or the achieved share when pinned at a clamp. */
  readonly targetShare: number;
  readonly fitted: number;
  readonly modelShare: number;
  readonly clamped: boolean;
  readonly pinned: boolean;
}

export interface RealizationFit {
  readonly table: RealizationTableV1;
  readonly options: FitOptions;
  readonly steps: number;
  /** Max |model − effective target| share over unpinned classes, both positions. */
  readonly maxShareError: number;
  readonly converged: boolean;
  readonly rows: Readonly<Record<RealizationPosition, readonly ClassFitRow[]>>;
  readonly buckets: Readonly<Record<RealizationPosition, Readonly<Record<HandBucket, { ratio: number | null; kish: number; source: CellSource }>>>>;
  readonly clamps: readonly string[];
  /** Library-range-weighted mean R that fixes the fit's free scale. */
  readonly anchor: number;
  /** δ added to every target share so the targets conserve the pot (see fitRealization). */
  readonly conservationShift: number;
}

/** Steps 4–6 from class measurements. `defaults` supplies SRP fallbacks and the 3BP/4BP cells. */
export function fitRealization(
  measurement: Record<RealizationPosition, PositionMeasurement>,
  options: FitOptions = DEFAULT_FIT_OPTIONS,
  source = PF3_REALIZATION_SOURCE,
  defaults: { readonly ip: Readonly<Record<PotType, number>>; readonly oop: Readonly<Record<PotType, number>> } = REALIZATION_DEFAULTS,
): RealizationFit {
  const [lo, hi] = options.clamp;
  const clampR = (r: number) => Math.min(hi, Math.max(lo, r));
  const opponent = (p: RealizationPosition): RealizationPosition => (p === "ip" ? "oop" : "ip");
  const shrunk = {} as Record<RealizationPosition, number[]>;
  const sources = {} as Record<RealizationPosition, CellSource[]>;
  const bucketInfo = {} as Record<RealizationPosition, Record<HandBucket, { ratio: number | null; kish: number; source: CellSource }>>;
  const targets = {} as Record<RealizationPosition, number[]>;
  for (const p of ["ip", "oop"] as const) {
    const m = measurement[p];
    bucketInfo[p] = Object.fromEntries(HAND_BUCKETS.map(b => {
      const bm = m.buckets[b];
      return [b, bm.mass > 0 ? { ratio: bm.share / bm.equity, kish: bm.kish, source: "measured" as CellSource } : { ratio: null, kish: 0, source: "default" as CellSource }];
    })) as Record<HandBucket, { ratio: number | null; kish: number; source: CellSource }>;
    shrunk[p] = []; sources[p] = []; targets[p] = [];
    for (let c = 0; c < NUM_CLASSES; c++) {
      const cm = m.classes[c], bucket = bucketInfo[p][CLASS_BUCKETS[c]];
      const bucketR = bucket.ratio ?? defaults[p].srp;
      let r: number, src: CellSource;
      if (cm.mass > 0) { r = (cm.kish * (cm.share / cm.equity) + options.kappa * bucketR) / (cm.kish + options.kappa); src = "measured"; }
      else { r = bucketR; src = bucket.ratio === null ? "default" : "bucket"; }
      shrunk[p].push(r); sources[p].push(src);
      targets[p].push(r * matrixEquityVsRange(c, measurement[opponent(p)].range));
    }
  }
  // Pot conservation: in the model every matchup's two shares sum to 1, so the joint-mass-weighted
  // targets must too. Luck correction (Ē → E_mat), shrinkage and per-combo flop weights break that
  // slightly, and some targets are infeasible (premium pairs realize more than the whole starting
  // pot postflop, share > 1, which the bounded form a/(a+b) cannot represent). Each step therefore
  // (1) pins classes whose R sits at a clamp and still wants to move past it, their effective
  // target becoming the share they achieve; (2) shifts every unpinned target by one δ so the
  // effective targets conserve the pot. δ and every clamp are reported.
  const ipMass = new Array<number>(NUM_CLASSES).fill(0), oopMass = new Array<number>(NUM_CLASSES).fill(0);
  let total = 0;
  for (let c = 0; c < NUM_CLASSES; c++) for (let k = 0; k < NUM_CLASSES; k++) {
    const w = DISJOINT[c][k] * measurement.ip.range[c] * measurement.oop.range[k];
    ipMass[c] += w; oopMass[k] += w; total += w;
  }
  const jointMass = { ip: ipMass, oop: oopMass };
  const fitted = { ip: shrunk.ip.map(clampR), oop: shrunk.oop.map(clampR) };
  const shareOf = (p: RealizationPosition, c: number) => modelShare(p, c, measurement[opponent(p)].range, fitted.ip, fitted.oop);
  // The terminal share a/(a+b) is unchanged when every R is multiplied by one constant, so the
  // fit only identifies R up to scale. Each step is rescaled so the library-range-weighted mean
  // R equals that of the shrunk estimates (anchor), which pins the level without moving any share.
  const rangeMass = (p: RealizationPosition, c: number) => measurement[p].range[c] * HANDS[c].weight;
  const weightedMean = (table: Record<RealizationPosition, readonly number[]>) => {
    let num = 0, den = 0;
    for (const p of ["ip", "oop"] as const) for (let c = 0; c < NUM_CLASSES; c++) { num += rangeMass(p, c) * table[p][c]; den += rangeMass(p, c); }
    return num / den;
  };
  const anchor = weightedMean(shrunk);
  let delta = 0;
  const effective = { ip: [...targets.ip], oop: [...targets.oop] };
  const pinned = { ip: new Array<boolean>(NUM_CLASSES).fill(false), oop: new Array<boolean>(NUM_CLASSES).fill(false) };
  const shares = { ip: new Array<number>(NUM_CLASSES).fill(0), oop: new Array<number>(NUM_CLASSES).fill(0) };
  /** Recompute shares, pins, δ and effective targets; return the max error over unpinned classes. */
  const evaluate = () => {
    let pinnedShareMass = 0, freeTargetMass = 0, freeMass = 0;
    for (const p of ["ip", "oop"] as const) for (let c = 0; c < NUM_CLASSES; c++) {
      const share = shares[p][c] = shareOf(p, c), want = targets[p][c] + delta, r = fitted[p][c];
      pinned[p][c] = (r >= hi && share < want) || (r <= lo && share > want);
      if (pinned[p][c]) pinnedShareMass += jointMass[p][c] * share;
      else { freeTargetMass += jointMass[p][c] * targets[p][c]; freeMass += jointMass[p][c]; }
    }
    delta = options.conservePot && freeMass > 0 ? (total - pinnedShareMass - freeTargetMass) / freeMass : 0;
    let error = 0;
    for (const p of ["ip", "oop"] as const) for (let c = 0; c < NUM_CLASSES; c++) {
      effective[p][c] = pinned[p][c] ? shares[p][c] : targets[p][c] + delta;
      if (!pinned[p][c]) error = Math.max(error, Math.abs(shares[p][c] - effective[p][c]));
    }
    return error;
  };
  let steps = 0;
  let maxError = evaluate();
  while (maxError >= options.tolerance && steps < options.maxSteps) {
    const next = { ip: [...fitted.ip], oop: [...fitted.oop] };
    for (const p of ["ip", "oop"] as const) for (let c = 0; c < NUM_CLASSES; c++) {
      // Pinned classes stay exactly at their bound whatever the rescale.
      next[p][c] = pinned[p][c] ? (fitted[p][c] >= hi ? Infinity : 0) : fitted[p][c] * effective[p][c] / shares[p][c];
    }
    // Scale s with weightedMean(clamp(next · s)) = anchor (monotone in s: bisection in log space),
    // so classes stuck at a clamp do not push the level of the others.
    const clampedMean = (scale: number) => weightedMean({ ip: next.ip.map(r => clampR(r * scale)), oop: next.oop.map(r => clampR(r * scale)) });
    let lower = Math.log(1e-3), upper = Math.log(1e3);
    for (let i = 0; i < 80; i++) {
      const mid = (lower + upper) / 2;
      if (clampedMean(Math.exp(mid)) < anchor) lower = mid; else upper = mid;
    }
    const scale = Math.exp((lower + upper) / 2);
    fitted.ip = next.ip.map(r => clampR(r * scale)); fitted.oop = next.oop.map(r => clampR(r * scale));
    steps += 1;
    maxError = evaluate();
  }
  const conservationShift = delta;
  const clamps: string[] = [];
  const rows = {} as Record<RealizationPosition, ClassFitRow[]>;
  for (const p of ["ip", "oop"] as const) {
    const m = measurement[p];
    rows[p] = HANDS.map((hand, c) => {
      const cm = m.classes[c], s = shares[p][c], clamped = fitted[p][c] >= hi || fitted[p][c] <= lo;
      if (clamped) clamps.push(`${p} ${hand.label}: R = ${fitted[p][c]}${pinned[p][c] ? " (pinned)" : ""}, target share ${(targets[p][c] + delta).toFixed(4)}, model ${s.toFixed(4)}`);
      return {
        hand: hand.label, bucket: CLASS_BUCKETS[c], source: sources[p][c], libraryRange: m.range[c],
        measuredShare: cm.mass > 0 ? cm.share : null, measuredEquity: cm.mass > 0 ? cm.equity : null,
        matrixEquity: matrixEquityVsRange(c, measurement[opponent(p)].range),
        ratio: cm.mass > 0 ? cm.share / cm.equity : null, kish: cm.kish, shrunk: shrunk[p][c],
        baseTargetShare: targets[p][c], targetShare: effective[p][c], fitted: fitted[p][c], modelShare: s, clamped, pinned: pinned[p][c],
      };
    });
  }
  const table = validateRealizationTable({
    format: PREFLOP_REALIZATION_FORMAT, version: 1, source,
    ip: { srp: fitted.ip, "3bp": new Array(NUM_CLASSES).fill(defaults.ip["3bp"]), "4bp": new Array(NUM_CLASSES).fill(defaults.ip["4bp"]) },
    oop: { srp: fitted.oop, "3bp": new Array(NUM_CLASSES).fill(defaults.oop["3bp"]), "4bp": new Array(NUM_CLASSES).fill(defaults.oop["4bp"]) },
  });
  return { table, options, steps, maxShareError: maxError, converged: maxError < options.tolerance, rows, buckets: bucketInfo, clamps, anchor, conservationShift };
}
