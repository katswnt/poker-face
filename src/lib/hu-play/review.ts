/** Completed-hand teaching snapshots. Never imported by the controller or policy pipeline. */
import type { PlayDecisionView, PlayLedgerRow, PlayView } from "./ui-controller";
import type { RangeEquityInput } from "./teaching";
import { decisionPrice } from "./teaching";
import { gradePlayDecision } from "./decision-grade";
import { derivePublicState, validatePublicState } from "./public-state";
import { assertDistinctRiverCards, parseRiverCombo } from "../solver/river/cards";

export const REVIEW_LIMITS = Object.freeze({ hands: 20, bytes: 8 * 1024 ** 2, perHandBytes: 2 * 1024 ** 2 });
export interface ReviewIdentity { readonly buildHash: string; readonly engineSourceHash: string }
export interface ReviewDecision {
  readonly eventIndex: number;
  readonly decision: PlayDecisionView;
  readonly equityInput: RangeEquityInput;
}
export interface CompletedReview {
  readonly format: "poker-face-completed-review";
  readonly version: 1;
  readonly id: number;
  readonly identity: ReviewIdentity;
  readonly hand: NonNullable<PlayView["hand"]> & { readonly aiHand: string; readonly finalStacks: readonly [number, number] };
  readonly ledger: PlayLedgerRow;
  readonly decisions: readonly ReviewDecision[];
}
function freeze<T>(v: T): T {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    Object.values(v).forEach(freeze); Object.freeze(v);
  }
  return v;
}
function requireValue(ok: unknown, reason: string): asserts ok { if (!ok) throw new Error(reason); }
function fields(v: unknown, names: readonly string[]) {
  requireValue(v && typeof v === "object" && !Array.isArray(v)
    && Object.keys(v).sort().join() === [...names].sort().join(), "Review equity fields must not include hidden cards or extra data");
}
function validateEquity(q: RangeEquityInput, d: PlayDecisionView, humanHand: string) {
  fields(q, ["humanHand", "board", "aiRange"]);
  const b = d.public.board, board = [...b.flop, ...(b.turn ? [b.turn] : []), ...(b.river ? [b.river] : [])];
  requireValue(q.humanHand === humanHand, "Review equity human hand mismatch");
  requireValue(JSON.stringify(q.board) === JSON.stringify(board), "Review equity must use the board at that decision");
  fields(q.aiRange, ["source", "entries"]);
  requireValue(typeof q.aiRange.source === "string" && q.aiRange.source.length <= 500
    && Array.isArray(q.aiRange.entries) && q.aiRange.entries.length <= 1326, "Invalid review range");
  const seen = new Set<string>();
  for (const row of q.aiRange.entries) {
    fields(row, ["combo", "weight"]);
    const key = parseRiverCombo(row.combo).join("");
    requireValue(Number.isFinite(row.weight) && row.weight >= 0 && !seen.has(key), "Invalid review range weight or duplicate hand");
    seen.add(key);
  }
}

/** Called only after completion. The supplied reader must be the original controller's
 * equityInput; this function validates identity/shape, never reconstructs an opponent model.
 */
export function captureCompletedReview(view: PlayView, identity: ReviewIdentity,
  equityInput: (key: string) => RangeEquityInput): CompletedReview {
  const h = view.hand, ledger = view.ledger.at(-1);
  requireValue(view.phase === "complete" && h?.aiHand && h.finalStacks && ledger, "A complete revealed hand is required for review");
  requireValue(/^[a-f0-9]{64}$/.test(identity.buildHash) && /^[a-f0-9]{64}$/.test(identity.engineSourceHash), "Invalid review build/source hash identity");
  const history = validatePublicState(h.public);
  requireValue(history.status === "showdown" || history.status === "fold", "Review history must be complete");
  requireValue(ledger.seed === h.seed && ledger.humanSeat === h.humanSeat && Number.isSafeInteger(ledger.id) && ledger.id > 0,
    "Review ledger hand identity mismatch");
  requireValue(h.finalStacks.every(n => Number.isSafeInteger(n) && n >= 0) && h.finalStacks[0] + h.finalStacks[1] === 20050
    && h.finalStacks[h.humanSeat] - 10000 === ledger.humanNet
    && h.finalStacks[1-h.humanSeat] - 10000 === ledger.aiNet && ledger.externalDeadBlind === 50, "Review settlement does not conserve stacks");
  const board = history.board;
  assertDistinctRiverCards([...parseRiverCombo(h.humanHand), ...parseRiverCombo(h.aiHand), ...board.flop,
    ...(board.turn ? [board.turn] : []), ...(board.river ? [board.river] : [])], "Completed review cards");
  const seen = new Set<number>();
  const decisions = view.decisions.map(d => {
    const before = validatePublicState(d.public), eventIndex = before.events.length;
    requireValue(!seen.has(eventIndex), "Duplicate review decision"); seen.add(eventIndex);
    requireValue(before.status === "betting" && before.toAct !== null
      && JSON.stringify(derivePublicState(history, history.events.slice(0,eventIndex))) === JSON.stringify(before), "Review decision history prefix mismatch");
    const event = history.events[eventIndex];
    requireValue(event?.kind === "action" && event.player === before.toAct
      && d.actor === (event.player === h.humanSeat ? "human" : "ai")
      && d.key === (before.path.join(" ") || "root"), "Review decision does not match its committed action");
    const q = equityInput(d.key); validateEquity(q, d, h.humanHand);
    return { eventIndex, decision: d, equityInput: q };
  }).sort((a,b) => a.eventIndex-b.eventIndex);
  requireValue(decisions.length === history.events.filter(e => e.kind === "action").length, "Missing review decisions: every committed action needs a snapshot");
  return freeze(structuredClone({ format: "poker-face-completed-review", version: 1, id: ledger.id,
    identity, hand: h, ledger, decisions })) as CompletedReview;
}
export function serializeReview(review: CompletedReview): string { return JSON.stringify(review) + "\n"; }
export function reviewDecision(review: CompletedReview, index: number) {
  requireValue(Number.isInteger(index) && index >= 0 && index < review.decisions.length, "No such review decision");
  const row = review.decisions[index], event = review.hand.public.events[row.eventIndex];
  requireValue(event.kind === "action", "Review decision has no action");
  return { ...row, action: event.action, price: decisionPrice(row.decision.public), grade: gradePlayDecision(row.decision,review.hand.public) };
}
export interface ReviewCollection {
  readonly reviews: readonly CompletedReview[]; readonly bytes: number; readonly evicted: number;
}
export class ReviewArchive {
  private snapshot: ReviewCollection = Object.freeze({ reviews: Object.freeze([]), bytes: 0, evicted: 0 });
  private lastId = 0;
  getSnapshot = (): ReviewCollection => this.snapshot;
  capture(view: PlayView, identity: ReviewIdentity, equityInput: (key: string) => RangeEquityInput): void {
    // start() publishes a progress reset before its loading view, after clearing old
    // observations. Never ask that controller for an already captured hand again.
    if (view.phase !== "complete" || (view.ledger.at(-1)?.id ?? 0) <= this.lastId) return;
    this.add(captureCompletedReview(view, identity, equityInput));
  }
  add(review: CompletedReview): void {
    const text = serializeReview(review), size = new TextEncoder().encode(text).byteLength;
    requireValue(size <= REVIEW_LIMITS.perHandBytes, "Review is too large: individual serialized limit is 2 MiB");
    const old = this.snapshot.reviews.find(r => r.id === review.id);
    if (old) { requireValue(serializeReview(old) === text, "Review ID was reused for different data"); return; }
    if (review.id <= this.lastId) return; // An evicted completed notification cannot re-add an old hand.
    const reviews = [...this.snapshot.reviews, freeze(structuredClone(review))];
    let bytes = this.snapshot.bytes + size, evicted = this.snapshot.evicted;
    while (reviews.length > REVIEW_LIMITS.hands || bytes > REVIEW_LIMITS.bytes) {
      bytes -= new TextEncoder().encode(serializeReview(reviews.shift()!)).byteLength; evicted++;
    }
    this.lastId = review.id;
    this.snapshot = Object.freeze({ reviews: Object.freeze(reviews), bytes, evicted });
  }
}
