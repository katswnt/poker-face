/**
 * Browser-safe validation and lazy loading of the bridge spot library. Every file is fetched
 * against its manifest entry (URL prefix, exact byte count, sha256) and schema-checked before
 * use; a missing, oversized, corrupted or mismatched file is refused, never substituted.
 */
import {
  BRIDGE_LIBRARY_CHUNK_FORMAT, BRIDGE_LIBRARY_FILE_BYTES, BRIDGE_LIBRARY_FORMAT, BRIDGE_LIBRARY_GATE_PCT_POT,
  BRIDGE_LIBRARY_MAX_NODES_PER_CHUNK, BRIDGE_LIBRARY_URL_PREFIX, EQUITY_SCALE, REACH_SCALE, STRATEGY_SCALE, chunkKeyForNode, riverChunkPrefix,
  type BridgeLibraryChunk, type BridgeLibraryFileRef, type BridgeLibraryManifest, type BridgeLibraryNode, type BridgeLibraryRanges,
  type BridgeLibrarySpot,
} from "./model";

export class BridgeLibraryError extends Error {}
const fail = (message: string): never => { throw new BridgeLibraryError(`Saved spot data is invalid: ${message}`); };
const object = (v: unknown, label: string): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : fail(`${label} must be an object`);
const array = (v: unknown, max: number, label: string): unknown[] =>
  Array.isArray(v) && v.length <= max ? v : fail(`${label} must be a list of at most ${max}`);
const int = (v: unknown, min: number, max: number, label: string): number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max ? v : fail(`${label} must be an integer in [${min}, ${max}]`);
const num = (v: unknown, min: number, max: number, label: string): number =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : fail(`${label} must be a number in [${min}, ${max}]`);
const text = (v: unknown, max: number, label: string): string =>
  typeof v === "string" && v.length > 0 && v.length <= max ? v : fail(`${label} must be text`);
const hash = (v: unknown, label: string) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v) ? v : fail(`${label} must be a sha256`);
const CARD = /^[2-9TJQKA][cdhs]$/;
const TOKEN = /^(?:x|c|f|[br][1-9][0-9]*|[2-9TJQKA][cdhs])$/;

export function validateLibraryRef(value: unknown, label: string, prefix = BRIDGE_LIBRARY_URL_PREFIX): BridgeLibraryFileRef {
  const ref = object(value, label);
  int(ref.bytes, 1, BRIDGE_LIBRARY_FILE_BYTES, `${label}.bytes`); hash(ref.sha256, `${label}.sha256`);
  const url = text(ref.url, 300, `${label}.url`);
  if (!url.startsWith(prefix) || !/^[a-zA-Z0-9/_.-]+$/.test(url) || url.includes("..")) fail(`${label}.url is outside ${prefix}`);
  return value as BridgeLibraryFileRef;
}

function validateSpotEntry(value: unknown, index: number): BridgeLibrarySpot {
  const label = `spots[${index}]`, spot = object(value, label);
  const id = text(spot.id, 80, `${label}.id`);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) fail(`${label}.id`);
  const flop = array(spot.flop, 3, `${label}.flop`);
  if (flop.length !== 3 || flop.some(c => typeof c !== "string" || !CARD.test(c)) || new Set(flop).size !== 3) fail(`${label}.flop`);
  text(spot.texture, 80, `${label}.texture`);
  const spotHash = hash(spot.spotHash, `${label}.spotHash`); hash(spot.slicePlanHash, `${label}.slicePlanHash`);
  const prefix = `${BRIDGE_LIBRARY_URL_PREFIX}${id}/${spotHash}/`;
  const spotRef = validateLibraryRef(spot.spot, `${label}.spot`, prefix);
  if (spotRef.url !== `${prefix}spot.json`) fail(`${label}.spot.url`);
  const rootRef = validateLibraryRef(spot.root, `${label}.root`, prefix);
  if (rootRef.url !== `${prefix}root.json`) fail(`${label}.root.url`);
  const descriptor = object(spot.descriptor, `${label}.descriptor`);
  if (!["rainbow", "two-tone", "monotone"].includes(descriptor.suitPattern as string)
    || !["unpaired", "paired", "trips"].includes(descriptor.pairing as string) || typeof descriptor.straightPossible !== "boolean") fail(`${label}.descriptor`);
  const engine = object(spot.engine, `${label}.engine`);
  if (engine.precision !== "float32" && engine.precision !== "int16-compressed") fail(`${label}.engine.precision`);
  int(engine.threads, 1, 1024, `${label}.engine.threads`);
  int(spot.iterations, 1, 1_000_000, `${label}.iterations`);
  const exploitability = object(spot.exploitability, `${label}.exploitability`);
  num(exploitability.chips, 0, 1e6, `${label}.exploitability.chips`);
  num(exploitability.pctPot, 0, BRIDGE_LIBRARY_GATE_PCT_POT, `${label}.exploitability.pctPot (publication gate)`);
  const valueRow = array(spot.value, 2, `${label}.value`);
  if (valueRow.length !== 2) fail(`${label}.value`);
  valueRow.forEach((v, p) => num(v, -1e6, 1e6, `${label}.value[${p}]`));
  int(spot.solveMs, 0, 1e9, `${label}.solveMs`); int(spot.peakRssBytes, 0, 2 ** 45, `${label}.peakRssBytes`);
  const turns = array(spot.turnCards, 49, `${label}.turnCards`) as string[];
  if (turns.some(c => !CARD.test(c) || flop.includes(c)) || new Set(turns).size !== turns.length) fail(`${label}.turnCards`);
  const rivers = array(spot.riverBoards, 2352, `${label}.riverBoards`) as string[][];
  if (rivers.some(b => !Array.isArray(b) || b.length !== 2 || !turns.includes(b[0]) || !CARD.test(b[1]) || flop.includes(b[1]) || b[0] === b[1])) fail(`${label}.riverBoards`);
  const chunks = object(spot.chunks, `${label}.chunks`), keys = Object.keys(chunks);
  const fixed = ["flop", ...turns.map(t => `turn-${t}`)];
  const riverKey = /^river-([2-9TJQKA][cdhs])([2-9TJQKA][cdhs])-((?:x|c|f|[br][1-9][0-9]*)(?:\.(?:x|c|f|[br][1-9][0-9]*))*)$/;
  for (const key of fixed) if (!keys.includes(key)) fail(`${label}.chunks is missing ${key}`);
  for (const key of keys) {
    if (fixed.includes(key)) continue;
    const match = riverKey.exec(key);
    if (!match || !rivers.some(b => b[0] === match[1] && b[1] === match[2])) fail(`${label}.chunks has unexpected key ${key}`);
  }
  for (const b of rivers) if (!keys.some(k => k.startsWith(riverChunkPrefix(b[0], b[1])))) fail(`${label}.chunks has no river chunk for ${b[0]}${b[1]}`);
  for (const key of keys) {
    const ref = validateLibraryRef(chunks[key], `${label}.chunks.${key}`, prefix);
    if (ref.url !== `${prefix}${key}.json`) fail(`${label}.chunks.${key}.url`);
    int((chunks[key] as { nodes?: unknown }).nodes, 1, BRIDGE_LIBRARY_MAX_NODES_PER_CHUNK, `${label}.chunks.${key}.nodes`);
  }
  return value as BridgeLibrarySpot;
}

export function validateLibraryManifest(input: unknown): BridgeLibraryManifest {
  const value = object(input, "manifest");
  if (value.format !== BRIDGE_LIBRARY_FORMAT || value.version !== 1) fail("unsupported manifest format");
  text(value.title, 200, "title");
  const provenance = object(value.provenance, "provenance");
  if (!/hand-written approximations, not solved/.test(text(provenance.ranges, 1000, "provenance.ranges"))) fail("ranges must be labelled as hand-written approximations");
  const engine = object(provenance.engine, "provenance.engine");
  if (engine.name !== "postflop-solver" || engine.license !== "AGPL-3.0" || !/^[0-9a-f]{40}$/.test(String(engine.commit))) fail("engine credit");
  if (value.gatePctPot !== BRIDGE_LIBRARY_GATE_PCT_POT) fail("gatePctPot");
  const spots = array(value.spots, 64, "spots").map(validateSpotEntry);
  if (!spots.length || new Set(spots.map(s => s.id)).size !== spots.length) fail("spot ids must be unique");
  const sample = object(value.refereeSample, "refereeSample");
  validateLibraryRef(sample, "refereeSample");
  if (!spots.some(s => s.id === sample.spotId)) fail("refereeSample.spotId");
  return input as BridgeLibraryManifest;
}

/** Schema + structural checks of one chunk (the full invariant audit lives in invariants.ts). */
export function validateLibraryChunk(input: unknown, spot: BridgeLibrarySpot, key: string, ranges: BridgeLibraryRanges): BridgeLibraryChunk {
  const value = object(input, "chunk");
  if (value.format !== BRIDGE_LIBRARY_CHUNK_FORMAT || value.version !== 1) fail("unsupported chunk format");
  if (value.spotId !== spot.id || value.spotHash !== spot.spotHash || value.key !== key || !spot.chunks[key]) fail(`chunk ${key} belongs to another spot`);
  const nodes = array(value.nodes, BRIDGE_LIBRARY_MAX_NODES_PER_CHUNK, `${key}.nodes`);
  if (nodes.length !== spot.chunks[key].nodes) fail(`${key} node count`);
  const seen = new Set<string>();
  nodes.forEach((raw, n) => {
    const label = `${key}.nodes[${n}]`, node = object(raw, label);
    const path = typeof node.path === "string" ? node.path : fail(`${label}.path`);
    const tokens = path === "" ? [] : path.split(" ");
    if (tokens.some(t => !TOKEN.test(t)) || seen.has(path)) fail(`${label}.path`);
    seen.add(path);
    if (node.street !== "flop" && node.street !== "turn" && node.street !== "river") fail(`${label}.street`);
    const board = array(node.board, 5, `${label}.board`) as string[];
    const cards = tokens.filter(t => CARD.test(t));
    if (board.join() !== [...spot.flop, ...cards].join() || board.length !== { flop: 3, turn: 4, river: 5 }[node.street as "flop"]) fail(`${label}.board`);
    if (chunkKeyForNode(node as unknown as BridgeLibraryNode) !== key) fail(`${label} is in the wrong chunk`);
    const player = node.player === 0 || node.player === 1 ? node.player : fail(`${label}.player`);
    const committed = array(node.committed, 2, `${label}.committed`);
    if (committed.length !== 2) fail(`${label}.committed`);
    committed.forEach((c, p) => int(c, 0, 1e8, `${label}.committed[${p}]`));
    const actions = array(node.actions, 8, `${label}.actions`);
    if (!actions.length || actions.some(t => typeof t !== "string" || !TOKEN.test(t) || CARD.test(t)) || new Set(actions).size !== actions.length) fail(`${label}.actions`);
    const live = array(node.live, 2, `${label}.live`);
    const lists = [0, 1].map(p => {
      const list = array(live[p], ranges.hands[p].length, `${label}.live[${p}]`);
      list.forEach((h, i) => { int(h, 0, ranges.hands[p].length - 1, `${label}.live[${p}]`); if (i && (h as number) <= (list[i - 1] as number)) fail(`${label}.live[${p}] must ascend`); });
      return list as number[];
    });
    const reachMax = array(node.reachMax, 2, `${label}.reachMax`);
    if (reachMax.length !== 2) fail(`${label}.reachMax`);
    reachMax.forEach((m, p) => { if (num(m, 0, 1 + 1e-6, `${label}.reachMax[${p}]`) === 0 && lists[p].length) fail(`${label}.reachMax[${p}] is 0 with live hands`); });
    const omitted = array(node.omittedReach, 2, `${label}.omittedReach`);
    omitted.forEach((m, p) => num(m, 0, 1326, `${label}.omittedReach[${p}]`));
    const perHand = (rows: unknown, p: number, nullable: boolean, min: number, max: number, what: string) => {
      const row = array(rows, lists[p].length, `${label}.${what}`);
      if (row.length !== lists[p].length) fail(`${label}.${what} length`);
      row.forEach(x => { if (x === null ? !nullable : (int(x, min, max, `${label}.${what}`), false)) fail(`${label}.${what} null`); });
    };
    const reach = array(node.reach, 2, `${label}.reach`), ev = array(node.ev, 2, `${label}.ev`), equity = array(node.equity, 2, `${label}.equity`);
    for (const p of [0, 1]) {
      perHand(reach[p], p, false, 1, REACH_SCALE, `reach[${p}]`);
      perHand(ev[p], p, true, -1e9, 1e9, `ev[${p}]`);
      perHand(equity[p], p, true, 0, EQUITY_SCALE, `equity[${p}]`);
    }
    const strategy = array(node.strategy, actions.length, `${label}.strategy`), actionEv = array(node.actionEv, actions.length, `${label}.actionEv`);
    if (strategy.length !== actions.length || actionEv.length !== actions.length) fail(`${label} action rows`);
    strategy.forEach((row, a) => perHand(row, player, false, 0, STRATEGY_SCALE, `strategy[${a}]`));
    actionEv.forEach((row, a) => perHand(row, player, true, -1e9, 1e9, `actionEv[${a}]`));
    for (let i = 0; i < lists[player].length; i += 1) {
      if ((strategy as number[][]).reduce((s, row) => s + row[i], 0) !== STRATEGY_SCALE) fail(`${label} strategy of hand ${lists[player][i]} does not sum to 1`);
    }
  });
  return input as BridgeLibraryChunk;
}

/** Spot file → the hand lists and initial weights chunk rows index into. */
export function libraryRangesFromSpot(input: unknown, entry: BridgeLibrarySpot): BridgeLibraryRanges {
  const spot = object(input, "spot"), ranges = array(spot.ranges, 2, "spot.ranges");
  if (spot.id !== entry.id || ranges.length !== 2) fail("spot file does not match its manifest entry");
  const rows = ranges.map((r, p) => array(object(r, `ranges[${p}]`).combos, 1326, `ranges[${p}].combos`).map(e => object(e, "combo")));
  return {
    hands: [rows[0].map(e => text(e.combo, 4, "combo")), rows[1].map(e => text(e.combo, 4, "combo"))],
    weights: [rows[0].map(e => num(e.weight, 0, 1, "weight")), rows[1].map(e => num(e.weight, 0, 1, "weight"))],
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, "0")).join("");
}

/** Fetch one library file; refuses anything that does not match its manifest reference exactly. */
export async function fetchLibraryJson(ref: BridgeLibraryFileRef, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<unknown> {
  validateLibraryRef(ref, "file");
  const response = await fetcher(ref.url, { signal, cache: "no-cache" });
  if (!response.ok) throw new BridgeLibraryError(`Could not load saved spot data (${response.status}). Check your connection and retry.`);
  const buffer = new Uint8Array(await response.arrayBuffer());
  signal?.throwIfAborted();
  if (buffer.byteLength !== ref.bytes) throw new BridgeLibraryError("Saved spot data is incomplete or has the wrong size");
  if (await sha256Hex(buffer) !== ref.sha256) throw new BridgeLibraryError("Saved spot data failed its integrity check");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer));
}

export const BRIDGE_LIBRARY_MANIFEST_URL = `${BRIDGE_LIBRARY_URL_PREFIX}manifest.json`;

/** The manifest has no parent hash: it is bounded in size and fully schema-checked instead. */
export async function loadLibraryManifest(signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<BridgeLibraryManifest> {
  const response = await fetcher(BRIDGE_LIBRARY_MANIFEST_URL, { signal, cache: "no-cache" });
  if (!response.ok) throw new BridgeLibraryError(`Could not load the spot library (${response.status}).`);
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength > BRIDGE_LIBRARY_FILE_BYTES) throw new BridgeLibraryError("Spot library manifest is too large");
  return validateLibraryManifest(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer)));
}

/** Lazily load and validate one spot's ranges and one chunk. */
export async function loadLibraryChunk(spot: BridgeLibrarySpot, key: string, ranges: BridgeLibraryRanges, signal?: AbortSignal,
  fetcher: typeof fetch = fetch): Promise<BridgeLibraryChunk> {
  const ref = spot.chunks[key];
  if (!ref) throw new BridgeLibraryError(`Spot ${spot.id} has no saved slice ${key}`);
  return validateLibraryChunk(await fetchLibraryJson(ref, signal, fetcher), spot, key, ranges);
}

export async function loadLibraryRanges(spot: BridgeLibrarySpot, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<BridgeLibraryRanges> {
  return libraryRangesFromSpot(await fetchLibraryJson(spot.spot, signal, fetcher), spot);
}
