// The drill session as a pure state machine: pick a question, grade an answer, move on.
// The UI supplies the clock (`now`, ms) and a session seed; everything else is deterministic.
import { DRILL_TYPES, generateQuestion } from "./generators";
import { grade } from "./grade";
import { sessionRng } from "./rng";
import { START_PROGRESS, applyResult, pickNext, type DrillMode, type DrillState, type ReviewEvent } from "./scheduler";
import type { DrillType, GradeResult, Level, Question } from "./types";

export type LevelPin = Level | "auto";

/** A solver question the UI must build asynchronously (lazy-loaded library chunks), then hand
 *  back with `resolvePending`. Fresh: sampled from `(seed, level)`; review: rebuilt from `key`. */
export interface PendingQuestion {
  readonly type: "solver";
  readonly seed: number;
  readonly level: Level;
  readonly key?: string;
  readonly fromReview: boolean;
}

export interface Session {
  readonly state: DrillState;
  readonly mode: DrillMode;
  readonly levelPin: LevelPin;
  readonly sessionSeed: number;
  /** Fresh questions drawn so far; with `sessionSeed` it determines the next fresh seed. */
  readonly drawn: number;
  readonly question: Question | null;
  /** Set while a solver question is being loaded; `question` is null meanwhile. */
  readonly pending: PendingQuestion | null;
  readonly fromReview: boolean;
  readonly shownAt: number;
  readonly result: GradeResult | null;
  readonly event: ReviewEvent | null;
  readonly given: string | null;
  readonly invalid: boolean;
}

function freshDraw(sessionSeed: number, drawn: number): { seed: number; typePick: number } {
  const rng = sessionRng((sessionSeed + Math.imul(drawn + 1, 0x9e3779b9)) >>> 0);
  return { seed: Math.floor(rng() * 0x1_0000_0000) >>> 0, typePick: rng() };
}

export function levelFor(state: DrillState, type: DrillType, pin: LevelPin): Level {
  return pin === "auto" ? (state.progress[type] ?? START_PROGRESS).level : pin;
}

/** Show the next question for the current mode (review item if due, else fresh). Solver
 *  questions come back as `pending` (question null) for the UI to load and resolve. */
export function advance(session: Session, now: number): Session {
  const base = { ...session, result: null, event: null, given: null, invalid: false, shownAt: now, pending: null };
  const pick = pickNext(session.state, session.mode, session.question?.id ?? lastPendingId(session));
  if (pick.source === "empty") return { ...base, question: null, fromReview: false };
  if (pick.source === "review") {
    const { item } = pick;
    if (item.type === "solver") {
      return { ...base, question: null, fromReview: true, pending: { type: "solver", seed: item.seed, level: item.level, key: item.key, fromReview: true } };
    }
    return { ...base, question: generateQuestion(item.type, item.seed, item.level), fromReview: true };
  }
  const { seed, typePick } = freshDraw(session.sessionSeed, session.drawn);
  const type = session.mode.kind === "type" ? session.mode.type : DRILL_TYPES[Math.floor(typePick * DRILL_TYPES.length)];
  const level = levelFor(session.state, type, session.levelPin);
  if (type === "solver") {
    return { ...base, drawn: session.drawn + 1, question: null, fromReview: false, pending: { type: "solver", seed, level, fromReview: false } };
  }
  return { ...base, drawn: session.drawn + 1, question: generateQuestion(type, seed, level), fromReview: false };
}

const lastPendingId = (session: Session): string | undefined =>
  session.pending?.key ? `solver:${session.pending.key}` : undefined;

/** Install the question built for `session.pending`; the timer starts now. A stale question
 *  (the mode changed while it loaded) is ignored. */
export function resolvePending(session: Session, pending: PendingQuestion, question: Question, now: number): Session {
  if (session.pending !== pending) return session;
  return { ...session, pending: null, question, fromReview: pending.fromReview, shownAt: now };
}

/** Drop a review item that can no longer be rebuilt (e.g. the library changed) and move on. */
export function dropPending(session: Session, now: number): Session {
  const key = session.pending?.key;
  if (!key) return session;
  const state = { ...session.state, review: session.state.review.filter(item => item.key !== key) };
  return advance({ ...session, state, pending: null, question: null }, now);
}

export function startSession(state: DrillState, sessionSeed: number, mode: DrillMode, levelPin: LevelPin, now: number): Session {
  return advance({
    state, mode, levelPin, sessionSeed: sessionSeed >>> 0, drawn: 0, question: null, pending: null, fromReview: false,
    shownAt: now, result: null, event: null, given: null, invalid: false,
  }, now);
}

/** Grade an answer. Invalid input marks the session `invalid` and keeps the clock running. */
export function submit(session: Session, input: string, now: number): Session {
  if (!session.question || session.result) return session;
  const result = grade(session.question, input, Math.max(0, now - session.shownAt));
  if (!result) return { ...session, invalid: true };
  const applied = applyResult(session.state, session.question, result, session.fromReview);
  return { ...session, state: applied.state, result, event: applied.event, given: input, invalid: false };
}

export function changeMode(session: Session, mode: DrillMode, now: number): Session {
  return advance({ ...session, mode, question: null, pending: null }, now);
}

export function changeLevel(session: Session, levelPin: LevelPin, now: number): Session {
  return advance({ ...session, levelPin, question: null, pending: null }, now);
}

/** Replace the persistent part of the state (e.g. after clearing saved progress). */
export function replaceState(session: Session, state: DrillState, now: number): Session {
  return advance({ ...session, state, question: null, pending: null }, now);
}
