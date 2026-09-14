"use client";

import { useState } from "react";
import Link from "next/link";
import type { LeducActionFact, LeducOutcomeBreakdown } from "@/lib/solver/toy/leduc-explain";
import type { LeducLabData, LeducLessonId } from "@/lib/solver/toy/teaching";
import type { LeducAction } from "@/lib/solver/toy/leduc";
import styles from "./lab.module.css";

const ACTION_LABELS: Readonly<Record<LeducAction, string>> = {
  check: "Check",
  bet: "Bet",
  fold: "Fold",
  call: "Call",
  raise: "Raise",
};

const OUTCOME_LABELS: ReadonlyArray<readonly [keyof LeducOutcomeBreakdown, string]> = [
  ["opponentFolds", "Opponent folds"],
  ["playerFolds", "You fold now or later"],
  ["showdownWin", "Win at showdown"],
  ["showdownSplit", "Split at showdown"],
  ["showdownLoss", "Lose at showdown"],
];

function percent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

function signedChips(value: number | null, digits = 3): string {
  if (value === null) return "Not available";
  const rounded = Math.abs(value) < 0.5 * 10 ** -digits ? 0 : value;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(digits)}`;
}

function actionStatus(action: LeducActionFact): string {
  if (action.differenceFromBest === null) return "No reliable value";
  if (action.differenceFromBest < 1e-12) return "Highest measured value";
  return `${action.differenceFromBest.toFixed(4)} chips behind`;
}

function FrequencyBar({ value }: Readonly<{ value: number }>) {
  return (
    <span className={styles.meter} aria-hidden="true">
      <span className={styles.meterFill} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </span>
  );
}

export default function LeducLab({ data }: Readonly<{ data: LeducLabData }>) {
  const [lessonId, setLessonId] = useState<LeducLessonId>("mix");
  const initialLesson = data.lessons[0];
  const lesson = data.lessons.find(candidate => candidate.id === lessonId) ?? initialLesson;
  const [selectedAction, setSelectedAction] = useState<LeducAction>(initialLesson.featuredAction);
  const action = lesson.actions.find(candidate => candidate.action === selectedAction) ??
    lesson.actions.find(candidate => candidate.action === lesson.featuredAction) ??
    lesson.actions[0];
  const maximumGain = data.quality.maximumBestResponseGain;

  const chooseLesson = (id: LeducLessonId): void => {
    const nextLesson = data.lessons.find(candidate => candidate.id === id);
    if (!nextLesson) return;
    setLessonId(id);
    setSelectedAction(nextLesson.featuredAction);
  };

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <nav className={styles.nav} aria-label="Solver navigation">
            <Link href="/">← Trainer</Link>
            <Link href="/solver">Push/fold explorer</Link>
          </nav>
          <p className={styles.eyebrow}>Explainable solver lab</p>
          <h1>Why can two poker choices both make sense?</h1>
          <p className={styles.intro}>
            This tiny poker game lets us check every possible deal and every legal action.
            That makes it a safe place to learn the logic behind a strategy—not just copy a chart.
          </p>
          <div className={styles.scope}>
            <strong>Toy poker</strong>
            <span>2 players</span>
            <span>6 cards</span>
            <span>fixed bets</span>
          </div>
        </header>

        <div className={styles.layout}>
          <aside className={styles.sidebar} aria-label="Lab guide">
            <section className={styles.rules} aria-labelledby="rules-title">
              <p className={styles.sectionLabel}>The whole game</p>
              <h2 id="rules-title">Small enough to inspect</h2>
              <div className={styles.deck} aria-label="Deck: two jacks, two queens, and two kings">
                {(["J", "J", "Q", "Q", "K", "K"] as const).map((rank, index) => (
                  <span key={`${rank}-${index}`}>{rank}</span>
                ))}
              </div>
              <ul>
                <li>Each player pays 1 chip and gets one private card.</li>
                <li>Bet once, reveal one public card, then bet once more.</li>
                <li>Matching the public card makes a pair. Otherwise, high card wins.</li>
              </ul>
              <details>
                <summary>Why use a toy game?</summary>
                <p>
                  Ordinary hold&apos;em is enormous. Here, the same ideas—ranges, bluffs, value,
                  and mixed choices—fit into a game we can solve and independently check.
                </p>
              </details>
            </section>

            <fieldset className={styles.lessonPicker}>
              <legend>Choose one idea</legend>
              {data.lessons.map(candidate => (
                <button
                  type="button"
                  key={candidate.id}
                  aria-pressed={candidate.id === lesson.id}
                  onClick={() => chooseLesson(candidate.id)}
                >
                  <span>{candidate.label}</span>
                  <small>{candidate.title}</small>
                </button>
              ))}
            </fieldset>

            <section className={styles.reliability} aria-labelledby="reliability-title">
              <p className={styles.sectionLabel}>How trustworthy is it?</p>
              <h2 id="reliability-title">Measured, not perfect</h2>
              <p>
                Against this saved strategy, a perfect response can gain at most about{" "}
                <strong>{maximumGain.toFixed(4)} chip per hand</strong>.
              </p>
              <details>
                <summary>How we checked that</summary>
                <p>
                  We solved the full game, graded it with a separate best-response checker,
                  compared its value with a pinned open-source result, and saved hashes of both
                  the game rules and the result.
                </p>
                <dl className={styles.provenance}>
                  <div><dt>Iterations</dt><dd>{data.provenance.iterations.toLocaleString()}</dd></div>
                  <div><dt>Rules hash</dt><dd>{data.provenance.rulesFingerprint.slice(0, 12)}…</dd></div>
                  <div><dt>Result hash</dt><dd>{data.provenance.payloadHash.slice(0, 12)}…</dd></div>
                </dl>
              </details>
            </section>
          </aside>

          <article className={styles.lesson} aria-labelledby="lesson-title">
            <header className={styles.lessonHeader}>
              <p className={styles.sectionLabel}>{lesson.label}</p>
              <h2 id="lesson-title">{lesson.question}</h2>
              <p>{lesson.title}</p>
            </header>

            <section className={styles.situation} aria-labelledby="situation-title">
              <div>
                <p className={styles.sectionLabel} id="situation-title">The situation</p>
                <p className={styles.actor}>{lesson.situation.actor}</p>
                <p className={styles.history}>{lesson.situation.history}</p>
              </div>
              <div className={styles.cards}>
                <div>
                  <span>Your card</span>
                  <strong>{lesson.situation.privateRank}</strong>
                </div>
                <div data-empty={lesson.situation.boardRank === null ? "true" : "false"}>
                  <span>Public card</span>
                  <strong>{lesson.situation.boardRank ?? "—"}</strong>
                </div>
              </div>
              <dl className={styles.potFacts}>
                <div><dt>Pot now</dt><dd>{lesson.situation.pot}</dd></div>
                <div><dt>Cost to continue</dt><dd>{lesson.situation.toCall}</dd></div>
              </dl>
            </section>

            <section className={styles.shortAnswer} aria-labelledby="answer-title">
              <p className={styles.sectionLabel} id="answer-title">The short answer</p>
              <p>{lesson.answer}</p>
            </section>

            <section className={styles.choices} aria-labelledby="choices-title">
              <div className={styles.sectionHeading}>
                <div>
                  <p className={styles.sectionLabel}>The saved strategy</p>
                  <h3 id="choices-title">How often it uses each choice</h3>
                </div>
                <p>Choose an action to inspect what happens next.</p>
              </div>
              <div className={styles.actionGrid}>
                {lesson.actions.map(candidate => (
                  <button
                    type="button"
                    key={candidate.action}
                    aria-pressed={candidate.action === action.action}
                    className={styles.actionCard}
                    onClick={() => setSelectedAction(candidate.action)}
                  >
                    <span className={styles.actionTopline}>
                      <strong>{ACTION_LABELS[candidate.action]}</strong>
                      <b>{percent(candidate.frequency)}</b>
                    </span>
                    <FrequencyBar value={candidate.frequency} />
                    <small>{actionStatus(candidate)}</small>
                  </button>
                ))}
              </div>
              <p className={styles.frequencyNote}>
                These are approximate frequencies from the saved solution. A higher percentage
                does not turn a close choice into the only correct choice.
              </p>
            </section>

            {lesson.price && (
              <section className={styles.priceLesson} aria-labelledby="price-title">
                <p className={styles.sectionLabel}>The call math</p>
                <h3 id="price-title">Does the hand win often enough for this price?</h3>
                <div className={styles.equation}>
                  <div className={styles.equationPart}>
                    <span>Minimum needed</span>
                    <strong>{lesson.price.callCost} ÷ {lesson.price.finalPot} = {percent(lesson.price.minimumShare)}</strong>
                    <p>
                      You risk {lesson.price.callCost} to compete for a final pot of {lesson.price.finalPot}.
                    </p>
                  </div>
                  <span className={styles.compare} aria-hidden="true">vs.</span>
                  <div className={styles.equationPart}>
                    <span>Estimated share</span>
                    <strong>{percent(lesson.price.estimatedShare)}</strong>
                    <p>
                      This comes from every hidden rank still possible after the actions you saw.
                    </p>
                  </div>
                </div>
                <p className={styles.priceResult}>
                  The estimate is {percent(Math.abs(lesson.price.cushion))} {lesson.price.cushion >= 0 ? "above" : "below"}
                  {" "}the minimum. That is close enough to treat as a boundary, not a command.
                </p>
              </section>
            )}

            <section className={styles.why} aria-labelledby="why-title">
              <p className={styles.sectionLabel}>Why</p>
              <h3 id="why-title">Follow the evidence</h3>
              <ol>
                {lesson.teachingPoints.map(point => <li key={point}>{point}</li>)}
              </ol>
            </section>

            <div className={styles.evidenceGrid}>
              <section className={styles.range} aria-labelledby="range-title">
                <p className={styles.sectionLabel}>Opponent&apos;s possible card</p>
                <h3 id="range-title">Actions change the range</h3>
                <p>
                  These chances use only what you can know: your card, the public card, and the actions so far.
                </p>
                <div className={styles.rangeRows}>
                  {lesson.opponentRanks.map(rank => {
                    const probability = rank.probability ?? 0;
                    return (
                      <div className={styles.rangeRow} key={rank.rank}>
                        <strong>{rank.rank}</strong>
                        <FrequencyBar value={probability} />
                        <span>{percent(probability)}</span>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className={styles.outcomes} aria-labelledby="outcomes-title">
                <p className={styles.sectionLabel}>After choosing {ACTION_LABELS[action.action]}</p>
                <h3 id="outcomes-title">How the hand ends</h3>
                <p>After this choice, both players return to the saved strategy.</p>
                <div className={styles.outcomeRows}>
                  {OUTCOME_LABELS.map(([key, label]) => {
                    const probability = action.outcomes[key] ?? 0;
                    return (
                      <div className={styles.outcomeRow} key={key}>
                        <span>{label}</span>
                        <strong>{percent(probability)}</strong>
                      </div>
                    );
                  })}
                </div>
                <dl className={styles.valueReadout}>
                  <div>
                    <dt>Expected chip change from now</dt>
                    <dd>{signedChips(action.expectedAdditionalValue)}</dd>
                  </div>
                  <div>
                    <dt>Whole-hand result, including chips already paid</dt>
                    <dd>{signedChips(action.expectedValue)}</dd>
                  </div>
                </dl>
              </section>
            </div>

            <details className={styles.method}>
              <summary>Exactly what these numbers mean</summary>
              <div>
                <p>
                  An action value is the average result if this situation repeats, you choose that
                  action once, and then both players follow the saved strategy. It is not a promise
                  about one hand.
                </p>
                <p>
                  “From now” leaves chips already paid in the past. “Whole hand” counts the ante and
                  every earlier bet. The difference between two actions is the same either way.
                </p>
                <p>
                  This is Leduc poker, a two-player teaching game. Its percentages do not transfer
                  directly to a normal hold&apos;em table.
                </p>
              </div>
            </details>
          </article>
        </div>

        <footer className={styles.footer}>
          <p>Built to show the reasoning, the uncertainty, and the limits—not just the answer.</p>
          <Link href="/solver">Explore the separate push/fold model →</Link>
        </footer>
      </div>
    </main>
  );
}
