// The drill session as a pure state machine: pick a question, grade an answer, move on.
// The UI supplies the clock (`now`, ms) and a session seed; everything else is deterministic.
import { DRILL_TYPES, generateQuestion } from "./generators";
import { grade } from "./grade";
import { sessionRng } from "./rng";
import { START_PROGRESS, applyResult, pickNext, type DrillMode, type DrillState, type ReviewEvent } from "./scheduler";
import type { DrillType, GradeResult, Level, Question } from "./types";

export type LevelPin = Level | "auto";

export interface Session {
  readonly state: DrillState;
  readonly mode: DrillMode;
  readonly levelPin: LevelPin;
  readonly sessionSeed: number;
  /** Fresh questions drawn so far; with `sessionSeed` it determines the next fresh seed. */
  readonly drawn: number;
  readonly question: Question | null;
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

/** Show the next question for the current mode (review item if due, else fresh). */
export function advance(session: Session, now: number): Session {
  const base = { ...session, result: null, event: null, given: null, invalid: false, shownAt: now };
  const pick = pickNext(session.state, session.mode, session.question?.id);
  if (pick.source === "empty") return { ...base, question: null, fromReview: false };
  if (pick.source === "review") {
    const { item } = pick;
    return { ...base, question: generateQuestion(item.type, item.seed, item.level), fromReview: true };
  }
  const { seed, typePick } = freshDraw(session.sessionSeed, session.drawn);
  const type = session.mode.kind === "type" ? session.mode.type : DRILL_TYPES[Math.floor(typePick * DRILL_TYPES.length)];
  const level = levelFor(session.state, type, session.levelPin);
  return { ...base, drawn: session.drawn + 1, question: generateQuestion(type, seed, level), fromReview: false };
}

export function startSession(state: DrillState, sessionSeed: number, mode: DrillMode, levelPin: LevelPin, now: number): Session {
  return advance({
    state, mode, levelPin, sessionSeed: sessionSeed >>> 0, drawn: 0, question: null, fromReview: false,
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
  return advance({ ...session, mode, question: null }, now);
}

export function changeLevel(session: Session, levelPin: LevelPin, now: number): Session {
  return advance({ ...session, levelPin, question: null }, now);
}

/** Replace the persistent part of the state (e.g. after clearing saved progress). */
export function replaceState(session: Session, state: DrillState, now: number): Session {
  return advance({ ...session, state, question: null }, now);
}
