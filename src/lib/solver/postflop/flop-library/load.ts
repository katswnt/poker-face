import { assertDistinctRiverCards, parseRiverCombo, RIVER_DECK, riverComboKey } from "../../river/cards";
import { flopActions, initialFlopState, nextFlopAction, nextFlopCard, validateFlopRequest, type FlopRequest, type FlopState } from "../flop/rules";
import { FLOP_CONDITIONAL_MIN, FLOP_INITIAL_BYTES, FLOP_SLICE_BYTES, type FlopCatalog, type FlopFileRef, type FlopScenario, type FlopSlice, type PublicFlopFacts } from "./model";
import type { FlopRangeContext } from "./query";

const fail = (): never => { throw new Error("Saved flop data is invalid or does not match this scenario. Reload or retry."); };
const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : fail();
const array = (v: unknown, max: number): unknown[] => Array.isArray(v) && v.length <= max ? Array.from(v) : fail();
const number = (v: unknown, min: number, max: number): number => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : fail();
const integer = (v: unknown, min: number, max: number) => { const n = number(v, min, max); if (!Number.isSafeInteger(n)) fail(); return n; };
const text = (v: unknown, max: number): string => typeof v === "string" && v.length > 0 && v.length <= max ? v : fail();
const probability = (v: unknown) => number(v, 0, 1 + 1e-12);
const pair = (v: unknown) => { const a = array(v, 2); if (a.length !== 2) fail(); return a; };
const nullable = (v: unknown, check: (v: unknown) => unknown) => { if (v !== null) check(v); };
const hash = (v: unknown) => { if (typeof v !== "string" || !/^[0-9a-f]{64}$/.test(v)) fail(); };
const stateKey = (s: FlopState) => JSON.stringify([s.phase, s.street, s.turn, s.river, s.histories, s.put, s.actor, s.folded]);

export function validateFlopRef(value: unknown, prefix: string, limit = FLOP_SLICE_BYTES): FlopFileRef {
  const ref = object(value); integer(ref.bytes, 1, limit); hash(ref.sha256);
  if (typeof ref.url !== "string" || !ref.url.startsWith(prefix) || !/^[a-zA-Z0-9/_.-]+$/.test(ref.url) || ref.url.includes("..")) fail();
  return value as FlopFileRef;
}
export function validateFlopScenario(input: unknown, entry: FlopCatalog["scenarios"][number]): FlopScenario {
  const value = object(input);
  if (value.version !== 1 || value.id !== entry.id || value.sourceHash !== entry.sourceHash || value.title !== entry.title || value.texture !== entry.texture) fail();
  hash(value.policyHash); text(value.provenance, 2000); text(value.description, 2000);
  const { request, hands: names } = validateFlopRangeContext(value); if (request.id !== entry.id) fail();
  const hands = names.map(r => r.map(parseRiverCombo));
  const support = hands[0].reduce((sum, h) => sum + hands[1].filter(o => !h.some(c => o.includes(c))).length, 0);
  const counts = object(value.counts); if (counts.compatibleDeals !== support || !support) fail();
  integer(counts.publicStates, 1, 250000); integer(counts.informationSets, 0, 6000000);
  const quality = object(value.quality), scale = request.committedPerPlayer + Math.min(...request.stackBehind);
  integer(quality.iterations, 1, 100000); const exp = number(quality.exploitability, 0, request.committedPerPlayer * 2 * 0.0025);
  const gains = pair(quality.gains).map(v => number(v, 0, 2 * scale)), values = pair(quality.value).map(v => number(v, -scale, scale));
  if (Math.abs(values[0] + values[1]) > 1e-10 * scale || Math.abs((gains[0] + gains[1]) / 2 - exp) > 1e-10 * scale
    || Math.abs(number(quality.percentOfPot, 0, 0.25) - 100 * exp / (2 * request.committedPerPlayer)) > 1e-12) fail();
  const prefix = `/solver-data/flop-v1/${entry.id}/${entry.sourceHash}/`, chunks = object(value.chunks), groups = object(value.riverGroups);
  const deck = RIVER_DECK.filter(c => !request.board.includes(c)), keys = ["flop"];
  if (Object.keys(groups).length !== 49) fail();
  for (const turn of deck) {
    const rivers = deck.filter(c => c !== turn); if (JSON.stringify(groups[turn]) !== JSON.stringify(rivers)) fail();
    keys.push(`t-${turn}`); for (let i = 0; i < 12; i++) keys.push(`t-${turn}-r-${i}`);
  }
  if (Object.keys(chunks).length !== keys.length) fail();
  for (const key of keys) { const ref = validateFlopRef(chunks[key], prefix); if (ref.url !== `${prefix}${key}.json`) fail(); }
  const inputs = validateFlopRef(value.inputs, prefix, FLOP_INITIAL_BYTES); if (inputs.url !== `${prefix}inputs.json`) fail();
  return input as FlopScenario;
}

/** Bounded validation before any pair enumeration at the worker boundary. */
export function validateFlopRangeContext(input: unknown): FlopRangeContext {
  const value = object(input), request = validateFlopRequest(value.request as FlopRequest);
  const hands = pair(value.hands).map(r => array(r, 64).map(h => parseRiverCombo(text(h, 4))));
  const weights = pair(value.weights).map(r => array(r, 64).map(w => number(w, 1e-12, 1)));
  for (let p = 0; p < 2; p++) if (!hands[p].length || hands[p].length !== weights[p].length || new Set(hands[p].map(riverComboKey)).size !== hands[p].length
    || hands[p].some(h => h.some(c => request.board.includes(c)))) fail();
  return input as FlopRangeContext;
}

export function validateFlopSlice(input: unknown, scenario: FlopScenario, key: string, inspectedRiver = false): FlopSlice {
  if (inspectedRiver && !key.includes("-r-")) fail();
  const value = object(input);
  if (value.version !== 1 || value.scenario !== scenario.id || value.sourceHash !== scenario.sourceHash || value.key !== key || !scenario.chunks[key]) fail();
  const nodes = array(value.nodes, 400); if (!nodes.length) fail();
  const ids = new Map<number, Record<string, unknown>>(), scale = scenario.request.committedPerPlayer + Math.min(...scenario.request.stackBehind);
  const hands = scenario.hands.map(r => r.map(parseRiverCombo)), supportCache = new Map<string, { count: number; live: boolean[][] }>();
  const support = (turn: string | null, river: string | null) => {
    const k = `${turn}/${river}`; if (supportCache.has(k)) return supportCache.get(k)!;
    const live = hands.map(r => r.map(() => false)); let count = 0;
    for (const [a, h] of hands[0].entries()) for (const [b, o] of hands[1].entries()) {
      if (h.some(c => o.includes(c)) || [...h, ...o].some(c => c === turn || c === river)) continue;
      count++; live[0][a] = true; live[1][b] = true;
    }
    const result = { count, live }; supportCache.set(k, result); return result;
  };
  const summary = (v: unknown, expectedSupport: number): PublicFlopFacts => {
    const f = object(v), reach = probability(f.reach); if (f.support !== expectedSupport) fail();
    if (reach > FLOP_CONDITIONAL_MIN) number(f.value0, -scale - 1e-8, scale + 1e-8); else if (f.value0 !== null) fail();
    return v as PublicFlopFacts;
  };
  for (const item of nodes) {
    const node = object(item), id = integer(node.id, 0, scenario.counts.publicStates - 1); if (ids.has(id)) fail(); ids.set(id, node);
    nullable(node.parent, n => integer(n, 0, scenario.counts.publicStates - 1)); if ((node.parent === null) !== (id === 0)) fail();
    const s = object(node.state), street = integer(s.street, 0, 2), histories = array(s.histories, 3); if (histories.length !== 3) fail();
    if (!["play", "card", "terminal"].includes(s.phase as string) || ![null, 0, 1].includes(s.actor as number | null) || ![null, 0, 1].includes(s.folded as number | null)) fail();
    let replay = initialFlopState(scenario.request);
    for (let t = 0; t < 3; t++) {
      const actions = array(histories[t], 3); if (t > street && actions.length) fail();
      if (t > street) continue;
      if (t > 0) replay = nextFlopCard(scenario.request, replay, (t === 1 ? s.turn : s.river) as FlopState["turn"] & string);
      for (const action of actions) { if (!flopActions(replay).includes(action as never)) fail(); replay = nextFlopAction(scenario.request, replay, action as never); }
    }
    if (stateKey(replay) !== stateKey(s as unknown as FlopState)) fail();
    const turn = replay.turn, river = replay.river, expectedKey = street === 0 ? "flop" : street === 1 ? `t-${turn}`
      : `t-${turn}-r-${Math.floor(scenario.riverGroups[turn!].indexOf(river!) / 4)}`;
    if (key !== expectedKey) fail();
    assertDistinctRiverCards([...scenario.request.board, ...(turn ? [turn] : []), ...(river ? [river] : [])], "Saved board");
    const available = support(turn, river), actor = replay.actor;
    if (street < 2 || inspectedRiver) summary(node.summary, available.count); else if (node.summary !== null) fail();
    const labels = replay.phase === "card" ? RIVER_DECK.filter(c => !scenario.request.board.includes(c) && c !== turn) : flopActions(replay);
    const edges = array(node.edges, 49); if (edges.length !== labels.length) fail();
    edges.forEach((v, a) => {
      const e = object(v); integer(e.node, 0, scenario.counts.publicStates - 1); if (e.label !== labels[a]) fail();
      if (replay.phase === "card") summary(e.preview, support(street === 0 ? e.label as string : turn, street === 0 ? null : e.label as string).count);
      else if (e.preview !== null) fail();
    });
    if (actor === null) { if (node.policy !== null) fail(); } else {
      const rows = array(node.policy, 64); if (rows.length !== hands[actor].length) fail();
      rows.forEach((r, h) => { const row = pair(r).map(probability); if (Math.abs(row[0] + row[1] - (available.live[actor][h] ? 1 : 0)) > 1e-12) fail(); });
    }
    const facts = array(node.hands, 64), found = new Set<number>(); let totalReach = 0;
    if ((street === 2 && !inspectedRiver || actor === null) && facts.length) fail();
    for (const f of facts) {
      const fact = object(f), h = integer(fact.hand, 0, hands[actor!].length - 1), reach = probability(fact.reach);
      if (found.has(h) || !available.live[actor!][h]) fail(); found.add(h); totalReach += reach;
      if (reach > FLOP_CONDITIONAL_MIN) probability(fact.checkdownShare); else if (fact.checkdownShare !== null) fail();
      pair(fact.actions).forEach(a => {
        const action = object(a);
        if (reach <= FLOP_CONDITIONAL_MIN) { if (action.ev !== null || action.outcomes !== null) fail(); }
        else {
          number(action.ev, -scale - 1e-8, scale + 1e-8); const outcomes = array(action.outcomes, 5).map(probability);
          if (outcomes.length !== 5 || Math.abs(outcomes.reduce((s, v) => s + v, 0) - 1) > 1e-9) fail();
        }
      });
    }
    if ((street < 2 || inspectedRiver) && actor !== null && (found.size !== available.live[actor].filter(Boolean).length || Math.abs(totalReach - (object(node.summary).reach as number)) > 1e-12)) fail();
  }
  if (key === "flop" && !ids.has(0)) fail();
  for (const node of ids.values()) if (object(node.state).phase === "play") for (const edge of node.edges as { node: number; label: string }[]) {
    const child = ids.get(edge.node);
    if (!child || child.parent !== node.id || stateKey(child.state as FlopState) !== stateKey(nextFlopAction(scenario.request, node.state as FlopState, edge.label as never))) fail();
  }
  return input as FlopSlice;
}

export async function fetchFlopJson(ref: FlopFileRef, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<unknown> {
  if (!Number.isSafeInteger(ref.bytes) || ref.bytes < 1 || ref.bytes > FLOP_SLICE_BYTES || !ref.url.startsWith("/solver-data/flop-v1/")) fail();
  const response = await fetcher(ref.url, { signal, cache: "no-cache" });
  if (!response.ok || !response.body) throw new Error("Could not load the saved flop data. Check your connection and retry.");
  const reader = response.body.getReader(), parts: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      signal.throwIfAborted(); const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > ref.bytes || size > FLOP_SLICE_BYTES) throw new Error("Saved flop data exceeds its checked size"); parts.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; } finally { reader.releaseLock(); }
  signal.throwIfAborted(); if (size !== ref.bytes) throw new Error("Saved flop data is incomplete");
  const bytes = new Uint8Array(size); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), n => n.toString(16).padStart(2, "0")).join("");
  signal.throwIfAborted(); if (digest !== ref.sha256) throw new Error("Saved flop data failed its integrity check");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
