"use client";

import { useEffect, useRef, useState } from "react";
import { comparisonActions, comparisonAnchor, comparisonField, riverValueBounds, riverValueChangeBounds,
  type RiverComparisonAnchor, type RiverComparisonChange, type RiverComparisonCommand, type RiverComparisonEvent,
  type RiverComparisonKind, type RiverComparisonPreflight, type RiverComparisonResult } from "@/lib/solver/river/lab/comparison";
import { BROWSER_STATE_LIMIT, riverActionLabel, riverHistoryLabel, type RiverLabDecision, type RiverLabResult } from "@/lib/solver/river/lab/model";
import styles from "./river.module.css";

const count = (n: number) => n.toLocaleString("en-US");
const signed = (n: number, places = 3) => {
  const rounded = Number(n.toFixed(places));
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(places)}`;
};
const percent = (n: number | null) => n === null ? "Not available" : `${(n * 100).toFixed(1)}%`;
const names = { range: "Opponent range", bets: "Opening bet sizes", stack: "Opponent stack" };
const help = {
  range: "Try keeping the same hands but giving one less weight: change AA to AA:25%, for example. Weights are relative. Both players learn a new strategy; this does not force the opponent to make mistakes.",
  bets: "Try removing one opening size. Whole-chip amounts are shared by both players. If you remove a bet in the pinned history, that decision will no longer exist.",
  stack: "Try fewer chips behind the opponent. Use a positive whole number. Your stack stays fixed; legal raises and returned uncalled chips may change.",
};
type Pin = { anchor: RiverComparisonAnchor; result: RiverLabResult; decision: RiverLabDecision };
type Progress = Extract<RiverComparisonEvent, { type: "progress" }>;

export default function RiverComparison({ result, decision, disabled, onBusyChange }: {
  result: RiverLabResult; decision: RiverLabDecision; disabled: boolean; onBusyChange(busy: boolean): void;
}) {
  const [pin, setPin] = useState<Pin | null>(null);
  const [change, setChange] = useState<RiverComparisonChange>({ kind: "range", value: "" });
  const [preflight, setPreflight] = useState<RiverComparisonPreflight | null>(null);
  const [completed, setCompleted] = useState<RiverComparisonResult | null>(null);
  const [busy, setBusy] = useState<"preflight" | "solve" | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("Change one assumption, then check the comparison size.");
  const [elapsed, setElapsed] = useState(0);
  const workerRef = useRef<Worker | null>(null);
  const requestId = useRef(0);
  const started = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const locked = disabled || busy !== null;

  useEffect(() => () => workerRef.current?.terminate(), []);
  useEffect(() => { if (error) inputRef.current?.focus(); }, [error]);
  useEffect(() => { if (completed) statusRef.current?.focus(); }, [completed]);
  useEffect(() => {
    if (busy !== "solve") return;
    const timer = setInterval(() => setElapsed(performance.now() - started.current), 250);
    return () => clearInterval(timer);
  }, [busy]);

  function finish() { setBusy(null); onBusyChange(false); }
  function fail() {
    workerRef.current?.terminate(); workerRef.current = null; finish();
    setError("The comparison worker stopped. Try checking the change again. Your pinned and completed results are still here.");
    setMessage("Comparison stopped.");
  }
  function post(command: RiverComparisonCommand) {
    try {
      if (!workerRef.current) {
        const worker = new Worker(new URL("./comparison.worker.ts", import.meta.url));
        worker.onmessage = (event: MessageEvent<RiverComparisonEvent>) => {
          const next = event.data;
          if (next.id !== requestId.current) return;
          if (next.type === "progress") { setProgress(next); return; }
          finish();
          if (next.type === "error") { setError(next.message); setMessage("Check the changed value."); }
          else if (next.type === "preflight") {
            setPreflight(next.preflight);
            setMessage(next.preflight.allowed ? "Comparison checked. Ready to solve the changed game." : "This pair exceeds the browser comparison limit.");
          } else if (next.type === "result") {
            setCompleted(next.comparison); setElapsed(next.comparison.result.elapsedMs ?? 0);
            setMessage("Comparison complete. The pinned result has not changed.");
          } else if (next.type === "cancelled") {
            setElapsed(next.elapsedMs);
            setMessage(`Comparison cancelled after ${count(next.iterations)} completed iterations. Any previous completed comparison is still shown.`);
            statusRef.current?.focus();
          }
        };
        worker.onerror = fail; worker.onmessageerror = fail; workerRef.current = worker;
      }
      workerRef.current.postMessage(command);
    } catch { fail(); }
  }
  function pinDecision() {
    if (locked) return;
    const anchor = comparisonAnchor(result, decision);
    setPin({ anchor, result, decision });
    setChange({ kind: "range", value: anchor.input[comparisonField(anchor, "range")] });
    setPreflight(null); setCompleted(null); setError(null); setProgress(null);
    setMessage("Decision pinned. Change one assumption, then check the comparison size.");
  }
  function edit(next: RiverComparisonChange) {
    setChange(next); setPreflight(null); setError(null);
    setMessage("Draft changed. Check its size before solving. Any completed comparison below still uses its saved settings.");
  }
  function start(type: "preflight" | "solve") {
    if (!pin || locked || (type === "solve" && !preflight?.allowed)) return;
    setBusy(type); onBusyChange(true); setError(null); setProgress(null);
    if (type === "preflight") setPreflight(null);
    started.current = performance.now(); setElapsed(0);
    setMessage(type === "preflight" ? "Counting both games in the background…" : "Solving the changed game. The starting strategy is reused.");
    post({ type, id: ++requestId.current, anchor: pin.anchor, change });
  }

  return <section id="river-comparison" className={styles.inset} aria-labelledby="comparison-heading" tabIndex={-1}>
    <h2 id="comparison-heading">Change one thing</h2>
    <p>What happens if the opponent has different hands, a bet size disappears, or their stack gets shorter?
      Pin the decision above, change one assumption, and compare the same hand at the same point.</p>
    <button type="button" disabled={locked} onClick={pinDecision}>{pin ? "Replace pin with inspected decision" : "Pin this decision"}</button>
    {disabled && <p className={styles.note}>Wait for the current lab task before starting a comparison.</p>}
    {!pin ? <p className={styles.note}>Choose a hand and history above, then pin it here. No extra solve is needed to keep the starting result.</p> : <>
      <div className={styles.comparisonPin}>
        <h3>Pinned starting point</h3>
        <p>{pin.anchor.decision.player === 0 ? "First" : "Second"} player · {pin.anchor.decision.privateCards.join(" ")}
          <br />{riverHistoryLabel(pin.anchor.decision.history)}</p>
        <p>Board: {pin.anchor.input.board} · pot {pin.anchor.input.pot} chips · {count(pin.result.quality.iteration)} iterations per game</p>
        <p className={styles.note}>The pin stays fixed even if you edit the main form or inspect another decision.</p>
        <details><summary>Pinned game settings</summary>
          <dl className={styles.settings}>
            <div><dt>First / second ranges</dt><dd>{pin.anchor.input.range0} / {pin.anchor.input.range1}</dd></div>
            <div><dt>First / second stacks</dt><dd>{pin.anchor.input.stack0} / {pin.anchor.input.stack1}</dd></div>
            <div><dt>Opening bets</dt><dd>{pin.anchor.input.bets}</dd></div>
            <div><dt>Raise-to amounts / limit</dt><dd>{pin.anchor.input.raises} / {pin.anchor.input.maxRaises}</dd></div>
            <div><dt>Starting result</dt><dd>{pin.result.source === "example" ? "Checked-in v3 example" : "Local custom calculation"}</dd></div>
          </dl>
        </details>
      </div>
      <form noValidate onSubmit={event => { event.preventDefault(); start("preflight"); }}>
        <fieldset disabled={locked}>
          <legend>One changed assumption</legend>
          <div className={styles.field}>
            <label htmlFor="comparison-kind">What changes?</label>
            <select id="comparison-kind" value={change.kind} onChange={event => {
              const kind = event.target.value as RiverComparisonKind;
              edit({ kind, value: pin.anchor.input[comparisonField(pin.anchor, kind)] });
            }}>
              <option value="range">Opponent range</option><option value="bets">Opening bet sizes</option><option value="stack">Opponent stack</option>
            </select>
          </div>
          <p className={styles.history}>Pinned {names[change.kind].toLowerCase()}: {pin.anchor.input[comparisonField(pin.anchor, change.kind)]}</p>
          <div className={styles.field}>
            <label htmlFor="comparison-value">Changed {names[change.kind].toLowerCase()}</label>
            <input ref={inputRef} id="comparison-value" value={change.value} maxLength={change.kind === "range" ? 2000 : 100}
              inputMode={change.kind === "stack" ? "numeric" : "text"} spellCheck={false} autoCapitalize="off" autoComplete="off"
              required aria-invalid={!!error} aria-describedby={`comparison-help${error ? " comparison-error" : ""}`}
              onChange={event => edit({ ...change, value: event.target.value })} />
            <small id="comparison-help">{help[change.kind]}</small>
            {error && <span id="comparison-error" role="alert" className={styles.error}>{error}</span>}
          </div>
          <p className={styles.note}>Everything else stays fixed, including the number of iterations. Both players adapt to the changed game.</p>
          <button type="submit">Check comparison size</button>
        </fieldset>
      </form>
      {preflight && <div className={styles.preflight}>
        <h3>Size of the two games</h3>
        <dl className={styles.metrics}>
          <div><dt>Compatible deals: pinned → changed</dt><dd>{count(preflight.before.counts.compatibleDeals)} → {count(preflight.after.counts.compatibleDeals)}</dd></div>
          <div><dt>Public states: pinned → changed</dt><dd>{count(preflight.before.counts.publicStatesPerDeal)} → {count(preflight.after.counts.publicStatesPerDeal)}</dd></div>
          <div><dt>Combined equivalent states</dt><dd>{count(preflight.totalStates)}</dd></div>
          <div><dt>Approximate new node visits</dt><dd>{count(preflight.after.approximateNodeVisits)}</dd></div>
        </dl>
        <p className={styles.notice}>{preflight.allowed ? "This pair fits" : "Too large for a browser comparison"}: the two games together must fit
          within {count(BROWSER_STATE_LIMIT)} equivalent states.</p>
        {!preflight.decisionAvailable && <p className={styles.notice}>The pinned decision does not exist in the changed game.
          You can compare whole-game results, but no replacement hand or history will be substituted.</p>}
        <p className={styles.note}>Work counts five tree traversals per new iteration, excluding preparation, grading, and explanations. It is not a time estimate.</p>
      </div>}
      <div className={styles.buttons}>
        <button type="button" className={styles.primary} disabled={locked || !preflight?.allowed} aria-describedby="comparison-solve-help"
          onClick={() => start("solve")}>Solve changed game</button>
        <p id="comparison-solve-help" className={styles.note}>{!preflight ? "Check the current change first. Editing it requires another check."
          : !preflight.allowed ? "Pin a smaller game or reduce the change to enable solving." : "One background solve, with the same iteration count as the pin. Equal work does not promise equal accuracy."}</p>
      </div>
      <div ref={statusRef} className={styles.status} tabIndex={-1}>
        <p role="status" aria-label="Comparison status">{message}</p>
        {busy === "solve" && <>
          <p>{progress?.phase === "explaining" ? "Building and matching explanations…" : progress?.phase === "grading" ? "Independently grading…"
            : progress?.phase === "solving" ? "Learning the changed strategy…" : "Preparing the comparison…"}</p>
          <label className={styles.field}>Comparison completed iterations
            <progress max={pin.result.quality.iteration} value={progress?.iterations ?? 0} />
          </label>
          <p>{count(progress?.iterations ?? 0)} / {count(pin.result.quality.iteration)} iterations · {(elapsed / 1000).toFixed(1)} seconds elapsed</p>
          <p>{progress?.quality ? `Last measured exploitability: ${progress.quality.exploitability.toFixed(6)} chips at iteration ${progress.quality.iteration}.`
            : "Exploitability has not been measured yet."}</p>
          <p className={styles.note}>Completed iterations are not a convergence percentage. Grading and explanations take extra time. Other lab tasks wait until this finishes.</p>
          <button type="button" onClick={() => {
            setMessage("Cancellation requested. Waiting for the current background task to yield…");
            post({ type: "cancel", id: requestId.current });
          }}>Cancel comparison</button>
        </>}
      </div>
      {completed && <ComparisonResult pin={pin} completed={completed} />}
    </>}
  </section>;
}

function ComparisonResult({ pin, completed }: { pin: Pin; completed: RiverComparisonResult }) {
  const after = completed.decision;
  const player = pin.anchor.decision.player;
  const bounds = riverValueChangeBounds(pin.result.quality, completed.result.quality, player);
  const overlapsAtDisplayPrecision = Math.floor(bounds.low * 1e6) <= 0 && Math.ceil(bounds.high * 1e6) >= 0;
  // Display intervals outwards, rather than rounding away part of the mathematical bound.
  const interval = (b: { low: number; high: number }) =>
    `${signed(Math.floor(b.low * 1e6) / 1e6, 6)} to ${signed(Math.ceil(b.high * 1e6) / 1e6, 6)} chips`;
  return <section className={styles.inset} aria-labelledby="comparison-result-heading">
    <h3 id="comparison-result-heading">Saved comparison</h3>
    <p className={styles.comparisonChange}>{names[completed.change.kind]}: {pin.anchor.input[comparisonField(pin.anchor, completed.change.kind)]}
      <br />→ {completed.change.value}</p>
    <p>Changed game completed in {((completed.result.elapsedMs ?? 0) / 1000).toFixed(2)} seconds, including checks and explanations.</p>
    <div className={styles.comparisonPair}>
      {[{ name: "Pinned", result: pin.result }, { name: "Changed", result: completed.result }].map(side => <div key={side.name}>
        <h4>{side.name} strategy quality</h4>
        <p>Exploitability: {side.result.quality.exploitability.toFixed(6)} chips</p>
        <p className={styles.note}>Best-response gains: {side.result.quality.gains.map(gain => gain.toFixed(6)).join(" / ")} chips (first / second player)
          <br />{count(side.result.quality.iteration)} iterations</p>
      </div>)}
    </div>
    <p className={styles.note}>These are approximate strategies for two specific finite games—not exact GTO.
      Different frequencies can both be good. Whole-game exploitability is not an error bar for a particular hand.</p>
    {!after ? <p className={styles.notice}>No matching decision: this history is no longer legal, or your pinned hand has no compatible opponent deal.
      No different decision has been substituted.</p> : <>
      {(pin.decision.facts.offPath || after.facts.offPath) && <p className={styles.notice}>Off path in at least one strategy: this decision is essentially unreached.
        Its conditional values and differences are unavailable, not zero.</p>}
      <p>Chance of reaching this exact hand and history: {(pin.decision.facts.reachProbability * 100).toPrecision(3)}%
        {" → "}{(after.facts.reachProbability * 100).toPrecision(3)}%.</p>
      {(pin.decision.facts.reachProbability < 0.001 || after.facts.reachProbability < 0.001) && <p className={styles.notice}>
        Rare decision: at least one strategy reaches this hand and history in fewer than 1 in 1,000 deals.
        A small whole-game exploitability can hide large errors here. Do not read these frequencies as a reliable recommendation.</p>}
      <p>Call price: {pin.decision.callCost} → {after.callCost} chips. Decision pot: {pin.decision.facts.pot} → {after.facts.pot} chips.</p>
      {comparisonActions(pin.decision, after).map(row => <section key={row.action} className={styles.comparisonAction} aria-label={`Comparison: ${riverActionLabel(row.action)}`}>
        <h4>{riverActionLabel(row.action)}</h4>
        <div className={styles.comparisonPair}>
          {[{ name: "Pinned", fact: row.before, offPath: pin.decision.facts.offPath },
            { name: "Changed", fact: row.after, offPath: after.facts.offPath }].map(side => <div key={side.name}>
            <p><strong>{side.name}</strong></p>
            {!side.fact ? <p>Not legal here</p> : side.offPath ? <p>Off path — unknown</p> : <dl>
              <dt>How often</dt><dd>{percent(side.fact.frequency)}</dd>
              <dt>Value from this choice</dt><dd>{side.fact.expectedAdditionalValue === null ? "Not available" : `${signed(side.fact.expectedAdditionalValue)} chips`}</dd>
            </dl>}
          </div>)}
        </div>
        <p>Change in frequency: {row.frequencyDifference === null ? "Not comparable" : `${signed(row.frequencyDifference, 1)} percentage points`}
          <br />Change in value: {row.valueDifference === null ? "Not comparable" : `${signed(row.valueDifference)} chips`}</p>
        <details><summary>Folds and showdown share for {riverActionLabel(row.action)}</summary>
          <p>Opponent folds immediately: {row.before ? percent(row.before.immediateOpponentFoldProbability) : "Not legal"}
            {" → "}{row.after ? percent(row.after.immediateOpponentFoldProbability) : "Not legal"}</p>
          <p>Share at showdown, if reached: {row.before ? percent(row.before.showdownEquity) : "Not legal"}
            {" → "}{row.after ? percent(row.after.showdownEquity) : "Not legal"}</p>
          <p className={styles.note}>Conditional on this action and each saved continuation. A fold or an unreached showdown has no showdown share to report.</p>
        </details>
      </section>)}
      <p className={styles.note}>Values mean taking the named action now, then following that game’s saved strategy.
        The opponent’s possible hands and both players’ later choices can change. A value difference here is not a guaranteed equilibrium gain.</p>
    </>}
    <details><summary>What can we conclude about the whole game?</summary>
      <p>Before either player sees private cards, the pinned player’s equilibrium value is bounded by:</p>
      <p>Pinned: {interval(riverValueBounds(pin.result.quality, player))}<br />Changed: {interval(riverValueBounds(completed.result.quality, player))}</p>
      <p>Changed minus pinned: {interval(bounds)}.</p>
      <p>{overlapsAtDisplayPrecision ? "The bounds include zero at the displayed precision. We do not claim which game has the higher equilibrium value for this player."
        : "The bounds exclude zero, indicating a whole-game value difference for this player under these rules and ranges, subject to floating-point arithmetic."}</p>
      <p className={styles.note}>These bounds use legal best responses: lower = saved value minus the opponent’s gain; upper = saved value plus this player’s gain.
        They are not statistical confidence intervals, and do not bound a selected hand or action. They describe different games with their own starting ranges, not profit from changing an opponent in real play.</p>
    </details>
  </section>;
}
