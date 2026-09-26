/**
 * B4 bridge spot library: types and limits (browser-safe).
 *
 * One manifest lists every published spot; each spot's data is split into hash-bound chunks
 * (flop, one per sliced turn card, one per sliced river board) that the app fetches lazily,
 * following the saved flop library pattern (`/solver/flop`). Numbers are quantized integers:
 *
 * - reach: range weight × own action probabilities along the line, relative to the node's
 *   largest reach for that player (`reachMax`, stored at full precision) in units of 1e-4
 *   (REACH_SCALE): reach = int / REACH_SCALE × reachMax. Relative units keep thin lines
 *   (a rare turn lead) as sharp as main lines. Hands whose relative reach rounds to 0 are
 *   omitted; their total mass is kept in `omittedReach` so nothing disappears silently.
 * - strategy: per mille (STRATEGY_SCALE); each hand's column sums to exactly 1000.
 * - ev, actionEv: "from-now" EV in deci-chips (EV_SCALE; 1 bb = 100 chips, so 0.001 bb):
 *   chips won back from the pot minus chips still to be paid, sunk chips excluded, fold = 0.
 * - equity: all-in equity against the opponent's reach at this node, per mille.
 */
export const BRIDGE_LIBRARY_FORMAT = "poker-face-bridge-library";
export const BRIDGE_LIBRARY_CHUNK_FORMAT = "poker-face-bridge-library-chunk";
export const BRIDGE_LIBRARY_ROOT_FORMAT = "poker-face-bridge-library-root";
export const BRIDGE_LIBRARY_VERSION = 1;
export const BRIDGE_LIBRARY_DIR = "bridge-v1";
export const BRIDGE_LIBRARY_URL_PREFIX = `/solver-data/${BRIDGE_LIBRARY_DIR}/`;

export const REACH_SCALE = 10_000;
export const STRATEGY_SCALE = 1000;
export const EV_SCALE = 10;
export const EQUITY_SCALE = 1000;

/** Per fetched file (raw bytes); the manifest itself has the same cap. */
export const BRIDGE_LIBRARY_FILE_BYTES = 1024 * 1024;
export const BRIDGE_LIBRARY_MAX_NODES_PER_CHUNK = 200;
/** Shipped-size budget for the whole library (gzip, measured by the generator). */
export const BRIDGE_LIBRARY_GZIP_BUDGET_BYTES = 40 * 1024 * 1024;
/** Publication gate: postflop-solver's exploitability ≤ this % of the starting pot. */
export const BRIDGE_LIBRARY_GATE_PCT_POT = 0.3;

export interface BridgeLibraryFileRef {
  readonly url: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface BridgeLibraryChunkRef extends BridgeLibraryFileRef {
  readonly nodes: number;
}

export interface BridgeLibrarySpot {
  readonly id: string;
  readonly flop: readonly [string, string, string];
  readonly texture: string;
  readonly spotHash: string;
  readonly slicePlanHash: string;
  /** The canonical contract-v1 spot (ranges, tree, solve options); its sha256 is spotHash. */
  readonly spot: BridgeLibraryFileRef;
  /** Full-precision flop-root values per combo (not needed by the UI; see BridgeLibraryRoot). */
  readonly root: BridgeLibraryFileRef;
  readonly descriptor: {
    readonly suitPattern: "rainbow" | "two-tone" | "monotone";
    readonly pairing: "unpaired" | "paired" | "trips";
    readonly ranks: readonly [string, string, string];
    readonly highRank: string;
    readonly broadwayCards: number;
    readonly gaps: readonly [number, number];
    readonly straightPossible: boolean;
  };
  readonly engine: { readonly precision: "float32" | "int16-compressed"; readonly threads: number };
  readonly iterations: number;
  readonly exploitability: { readonly chips: number; readonly pctPot: number };
  readonly value: readonly [number, number];
  readonly solveMs: number;
  readonly peakRssBytes: number;
  readonly turnCards: readonly string[];
  readonly riverBoards: readonly (readonly [string, string])[];
  /** Chunk keys: "flop", "turn-<card>", "river-<turn><river>-<flop line>" (see chunkKeyForNode). */
  readonly chunks: Readonly<Record<string, BridgeLibraryChunkRef>>;
}

export interface BridgeLibraryManifest {
  readonly format: typeof BRIDGE_LIBRARY_FORMAT;
  readonly version: 1;
  readonly title: string;
  readonly formation: {
    readonly name: string;
    readonly players: readonly [string, string];
    readonly startingPot: number;
    readonly effectiveStack: number;
    readonly chipsPerBigBlind: number;
  };
  readonly provenance: {
    readonly ranges: string;
    readonly tree: string;
    readonly engine: { readonly name: string; readonly repository: string; readonly commit: string; readonly license: string };
    readonly label: string;
  };
  readonly slicePolicy: {
    readonly summary: string;
    readonly flop: string;
    readonly turn: string;
    readonly river: string;
    readonly omittedReach: string;
  };
  readonly quantization: { readonly reach: number; readonly strategy: number; readonly ev: number; readonly equity: number };
  readonly gatePctPot: number;
  readonly spots: readonly BridgeLibrarySpot[];
  /** One exported river subgame kept at full precision so audits can re-grade it with our grader. */
  readonly refereeSample: BridgeLibraryFileRef & { readonly spotId: string; readonly path: readonly string[];
    readonly grade: { readonly exploitability: number; readonly value0: number; readonly theirValue0: number } };
  readonly totals: { readonly files: number; readonly rawBytes: number; readonly gzipBytes: number };
}

export interface BridgeLibraryNode {
  /** Space-separated tokens from the flop root: x c f b<to> r<to> and card names. */
  readonly path: string;
  readonly street: "flop" | "turn" | "river";
  readonly board: readonly string[];
  readonly player: 0 | 1;
  /** Chips each player has put in since the flop (excluding the starting pot). */
  readonly committed: readonly [number, number];
  /** Action tokens in engine order (same tokens as paths). */
  readonly actions: readonly string[];
  /** Hand indices (into the spot's range lists) with reach ≥ 0.5e-4 × reachMax, per player. */
  readonly live: readonly [readonly number[], readonly number[]];
  /** Largest reach per player at this node (absolute, 6 significant digits). */
  readonly reachMax: readonly [number, number];
  /** Total reach of live-on-board hands left out because they round to 0. */
  readonly omittedReach: readonly [number, number];
  readonly reach: readonly [readonly number[], readonly number[]];
  readonly ev: readonly [readonly (number | null)[], readonly (number | null)[]];
  readonly equity: readonly [readonly (number | null)[], readonly (number | null)[]];
  /** strategy[a][i] for live[player][i], per mille. */
  readonly strategy: readonly (readonly number[])[];
  readonly actionEv: readonly (readonly (number | null)[])[];
}

export interface BridgeLibraryChunk {
  readonly format: typeof BRIDGE_LIBRARY_CHUNK_FORMAT;
  readonly version: 1;
  readonly spotId: string;
  readonly spotHash: string;
  readonly key: string;
  readonly nodes: readonly BridgeLibraryNode[];
}

/**
 * Per-spot flop-root export at postflop-solver's full float32 precision (unquantized), for
 * consumers such as the preflop solver's realization estimate. Rows follow the spot's combo order.
 */
export interface BridgeLibraryRoot {
  readonly format: typeof BRIDGE_LIBRARY_ROOT_FORMAT;
  readonly version: 1;
  readonly spotId: string;
  readonly spotHash: string;
  /** sha256 of the canonical JSON of the spot's two ranges (sources and weighted combos). */
  readonly rangesHash: string;
  readonly potType: "srp";
  readonly startingPot: number;
  readonly effectiveStack: number;
  readonly exploitabilityPctPot: number;
  readonly flop: BridgeLibrarySpot["descriptor"] & { readonly cards: readonly [string, string, string]; readonly texture: string };
  readonly players: readonly [BridgeLibraryRootPlayer, BridgeLibraryRootPlayer];
}

export interface BridgeLibraryRootPlayer {
  readonly role: string;
  readonly rangeSource: string;
  readonly hands: readonly string[];
  /** Range weight at the flop root (the spot's input weight). */
  readonly weight: readonly number[];
  /** postflop-solver normalized weight: weight × blocker-compatible opponent weight. */
  readonly normalizedWeight: readonly number[];
  /** Net EV in chips relative to the start of the flop, excluding the starting pot (bridge root.ev). */
  readonly rootEv: readonly number[];
  /** All-in equity against the opponent's flop-root range. */
  readonly rootEquity: readonly number[];
}

/** Spot-level range data the app needs to read chunk rows (from the spot file). */
export interface BridgeLibraryRanges {
  readonly hands: readonly [readonly string[], readonly string[]];
  readonly weights: readonly [readonly number[], readonly number[]];
}

/**
 * Chunk holding a node: "flop"; "turn-<turn>"; river nodes are split by flop line so each file
 * stays under the 1 MiB cap: "river-<turn><river>-<flop tokens joined by '.'>", e.g.
 * "river-Qh2c-x.b363.c".
 */
export function chunkKeyForNode(node: Pick<BridgeLibraryNode, "street" | "board" | "path">): string {
  if (node.street === "flop") return "flop";
  if (node.street === "turn") return `turn-${node.board[3]}`;
  const tokens = node.path.split(" "), turn = tokens.indexOf(node.board[3]);
  return `river-${node.board[3]}${node.board[4]}-${tokens.slice(0, turn).join(".")}`;
}

/** Chunk keys of one river board, as `river-<turn><river>-` prefix. */
export const riverChunkPrefix = (turn: string, river: string) => `river-${turn}${river}-`;
