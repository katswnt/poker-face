import { CHUNK_BYTE_LIMIT, type ChunkRef, type ExplorerChunk, type SavedScenario } from "./model";

/** Full bounded transport validation; no game compiler or source policy enters the browser. */
export function validateExplorerChunk(value: unknown, scenario: SavedScenario, card: string | null): ExplorerChunk {
  const fail = (): never => { throw new Error("Saved result has an invalid structure. Reload the page or retry."); };
  const obj = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : fail();
  const arr = (v: unknown, max: number): unknown[] => Array.isArray(v) && v.length <= max ? v : fail();
  const num = (v: unknown, min: number, max: number) => { if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) fail(); };
  const integer = (v: unknown, min = 0, max = 20000) => { num(v, min, max); if (!Number.isInteger(v)) fail(); };
  const prob = (v: unknown) => num(v, 0, 1 + 1e-12);
  const nullable = (v: unknown, check: (n: unknown) => void) => { if (v !== null) check(v); };
  const distribution = (v: unknown, length: number) => {
    if (v === null) return;
    const entries = arr(v, length); if (entries.length !== length) fail(); entries.forEach(prob);
    if (Math.abs((entries as number[]).reduce((a, b) => a + b, 0) - 1) > 1e-10) fail();
  };
  const action = (v: unknown) => { if (typeof v !== "string" || !/^(check|call|fold|bet-to-[1-9]\d{0,6}|raise-to-[1-9]\d{0,6})$/.test(v)) fail(); };
  const chunk = obj(value);
  if (chunk.version !== 1 || chunk.scenario !== scenario.id || chunk.sourceHash !== scenario.provenance.payloadHash || chunk.card !== card) fail();
  const nodes = arr(chunk.nodes, 20000), ids = new Set<number>();
  if (!nodes.length) fail();
  for (const v of nodes) {
    const node = obj(v), state = obj(node.state);
    integer(node.id); if (ids.has(node.id as number)) fail(); ids.add(node.id as number);
    nullable(node.parent, integer); prob(node.reach); integer(node.compatibleDeals, 0, 16);
    if (!["play", "river-card", "terminal"].includes(state.phase as string) || state.river !== card || state.street !== (card ? 1 : 0)) fail();
    if (![null, 0, 1].includes(state.actor as null | number) || ![null, 0, 1].includes(state.folded as null | number)) fail();
    if ((state.phase === "play") !== (state.actor !== null)) fail();
    for (const field of ["carried", "currentBet", "lastFullRaise", "raisesUsed", "checks"]) integer(state[field], 0, 2_000_000);
    for (const field of ["streetPaid", "returned"]) { const pair = arr(state[field], 2); if (pair.length !== 2) fail(); pair.forEach(n => integer(n, 0, 2_000_000)); }
    const histories = arr(state.histories, 2); if (histories.length !== 2) fail(); histories.forEach(h => arr(h, 8).forEach(action));
    const children = arr(node.children, 48);
    if (state.phase === "terminal" && children.length || state.phase === "river-card" && children.length !== 48 || state.phase === "play" && (!children.length || children.length > 6)) fail();
    for (const childValue of children) {
      const child = obj(childValue); integer(child.node); integer(child.compatibleDeals, 0, 16); nullable(child.probability, prob);
      nullable(child.value0, n => num(n, -3_000_000, 3_000_000));
      if (state.phase === "river-card") {
        if (typeof child.card !== "string" || !scenario.chunks[child.card] || child.label !== child.card) fail();
      } else { action(child.label); if (child.card !== card) fail(); }
    }
    nullable(node.terminalValue0, n => num(n, -3_000_000, 3_000_000)); distribution(node.mix, children.length);
    const hands = arr(node.hands, 8), seenHands = new Set<number>();
    if (state.phase !== "play" && hands.length) fail();
    for (const handValue of hands) {
      const hand = obj(handValue), actor = state.actor as number, otherCount = scenario.hands[1 - actor].length;
      integer(hand.hand, 0, scenario.hands[actor].length - 1); if (seenHands.has(hand.hand as number)) fail(); seenHands.add(hand.hand as number);
      prob(hand.reach); distribution(hand.opponent, otherCount); nullable(hand.checkdownShare, prob);
      const actions = arr(hand.actions, 6); if (actions.length !== children.length) fail();
      let frequency = 0;
      actions.forEach((a, i) => {
        const fact = obj(a); if (fact.action !== obj(children[i]).label) fail(); prob(fact.frequency); frequency += fact.frequency as number;
        nullable(fact.ev, n => num(n, -3_000_000, 3_000_000)); nullable(fact.evFromNow, n => num(n, -3_000_000, 6_000_000));
        nullable(fact.behindBest, n => num(n, 0, 6_000_000)); distribution(fact.outcomes, 5); nullable(fact.showdownShare, prob); nullable(fact.foldNext, prob);
        const responses = arr(fact.responses, 6);
        responses.forEach(r => { const response = obj(r); action(response.action); nullable(response.probability, prob); distribution(response.opponent, otherCount); });
        if (responses.length && responses.every(r => obj(r).probability !== null)
          && Math.abs(responses.reduce<number>((sum, r) => sum + (obj(r).probability as number), 0) - 1) > 1e-10) fail();
      });
      if (Math.abs(frequency - 1) > 1e-10) fail();
    }
  }
  // Same-card action edges must stay inside the validated chunk. River edges are lazy.
  for (const v of nodes) { const n = obj(v); if (obj(n.state).phase !== "river-card") for (const c of n.children as unknown[]) if (!ids.has(obj(c).node as number)) fail(); }
  return value as ExplorerChunk;
}

export async function readExplorerChunk(scenario: SavedScenario, card: string | null, signal: AbortSignal,
  fetcher: typeof fetch = fetch): Promise<ExplorerChunk> {
  const ref: ChunkRef | undefined = scenario.chunks[card ?? "turn"];
  if (!ref || ref.bytes > CHUNK_BYTE_LIMIT || !ref.url.startsWith(`/solver-data/turn-v1/${scenario.id}/`)) throw new Error("This saved result is unavailable.");
  const response = await fetcher(ref.url, { signal, cache: "no-cache" });
  if (!response.ok || !response.body) throw new Error("Could not load the saved result. Check your connection and retry.");
  const reader = response.body.getReader(), parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > ref.bytes || size > CHUNK_BYTE_LIMIT) throw new Error("Saved result exceeds its checked size.");
      parts.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  signal.throwIfAborted();
  if (size !== ref.bytes) throw new Error("Saved result is incomplete. Retry the load.");
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
  signal.throwIfAborted();
  if (digest !== ref.sha256) throw new Error("Saved result failed its integrity check. Reload the page or retry.");
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new Error("Saved result is not valid JSON. Retry the load."); }
  return validateExplorerChunk(value, scenario, card);
}
