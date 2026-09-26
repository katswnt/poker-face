/**
 * B5 / W0: the admission rule for live (in-browser, wasm32) postflop-solver solves, and the
 * pure half of the thread-mode choice. See tasks/postflop-solver-wasm-spec.md, "Admission rule".
 *
 * Nothing here touches the DOM, `navigator` or WebAssembly: the worker gathers the flags
 * (crossOriginIsolated, SharedArrayBuffer, deviceMemory, …) and passes them in, so every rule
 * is unit-testable in Node.
 *
 * Rule: let E = postflop-solver `memory_usage()` for a precision, X = export bytes, F = fixed
 * overhead. Admit iff E + X + F ≤ B, where B is the smallest applicable budget. Try float32
 * first; int16-compressed only if float32 does not fit (and flag it: B2 measured int16 root-EV
 * error up to 8.7e-4 chips, outside the locked τ = 2e-4). Otherwise refuse, before anything
 * is allocated, with the numbers.
 */

const KIB = 1024;
const MIB = 1024 * KIB;
const GIB = 1024 * MIB;

/**
 * The `solver-bridge estimate <spot.json>` stdout line (native/solver-bridge/src/lib.rs
 * `estimate_spot`). `estimateExport` is the W0 addition to the CLI (strategy cells and public
 * nodes of the export a dry walk would write); until the CLI emits it, callers pass the export
 * size explicitly, and without either the spot is refused.
 */
export interface BridgeEstimateV1 {
  readonly type: "estimate";
  readonly spotId: string;
  readonly spotHash: string;
  /** float32 storage, `memory_usage().0`. */
  readonly estimatedBytes: number;
  /** int16-compressed storage, `memory_usage().1`. */
  readonly estimatedCompressedBytes: number;
  readonly hands: readonly [number, number];
  readonly memoryCapBytes: number;
  readonly estimateExport?: { readonly cells: number; readonly nodes: number };
}

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Strictly parse an `estimate` line (string or already-parsed JSON). Throws on anything else. */
export function parseBridgeEstimate(input: unknown): BridgeEstimateV1 {
  const value: unknown = typeof input === "string" ? JSON.parse(input) : input;
  if (typeof value !== "object" || value === null) throw new Error("estimate: not an object");
  const v = value as Record<string, unknown>;
  if (v.type !== "estimate") throw new Error("estimate: type must be \"estimate\"");
  if (typeof v.spotId !== "string" || typeof v.spotHash !== "string") throw new Error("estimate: spotId/spotHash must be strings");
  for (const key of ["estimatedBytes", "estimatedCompressedBytes", "memoryCapBytes"] as const) {
    if (!isCount(v[key])) throw new Error(`estimate: ${key} must be a non-negative safe integer`);
  }
  const hands = v.hands;
  if (!Array.isArray(hands) || hands.length !== 2 || !hands.every(isCount)) throw new Error("estimate: hands must be [n, n]");
  let estimateExport: BridgeEstimateV1["estimateExport"];
  if (v.estimateExport !== undefined) {
    const e = v.estimateExport as Record<string, unknown> | null;
    if (typeof e !== "object" || e === null || !isCount(e.cells) || !isCount(e.nodes)) {
      throw new Error("estimate: estimateExport must be {cells, nodes} counts");
    }
    estimateExport = { cells: e.cells, nodes: e.nodes };
  }
  return {
    type: "estimate", spotId: v.spotId, spotHash: v.spotHash,
    estimatedBytes: v.estimatedBytes as number, estimatedCompressedBytes: v.estimatedCompressedBytes as number,
    hands: [hands[0], hands[1]], memoryCapBytes: v.memoryCapBytes as number,
    ...(estimateExport ? { estimateExport } : {}),
  };
}

/**
 * Constants of the rule. Values marked (measure) are the spec's placeholders; W2 replaces them.
 */
export const WASM_ADMISSION = Object.freeze({
  /** 4 GiB max linear memory (`--max-memory=4294967296`) minus 0.5 GiB headroom. */
  wasm32CeilingBytes: 3.5 * GIB,
  /** Module, tree, hand tables, allocator slack, MT stacks and TLS. (measure; spec starts at 128 MiB) */
  fixedOverheadBytes: 128 * MIB,
  /** Export JSON ≈ 12 B per strategy cell + 200 B per node. (measure) */
  exportJsonBytesPerCell: 12,
  exportJsonBytesPerNode: 200,
  /** Rust export structs and serialized JSON coexist in linear memory: X ≈ 2 × JSON. */
  exportResidencyFactor: 2,
  /** `navigator.deviceMemory` (GiB, Chromium, capped at 8) lowers B to deviceMemory / 4. */
  deviceMemoryShare: 1 / 4,
  /** Linear memory never shrinks: a solve above this gets a fresh worker. */
  freshWorkerAboveBytes: 256 * MIB,
  /** MT pool size cap: min(hardwareConcurrency, 8). */
  maxThreads: 8,
});

export type WasmDeviceProfile = "desktop-chromium" | "desktop-firefox" | "desktop-safari" | "mobile" | "unknown";

/** Per-profile budget and its basis (spec table). The wasm32 ceiling always applies on top. */
export const WASM_PROFILE_BUDGETS: Readonly<Record<WasmDeviceProfile, { readonly bytes: number; readonly basis: string }>> =
  Object.freeze({
    "desktop-chromium": { bytes: 3.5 * GIB, basis: "desktop Chromium (V8 allows 4 GiB of wasm memory, less 0.5 GiB headroom)" },
    "desktop-firefox": { bytes: 3.5 * GIB, basis: "desktop Firefox (4 GiB wasm memory, less 0.5 GiB headroom)" },
    "desktop-safari": { bytes: 2 * GIB, basis: "desktop Safari (unmeasured; WebKit reserves shared memory process-wide)" },
    mobile: { bytes: 512 * MIB, basis: "mobile browser (tabs reload well below the wasm32 limit, especially on iOS)" },
    unknown: { bytes: 512 * MIB, basis: "unrecognised device (treated as mobile, the strictest budget)" },
  });

export interface WasmEnvironment {
  readonly profile: WasmDeviceProfile;
  /** `navigator.deviceMemory` in GiB, if the browser exposes it. */
  readonly deviceMemoryGiB?: number;
}

export interface WasmBudget {
  readonly bytes: number;
  readonly basis: string;
}

/** The smallest applicable budget B for an environment. */
export function wasmBudget(env: WasmEnvironment): WasmBudget {
  const candidates: WasmBudget[] = [
    { bytes: WASM_ADMISSION.wasm32CeilingBytes, basis: "the wasm32 ceiling (4 GiB linear memory less 0.5 GiB headroom)" },
    WASM_PROFILE_BUDGETS[env.profile] ?? WASM_PROFILE_BUDGETS.unknown,
  ];
  const dm = env.deviceMemoryGiB;
  if (dm !== undefined) {
    // An unusable value is treated as the smallest the API reports (0.25 GiB), not ignored.
    const gib = Number.isFinite(dm) && dm > 0 ? Math.min(dm, 8) : 0.25;
    candidates.push({ bytes: Math.floor(gib * GIB * WASM_ADMISSION.deviceMemoryShare), basis: `a quarter of this device's reported ${gib} GiB of memory` });
  }
  return candidates.reduce((min, c) => (c.bytes < min.bytes ? c : min));
}

/** X from the estimate's export counts: 2 × (12 B × cells + 200 B × nodes). */
export function exportBytesFromCounts(counts: { readonly cells: number; readonly nodes: number }): number {
  const json = WASM_ADMISSION.exportJsonBytesPerCell * counts.cells + WASM_ADMISSION.exportJsonBytesPerNode * counts.nodes;
  return WASM_ADMISSION.exportResidencyFactor * json;
}

export interface AdmissionOptions {
  /** Resident export bytes X, overriding `estimate.estimateExport`. */
  readonly exportBytes?: number;
  /** Fixed overhead F (default `WASM_ADMISSION.fixedOverheadBytes`). */
  readonly fixedOverheadBytes?: number;
  /** Allow int16-compressed storage when float32 does not fit (default true; spec open question 2). */
  readonly allowCompressed?: boolean;
}

export type LivePrecision = "float32" | "int16-compressed";

export interface AdmissionNumbers {
  readonly float32Bytes: number;
  readonly compressedBytes: number;
  readonly exportBytes: number;
  readonly fixedOverheadBytes: number;
  /** E + X + F for float32 and for int16. */
  readonly float32TotalBytes: number;
  readonly compressedTotalBytes: number;
}

export type LiveAdmission =
  | {
    readonly ok: true;
    readonly precision: LivePrecision;
    /** int16 answers are outside the locked float32 tolerance τ. */
    readonly outsideTolerance: boolean;
    readonly budget: WasmBudget;
    readonly totalBytes: number;
    readonly headroomBytes: number;
    readonly numbers: AdmissionNumbers;
    readonly reason: string;
  }
  | {
    readonly ok: false;
    readonly precision: null;
    readonly budget: WasmBudget;
    /** Smallest total that was considered, and how far over B it is (NaN if export unknown). */
    readonly overBytes: number;
    readonly numbers: AdmissionNumbers | null;
    readonly reason: string;
  };

/** Plain-language byte size in binary units, to match the GiB/MiB budgets. */
export function formatBytes(bytes: number): string {
  if (bytes >= GIB) return `${(bytes / GIB).toFixed(2)} GiB`;
  if (bytes >= MIB) return `${(bytes / MIB).toFixed(1)} MiB`;
  if (bytes >= KIB) return `${(bytes / KIB).toFixed(1)} KiB`;
  return `${bytes} B`;
}

const nonNegative = (value: number, name: string): number => {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a finite non-negative number`);
  return value;
};

/**
 * Decide whether a spot may be solved live in this environment, and at which precision.
 * Pure: the same inputs always give the same verdict. Refusals happen before allocation.
 */
export function admitLiveSpot(
  estimate: Pick<BridgeEstimateV1, "estimatedBytes" | "estimatedCompressedBytes" | "estimateExport">,
  env: WasmEnvironment,
  options: AdmissionOptions = {},
): LiveAdmission {
  const budget = wasmBudget(env);
  const B = budget.bytes;
  const where = `the ${formatBytes(B)} budget for ${budget.basis}`;
  const E32 = nonNegative(estimate.estimatedBytes, "estimatedBytes");
  const E16 = nonNegative(estimate.estimatedCompressedBytes, "estimatedCompressedBytes");
  const F = nonNegative(options.fixedOverheadBytes ?? WASM_ADMISSION.fixedOverheadBytes, "fixedOverheadBytes");
  const allowCompressed = options.allowCompressed ?? true;

  const X = options.exportBytes !== undefined
    ? nonNegative(options.exportBytes, "exportBytes")
    : estimate.estimateExport ? exportBytesFromCounts(estimate.estimateExport) : undefined;
  if (X === undefined) {
    return {
      ok: false, precision: null, budget, overBytes: Number.NaN, numbers: null,
      reason: "Not solved in the browser: the export size is unknown, so the solve could run out of memory while "
        + "writing its result. Re-run the estimate with export counts or pass the export size.",
    };
  }

  const numbers: AdmissionNumbers = {
    float32Bytes: E32, compressedBytes: E16, exportBytes: X, fixedOverheadBytes: F,
    float32TotalBytes: E32 + X + F, compressedTotalBytes: E16 + X + F,
  };
  const parts = (e: number, label: string) =>
    `${formatBytes(e)} ${label} storage + ${formatBytes(X)} export + ${formatBytes(F)} overhead = ${formatBytes(e + X + F)}`;

  if (numbers.float32TotalBytes <= B) {
    return {
      ok: true, precision: "float32", outsideTolerance: false, budget, numbers,
      totalBytes: numbers.float32TotalBytes, headroomBytes: B - numbers.float32TotalBytes,
      reason: `Solvable in the browser at full precision: ${parts(E32, "float32")}, within ${where}.`,
    };
  }
  if (allowCompressed && numbers.compressedTotalBytes <= B) {
    return {
      ok: true, precision: "int16-compressed", outsideTolerance: true, budget, numbers,
      totalBytes: numbers.compressedTotalBytes, headroomBytes: B - numbers.compressedTotalBytes,
      reason: `Solvable in the browser only with 16-bit compression: full precision needs ${formatBytes(numbers.float32TotalBytes)}, `
        + `over ${where}; compressed needs ${parts(E16, "int16")}. Compressed values are less exact than the checked tolerance.`,
    };
  }
  const smallest = allowCompressed ? Math.min(numbers.float32TotalBytes, numbers.compressedTotalBytes) : numbers.float32TotalBytes;
  const tried = allowCompressed
    ? `${parts(E32, "float32")}; compressed still needs ${formatBytes(numbers.compressedTotalBytes)}`
    : `${parts(E32, "float32")} (compression not allowed)`;
  return {
    ok: false, precision: null, budget, numbers, overBytes: smallest - B,
    reason: `Too large to solve in this browser: ${tried}, over ${where} by ${formatBytes(smallest - B)}. `
      + "Nothing was allocated.",
  };
}

/** Linear memory never shrinks, so a solve over 256 MiB of storage gets its own worker. */
export function needsFreshWorker(allocatedBytes: number): boolean {
  return allocatedBytes > WASM_ADMISSION.freshWorkerAboveBytes;
}

// ---------------------------------------------------------------------------------------
// Thread mode (pure half of feature detection).

export interface ThreadingFlags {
  /** `globalThis.crossOriginIsolated`. Fixed at document load: soft navigation does not isolate. */
  readonly crossOriginIsolated: boolean;
  /** `typeof SharedArrayBuffer === "function"`. */
  readonly sharedArrayBuffer: boolean;
  /** `navigator.hardwareConcurrency` (missing/invalid → 1). */
  readonly hardwareConcurrency?: number;
  /** false once the MT module failed to instantiate; undefined before trying. */
  readonly mtModuleInstantiated?: boolean;
  readonly profile: WasmDeviceProfile;
}

export interface ThreadingChoice {
  readonly mode: "mt" | "st";
  readonly threads: number;
  readonly reason: string;
}

/**
 * MT iff the page is cross-origin isolated, SharedArrayBuffer exists, the MT module did not
 * fail, and the profile is not one where MT is unproven (Safari, mobile, unknown: ST until W3).
 * Feature detection, not UA sniffing; the profile only narrows it.
 */
export function chooseThreading(flags: ThreadingFlags): ThreadingChoice {
  const st = (reason: string): ThreadingChoice => ({ mode: "st", threads: 1, reason });
  if (!flags.crossOriginIsolated) return st("single-threaded: the page is not cross-origin isolated");
  if (!flags.sharedArrayBuffer) return st("single-threaded: SharedArrayBuffer is unavailable");
  if (flags.mtModuleInstantiated === false) return st("single-threaded: the multithreaded module failed to start");
  if (flags.profile !== "desktop-chromium" && flags.profile !== "desktop-firefox") {
    return st(`single-threaded: multithreading is not yet verified on ${flags.profile}`);
  }
  const hc = flags.hardwareConcurrency;
  const cores = hc !== undefined && Number.isSafeInteger(hc) && hc >= 1 ? hc : 1;
  const threads = Math.min(cores, WASM_ADMISSION.maxThreads);
  if (threads < 2) return st("single-threaded: only one hardware thread reported");
  return { mode: "mt", threads, reason: `multithreaded: ${threads} threads (cross-origin isolated, SharedArrayBuffer available)` };
}

// ---------------------------------------------------------------------------------------
// Spot classes (spec "Which spot classes fit"), as data.
//
// Derivation: every storage number is postflop-solver `memory_usage()` from `solver-bridge
// estimate` (B1, B3) or upstream wasm-postflop's published benchmark; `null` = not measured
// yet (W0 grid, needs the native CLI). Decimal GB/MB figures are the spec's rounded values
// (1 GB = 1e9 B); the B3 lean row is exact bytes from artifacts/benchmark-b3.json. The
// expected verdicts assume X = 0, so "no" is definitive (even an empty export does not fit)
// and "yes" means "fits if the export fits in the remaining headroom". They are checked
// against `admitLiveSpot` in test/bridge-wasm-admission.test.ts.

export type SpotClassVerdict = LivePrecision | "refuse";

export interface WasmSpotClass {
  readonly id: string;
  readonly description: string;
  readonly example: string;
  readonly source: string;
  /** null = (measure). */
  readonly float32Bytes: number | null;
  readonly compressedBytes: number | null;
  /** Expected verdicts at X = 0, default F, compression allowed; null where storage is unmeasured. */
  readonly expected: { readonly desktop: SpotClassVerdict | null; readonly mobile: SpotClassVerdict | null };
}

export const WASM_SPOT_CLASSES: readonly WasmSpotClass[] = Object.freeze([
  {
    id: "river-full", description: "River, full ranges, ≤ 3 sizes + raise", example: "referee river 14×14; full-range river",
    source: "(measure)", float32Bytes: null, compressedBytes: null, expected: { desktop: null, mobile: null },
  },
  {
    id: "turn-upstream-basic", description: "Turn, 167×250 hands, 1–2 sizes (upstream basic)", example: "smoke-upstream-basic",
    source: "B1 estimate (rounded)", float32Bytes: 12.1e6, compressedBytes: 6.4e6,
    expected: { desktop: "float32", mobile: "float32" },
  },
  {
    id: "turn-full", description: "Turn, full ranges, 3 sizes + raise per street", example: "(measure)",
    source: "(measure); expected 10²–10³ MB", float32Bytes: null, compressedBytes: null, expected: { desktop: null, mobile: null },
  },
  {
    id: "flop-3bet-narrow", description: "Flop, 3-bet pot, narrow ranges, Pio \"FAST\" menu", example: "upstream wasm-postflop benchmark",
    source: "upstream README (rounded)", float32Bytes: 1.25e9, compressedBytes: 0.66e9,
    expected: { desktop: "float32", mobile: "refuse" },
  },
  {
    id: "flop-srp-lean-b3", description: "Flop, SRP 100bb, Griffin lean tree (B3 locked benchmark)",
    example: "benchmark-lean-srp-btn-bb-100bb-ks7h2d", source: "B3 estimate (exact)",
    float32Bytes: 5_995_858_864, compressedBytes: 3_045_718_494,
    expected: { desktop: "int16-compressed", mobile: "refuse" },
  },
  {
    id: "flop-srp-b1", description: "Flop, SRP 100bb, 3 sizes/street + raise (B1 locked benchmark)",
    example: "benchmark-srp-btn-bb-100bb-ks7h2d", source: "B1 estimate (rounded)", float32Bytes: 32.8e9, compressedBytes: 16.6e9,
    expected: { desktop: "refuse", mobile: "refuse" },
  },
  {
    id: "flop-srp-b1-allin-raises", description: "Same, all-in-only raises", example: "B1 trim table",
    source: "B1 estimate (rounded)", float32Bytes: 21.2e9, compressedBytes: 10.7e9,
    expected: { desktop: "refuse", mobile: "refuse" },
  },
]);
