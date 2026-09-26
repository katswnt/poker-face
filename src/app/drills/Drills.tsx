"use client";

// Instant poker math drills. All math lives in src/lib/drills (pure, tested); this component
// only owns the clock, focus, keyboard shortcuts and persistence calls.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RN, SUIT_NAMES } from "@/lib/poker/cards";
import type { CardObj } from "@/lib/poker/types";
import {
  BOX_GAPS, DRILL_SOURCES, DRILL_TYPES, browserStorage, dueCount, fmtPct, fmtPts, initialState,
  isDrillType, levelFor, loadState, median, nextDueIn, saveState,
  type DrillMode, type DrillType, type LevelPin, type Question, type Session, type TypeStats,
} from "@/lib/drills";
import { advance, changeLevel, changeMode, replaceState, startSession, submit } from "@/lib/drills/session";
import styles from "./drills.module.css";

const LEVEL_NAMES = { 1: "round numbers", 2: "realistic sizes", 3: "awkward sizes" } as const;
const RED_SUITS = new Set(["♥", "♦"]);

const clock = () => performance.now();
const seconds = (ms: number) => (ms / 1000).toFixed(1);

function cardWords(card: CardObj): string {
  const value = card.rank === "10" ? 10 : ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[card.rank] ?? Number(card.rank);
  return `${RN[value].toLowerCase()} of ${SUIT_NAMES[card.suit]}`;
}

function Cards({ cards }: Readonly<{ cards: readonly CardObj[] }>) {
  return (
    <span className={styles.cards}>
      <span className={styles.srOnly}>{cards.map(cardWords).join(", ")}</span>
      {cards.map(card => (
        <span key={card.rank + card.suit} aria-hidden="true" className={RED_SUITS.has(card.suit) ? styles.playingCardRed : styles.playingCard}>
          {card.rank}{card.suit}
        </span>
      ))}
    </span>
  );
}

function factCards(q: Question, label: string): readonly CardObj[] | null {
  if (label === "Your hand" && q.hole) return q.hole;
  if ((label === "Board" || label === "Flop") && q.board) return q.board;
  return null;
}

function modeKey(mode: DrillMode): string {
  return mode.kind === "type" ? mode.type : mode.kind;
}

function answerHint(q: Question): string {
  if (q.answer.kind === "percent") return `A percent such as 25, 25% or 1/4. Within ±${q.answer.tolerance} pt${q.answer.tolerance === 1 ? "" : "s"} counts as correct.`;
  if (q.answer.kind === "integer") return "A whole number. Must be exact.";
  return "";
}

function exactText(q: Question): string {
  if (q.answer.kind === "percent") return fmtPct(q.answer.value);
  if (q.answer.kind === "integer") return String(q.answer.value);
  const value = q.answer.value;
  return q.answer.options.find(o => o.id === value)?.label ?? value;
}

function combineStats(list: readonly (TypeStats | undefined)[]): TypeStats {
  return list.reduce<TypeStats>((acc, s) => s ? {
    attempts: acc.attempts + s.attempts, correct: acc.correct + s.correct, fast: acc.fast + s.fast,
    recentMs: [...acc.recentMs, ...s.recentMs],
  } : acc, { attempts: 0, correct: 0, fast: 0, recentMs: [] });
}

export default function Drills() {
  const [session, setSession] = useState<Session | null>(null);
  const [draft, setDraft] = useState("");
  const [now, setNow] = useState(0);
  const [saved, setSaved] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const firstChoiceRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  // Storage and the session seed exist only in the browser, so the first question is created
  // after mount; the server renders the page shell with a loading line. Optional URL
  // parameters (?drill=pot-odds&level=2&seed=42) start a specific, reproducible session.
  useEffect(() => {
    const t = clock();
    const { seed, mode, levelPin } = readUrlOptions(window.location.search);
    const start = startSession(loadState(browserStorage()), seed ?? (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0, mode, levelPin, t);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time client-only initialisation
    setSession(start);
    setNow(t);
  }, []);

  const question = session?.question ?? null;
  const graded = session?.result ?? null;
  const running = question !== null && graded === null;

  // Visible timer: tick while a question is unanswered.
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(clock()), 100);
    return () => window.clearInterval(id);
  }, [running, question?.id]);

  // Focus: the answer control when a question appears, the Next button once it is graded.
  useEffect(() => {
    if (!question) return;
    if (graded) nextRef.current?.focus();
    else if (question.answer.kind === "choice") firstChoiceRef.current?.focus();
    else inputRef.current?.focus();
  }, [question, graded]);

  const commit = (next: Session, persist: boolean): void => {
    if (persist) setSaved(saveState(browserStorage(), next.state));
    setSession(next);
    setNow(clock());
  };

  // Only after grading: N never skips an unanswered question.
  const goNext = (): void => {
    if (!session?.result) return;
    setDraft("");
    commit(advance(session, clock()), false);
  };

  // N moves on after grading (ignored while typing in a text field).
  const goNextRef = useRef(goNext);
  useEffect(() => { goNextRef.current = goNext; });
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "n" && event.key !== "N") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" && !(target as HTMLInputElement).readOnly || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) return;
      event.preventDefault();
      goNextRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!session) {
    return (
      <main className={styles.page}>
        <div className={styles.shell}>
          <Header />
          <p className={styles.loading} role="status">Preparing the first question…</p>
        </div>
      </main>
    );
  }

  const { state, mode } = session;
  const onSubmit = (value: string): void => {
    if (!graded) commit(submit(session, value, clock()), true);
  };
  const elapsed = graded ? graded.elapsedMs : Math.max(0, now - session.shownAt);
  const overTarget = question !== null && elapsed > question.speedTargetMs;
  const due = dueCount(state);
  const statsTypes = mode.kind === "type" ? [mode.type] : DRILL_TYPES;
  const stats = combineStats(statsTypes.map(t => state.stats[t]));
  const med = median(stats.recentMs);
  const autoLevelType: DrillType | null = mode.kind === "type" ? mode.type : null;
  const queueByType = DRILL_TYPES.map(t => [t, state.review.filter(i => i.type === t).length] as const).filter(([, n]) => n > 0);

  const clearProgress = (): void => {
    if (!window.confirm("Clear saved drill progress, stats and the review queue?")) return;
    setDraft("");
    commit(replaceState(session, initialState(), clock()), true);
  };

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <Header />

        <div className={styles.controls}>
          <fieldset className={styles.modes}>
            <legend>Drill</legend>
            <div className={styles.modeButtons}>
              {([{ kind: "mixed" }, ...DRILL_TYPES.map(type => ({ kind: "type", type }) as const), { kind: "review" }] as DrillMode[]).map(m => {
                const key = modeKey(m);
                const pressed = modeKey(mode) === key;
                const label = m.kind === "mixed" ? "Mixed" : m.kind === "review" ? `Review (${state.review.length})` : DRILL_SOURCES[m.type].label;
                return (
                  <button key={key} type="button" aria-pressed={pressed}
                    onClick={() => { setDraft(""); commit(changeMode(session, m, clock()), false); }}>
                    {label}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <label className={styles.levelPicker}>
            <span>Difficulty</span>
            <select value={String(session.levelPin)}
              onChange={e => {
                const v = e.target.value;
                const pin: LevelPin = v === "auto" ? "auto" : (Number(v) as 1 | 2 | 3);
                setDraft("");
                commit(changeLevel(session, pin, clock()), false);
              }}>
              <option value="auto">
                {autoLevelType ? `Auto (now level ${levelFor(state, autoLevelType, "auto")})` : "Auto (per drill)"}
              </option>
              <option value="1">Level 1: {LEVEL_NAMES[1]}</option>
              <option value="2">Level 2: {LEVEL_NAMES[2]}</option>
              <option value="3">Level 3: {LEVEL_NAMES[3]}</option>
            </select>
          </label>
        </div>

        <div className={styles.layout}>
          <section className={styles.questionCard} aria-labelledby="drill-question">
            {question === null ? (
              <div className={styles.empty}>
                <h2 id="drill-question">{state.review.length === 0 ? "Nothing to review yet" : "Nothing due right now"}</h2>
                <p>
                  {state.review.length === 0
                    ? "Missed or slow answers are saved here and come back after a short gap."
                    : `${state.review.length} saved; the next one is due in ${nextDueIn(state)} more ${nextDueIn(state) === 1 ? "question" : "questions"}.`}
                  {" "}Pick another drill to keep practising; due reviews also appear there.
                </p>
              </div>
            ) : (
              <>
                <div className={styles.questionMeta}>
                  <span className={styles.eyebrow}>
                    {DRILL_SOURCES[question.type].label} · level {question.level}{session.fromReview ? " · review" : ""}
                  </span>
                  <span role="timer" aria-live="off" className={overTarget ? styles.timerOver : styles.timer}>
                    <span className={styles.srOnly}>Time </span>{seconds(elapsed)} s
                    <span className={styles.timerTarget}> / target {seconds(question.speedTargetMs)} s</span>
                  </span>
                </div>
                <h2 id="drill-question" className={styles.prompt}>{question.prompt}</h2>
                <dl className={styles.facts}>
                  {question.facts.map(fact => {
                    const cards = factCards(question, fact.label);
                    return (
                      <div key={fact.label}>
                        <dt>{fact.label}</dt>
                        <dd>{cards ? <Cards cards={cards} /> : fact.value}</dd>
                      </div>
                    );
                  })}
                </dl>

                {question.answer.kind === "choice" ? (
                  <div className={styles.choices} role="group" aria-label="Your answer">
                    {question.answer.options.map((option, i) => {
                      const chosen = graded !== null && session.given === option.id;
                      return (
                        <button key={option.id} type="button" ref={i === 0 ? firstChoiceRef : undefined}
                          disabled={graded !== null} aria-pressed={chosen}
                          onClick={() => onSubmit(option.id)}>
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <form className={styles.answerForm} noValidate
                    onSubmit={e => { e.preventDefault(); onSubmit(draft); }}>
                    <label htmlFor="drill-answer">
                      Your answer{question.answer.kind === "percent" ? " (percent)" : ""}
                    </label>
                    <div className={styles.answerRow}>
                      <input id="drill-answer" ref={inputRef} type="text"
                        inputMode={question.answer.kind === "percent" ? "decimal" : "numeric"}
                        autoComplete="off" spellCheck={false} enterKeyHint="done"
                        value={draft} readOnly={graded !== null}
                        aria-invalid={session.invalid || undefined}
                        aria-describedby="drill-answer-hint drill-answer-error"
                        onChange={e => setDraft(e.target.value)} />
                      {question.answer.kind === "percent" && <span className={styles.unit} aria-hidden="true">%</span>}
                      <button type="submit" disabled={graded !== null}>Check</button>
                    </div>
                    <p id="drill-answer-hint" className={styles.hint}>{answerHint(question)} Press Enter to check.</p>
                    <p id="drill-answer-error" className={styles.error} aria-live="polite">
                      {session.invalid ? "That isn't a number this drill can read. Try 25, 25% or 1/4." : ""}
                    </p>
                  </form>
                )}

                <div aria-live="polite" aria-atomic="true">
                  {graded && (
                    <div className={styles.verdictBox}>
                      <p className={graded.correct ? styles.verdictRight : styles.verdictWrong}>
                        <strong>{graded.correct ? "Correct" : "Not quite"}</strong>
                        {" · "}{seconds(graded.elapsedMs)} s
                        {graded.fast ? " · within target" : graded.correct ? " · slower than target" : ""}
                      </p>
                      <p className={styles.compare}>
                        Exact: <strong>{exactText(question)}</strong>
                        {question.answer.kind !== "choice" && <> · You: {session.given}</>}
                        {question.answer.kind === "percent" && graded.error !== undefined && (
                          <> ({fmtPts(graded.error)} off; ±{question.answer.tolerance} accepted)</>
                        )}
                      </p>
                      {session.event && session.event !== "none" && (
                        <p className={styles.reviewNote}>{reviewMessage(session)}</p>
                      )}
                    </div>
                  )}
                </div>
                {graded && (
                  <div className={graded.correct ? styles.feedbackRight : styles.feedbackWrong}>
                    <dl className={styles.explanation}>
                      <div><dt>Formula</dt><dd>{question.explanation.formula}</dd></div>
                      <div><dt>Your numbers</dt><dd>{question.explanation.plugged}</dd></div>
                      <div><dt>Result</dt><dd>{question.explanation.result}</dd></div>
                      <div>
                        <dt>{question.explanation.shortcutApproximate ? "Shortcut (approximate)" : "Shortcut"}</dt>
                        <dd>{question.explanation.shortcut}</dd>
                      </div>
                      {question.explanation.note && <div><dt>Note</dt><dd>{question.explanation.note}</dd></div>}
                    </dl>
                    <button type="button" ref={nextRef} className={styles.next} onClick={goNext}>
                      Next question <kbd>N</kbd>
                    </button>
                  </div>
                )}
              </>
            )}
          </section>

          <aside className={styles.sidebar} aria-label="Practice stats">
            <h2 className={styles.sectionLabel}>Stats · {mode.kind === "type" ? DRILL_SOURCES[mode.type].label : "all drills"}</h2>
            <dl className={styles.stats}>
              <div><dt>Streak</dt><dd>{state.streak}</dd></div>
              <div><dt>Best streak</dt><dd>{state.bestStreak}</dd></div>
              <div><dt>Answered</dt><dd>{stats.attempts}</dd></div>
              <div><dt>Accuracy</dt><dd>{stats.attempts ? `${Math.round((stats.correct / stats.attempts) * 100)}%` : "–"}</dd></div>
              <div><dt>Within target</dt><dd>{stats.attempts ? `${Math.round((stats.fast / stats.attempts) * 100)}%` : "–"}</dd></div>
              <div><dt>Median correct time</dt><dd>{med === null ? "–" : `${seconds(med)} s`}</dd></div>
            </dl>

            <h2 className={styles.sectionLabel}>Review queue</h2>
            <p className={styles.small}>
              {state.review.length === 0
                ? "Empty. Missed answers, and correct ones slower than twice the target, land here."
                : `${state.review.length} saved · ${due} due now.`}
            </p>
            {queueByType.length > 0 && (
              <ul className={styles.queue}>
                {queueByType.map(([t, n]) => <li key={t}><span>{DRILL_SOURCES[t].label}</span><span>{n}</span></li>)}
              </ul>
            )}
            <details className={styles.details}>
              <summary>How review works</summary>
              <p>
                Each saved question sits in one of four boxes. A miss goes to box 1 and returns after {BOX_GAPS[1]} more
                questions; each correct review moves it up (gaps {BOX_GAPS[2]}, {BOX_GAPS[3]}, {BOX_GAPS[4]} questions)
                and a correct answer from box 4 removes it. A miss sends it back to box 1. Due items come before new
                questions in the matching drill.
              </p>
            </details>
            <p className={styles.small}>
              {saved ? "Progress is saved in this browser only." : "Progress can't be saved in this browser right now; this session still works."}
            </p>
            <button type="button" className={styles.clear} onClick={clearProgress}>Clear saved progress</button>
          </aside>
        </div>
      </div>
    </main>
  );
}

function readUrlOptions(search: string): { seed: number | null; mode: DrillMode; levelPin: LevelPin } {
  const params = new URLSearchParams(search);
  const drill = params.get("drill");
  const mode: DrillMode = isDrillType(drill) ? { kind: "type", type: drill } : drill === "review" ? { kind: "review" } : { kind: "mixed" };
  const level = params.get("level");
  const levelPin: LevelPin = level === "1" ? 1 : level === "2" ? 2 : level === "3" ? 3 : "auto";
  const rawSeed = params.get("seed");
  const seed = rawSeed !== null && /^\d{1,10}$/.test(rawSeed) && Number(rawSeed) <= 0xffffffff ? Number(rawSeed) : null;
  return { seed, mode, levelPin };
}

function reviewMessage(session: Session): string {
  const r = session.result;
  switch (session.event) {
    case "added":
      return r?.correct
        ? `Correct but slower than twice the target, so it is saved for review. It comes back after ${BOX_GAPS[1]} more questions.`
        : `Saved for review. It comes back after ${BOX_GAPS[1]} more questions.`;
    case "relapsed":
      return `Back to review box 1. It comes back after ${BOX_GAPS[1]} more questions.`;
    case "promoted": {
      const item = session.state.review.find(i => i.id === session.question?.id);
      return item ? `Moved up to review box ${item.box}. Next review in ${BOX_GAPS[item.box]} questions.` : "Moved up a review box.";
    }
    case "graduated":
      return "Learned: removed from the review queue.";
    default:
      return "";
  }
}

function Header() {
  return (
    <header className={styles.header}>
      <nav className={styles.nav} aria-label="Site navigation">
        <Link href="/">← Trainer</Link>
        <Link href="/solver">Push/fold explorer</Link>
        <Link href="/solver/lab">Explainable solver lab</Link>
      </nav>
      <p className={styles.eyebrow}>Instant poker math</p>
      <h1>Poker math drills</h1>
      <p className={styles.intro}>
        One question at a time: pot odds, minimum defence, bluff share, outs, and combo counting. Every
        answer is computed exactly; the explanation shows the formula with your numbers and the at-table
        shortcut, and says when a shortcut is only an approximation. The timer measures you and never
        cuts you off. Keys: <kbd>Enter</kbd> checks, <kbd>N</kbd> moves on.
      </p>
    </header>
  );
}
