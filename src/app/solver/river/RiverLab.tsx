"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AVERAGING_DELAY, BROWSER_STATE_LIMIT, EXAMPLE_INPUT, SMALL_INPUT,
  type RiverLabCommand, type RiverLabErrors, type RiverLabEvent, type RiverLabInput,
  type RiverLabPreflight, type RiverLabResult } from "@/lib/solver/river/lab/model";
import DecisionInspector from "./DecisionInspector";
import styles from "./river.module.css";

const count = (value: number) => value.toLocaleString("en-US");
type Progress = Extract<RiverLabEvent, { type: "progress" }>;

export default function RiverLab({ example }: { example: RiverLabResult }) {
  const [input, setInput] = useState<RiverLabInput>({ ...EXAMPLE_INPUT });
  const [errors, setErrors] = useState<RiverLabErrors>({});
  const [preflight, setPreflight] = useState<RiverLabPreflight | null>(null);
  const [result, setResult] = useState(example);
  const [decision, setDecision] = useState(example.initialDecision);
  const [selectedKey, setSelectedKey] = useState(example.initialDecision.facts.informationSet);
  const [busy, setBusy] = useState<"preflight" | "solve" | "inspect" | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [message, setMessage] = useState("The checked-in example is ready to explore.");
  const workerRef = useRef<Worker | null>(null);
  const requestId = useRef(0);
  const displayedDecisionKey = useRef(example.initialDecision.facts.informationSet);
  const started = useRef(0);
  const statusRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => { workerRef.current?.terminate(); }, []);
  useEffect(() => {
    if (!Object.keys(errors).length) return;
    // Focus after React has re-enabled the form and committed the associated error text.
    const firstField = Object.keys(errors).find(key => key !== "form");
    if (firstField) document.getElementById(`river-${firstField}`)?.focus();
    else statusRef.current?.focus();
  }, [errors]);
  useEffect(() => {
    if (busy !== "solve") return;
    const timer = setInterval(() => setElapsed(performance.now() - started.current), 250);
    return () => clearInterval(timer);
  }, [busy]);

  function failWorker() {
    workerRef.current?.terminate();
    workerRef.current = null;
    setBusy(null);
    setSelectedKey(displayedDecisionKey.current);
    setErrors({ form: "The background worker could not finish. Try checking the small game again. The checked-in example remains available." });
    setMessage("Background task stopped.");
  }

  function post(command: RiverLabCommand) {
    try {
      if (!workerRef.current) {
        const worker = new Worker(new URL("./river.worker.ts", import.meta.url));
        worker.onmessage = (event: MessageEvent<RiverLabEvent>) => {
          const next = event.data;
          if (next.id !== requestId.current) return;
          if (next.type === "progress") { setProgress(next); return; }
          setBusy(null);
          if (next.type === "error") {
            setErrors(next.errors);
            setSelectedKey(displayedDecisionKey.current);
            setMessage("Check the errors below before continuing.");
          } else if (next.type === "preflight") {
            setPreflight(next.preflight);
            setMessage(next.preflight.allowed ? "Game size checked. Ready for a browser solve." : "This game exceeds the browser teaching limit.");
          } else if (next.type === "result") {
            setResult(next.result);
            setDecision(next.result.initialDecision);
            displayedDecisionKey.current = next.result.initialDecision.facts.informationSet;
            setSelectedKey(next.result.initialDecision.facts.informationSet);
            setElapsed(next.result.elapsedMs ?? 0);
            setMessage("Custom solve complete. Its independent grade and decisions are ready below.");
            statusRef.current?.focus();
          } else if (next.type === "decision") {
            setDecision(next.decision);
            displayedDecisionKey.current = next.decision.facts.informationSet;
            setMessage("Decision loaded.");
          } else if (next.type === "cancelled") {
            setElapsed(next.elapsedMs);
            setMessage(`Cancelled after ${count(next.iterations)} completed iterations. The previous result is still displayed.`);
          }
        };
        worker.onerror = failWorker;
        worker.onmessageerror = failWorker;
        workerRef.current = worker;
      }
      workerRef.current.postMessage(command);
    } catch { failWorker(); }
  }

  function update(field: keyof RiverLabInput, value: string) {
    setInput(previous => ({ ...previous, [field]: value }));
    setPreflight(null);
    setErrors({});
  }

  function preset(next: RiverLabInput) {
    setInput({ ...next }); setPreflight(null); setErrors({}); setProgress(null);
    setMessage("Inputs filled. Check the game size before solving. The displayed result has not changed.");
  }

  function check() {
    setErrors({}); setPreflight(null); setBusy("preflight");
    setMessage("Counting compatible deals and public states in the background…");
    post({ type: "preflight", id: ++requestId.current, input });
  }

  function solve() {
    if (!preflight?.allowed || busy) return;
    started.current = performance.now(); setElapsed(0); setProgress(null); setErrors({});
    setBusy("solve"); setMessage("Solving in the background. You can cancel at any time.");
    post({ type: "solve", id: ++requestId.current, input });
  }

  function showExample() {
    setResult(example); setDecision(example.initialDecision);
    displayedDecisionKey.current = example.initialDecision.facts.informationSet;
    setSelectedKey(example.initialDecision.facts.informationSet);
    setMessage("The checked-in example is ready to explore."); setErrors({});
  }

  function field(name: keyof RiverLabInput, label: string, help: string, numeric = false) {
    return <div className={styles.field}>
      <label htmlFor={`river-${name}`}>{label}</label>
      <input id={`river-${name}`} name={name} value={input[name]} disabled={busy !== null}
        inputMode={numeric ? "numeric" : "text"} autoCapitalize="off" autoComplete="off" spellCheck={false}
        maxLength={name.startsWith("range") ? 2000 : 100} required={name !== "raises"}
        aria-invalid={!!errors[name]} aria-describedby={`river-${name}-help${errors[name] ? ` river-${name}-error` : ""}`}
        onChange={event => update(name, event.target.value)} />
      <small id={`river-${name}-help`}>{help}</small>
      {errors[name] && <span id={`river-${name}-error`} className={styles.error}>{errors[name]}</span>}
    </div>;
  }

  return <main className={styles.page}>
    <div className={styles.shell}>
      <a className={styles.skip} href="#river-result">Skip to the result</a>
      <header className={styles.header}>
        <nav className={styles.nav} aria-label="Solver navigation">
          <Link href="/">← Poker Face</Link><Link href="/solver/lab">Leduc lab</Link><Link href="/solver">Push/fold explorer</Link>
        </nav>
        <p className={styles.eyebrow}>Two players · five board cards · one betting round</p>
        <h1>River Solver Lab</h1>
        <p className={styles.intro}>See what makes a river choice work. Start with a checked example, or build a small game of your own.</p>
        <p className={styles.scope}>An approximate strategy for this specific finite game. It is not universal or exact GTO.
          Every compatible deal and showdown is counted exactly; the strategy is learned over a limited number of iterations.</p>
        <div className={styles.nav}><a href="#river-result">Explore the result ↓</a><a href="#setup-heading">Customize a game ↓</a></div>
      </header>

      <div className={styles.layout}>
        <aside className={styles.setup} aria-labelledby="setup-heading">
          <h2 id="setup-heading">Set up a game</h2>
          <p>“Position” here means who acts first and who acts second. The first player acts first on the river;
            after each action, the other player responds.</p>
          <div className={styles.buttons}>
            <button type="button" disabled={busy !== null} onClick={showExample}>View checked-in example</button>
            <button type="button" disabled={busy !== null} onClick={() => preset(SMALL_INPUT)}>Fill small custom game</button>
          </div>
          <form noValidate onSubmit={event => { event.preventDefault(); if (!busy) check(); }}>
            <fieldset disabled={busy !== null}>
              <legend>Cards and ranges</legend>
              {field("board", "Five board cards", "Ranks: 2–9, T, J, Q, K, A. Suits: c clubs, d diamonds, h hearts, s spades.")}
              {field("range0", "First player's range", "Example: AA AQs 7h6h:50%")}
              {field("range1", "Second player's range", "Hands are separated by spaces or commas.")}
              <details><summary>How to write a range</summary>
                <p>AA means every pair of aces. AQs means ace–queen of the same suit; AQo means different suits;
                  AQ includes both. AsQh names two exact cards.</p>
                <p>Add :50% or :0.5 to give a hand half the weight of a full-weight hand. These are relative weights,
                  not a promise of playing that percentage of all hands. Do not overlap entries. Plus signs and intervals are not supported.</p>
                <p>Board cards and overlapping private cards are removed automatically. Each range may contain at most 128 combinations after board removal.</p>
              </details>
            </fieldset>
            <fieldset disabled={busy !== null}>
              <legend>Chips and available choices</legend>
              {field("pot", "Starting pot", "Even whole chips. Each player has already put in half.", true)}
              <div className={styles.pickers}>
                {field("stack0", "First player's stack", "Chips left to bet.", true)}
                {field("stack1", "Second player's stack", "Chips left to bet.", true)}
              </div>
              {field("bets", "Opening bet sizes", "1–5 whole-chip amounts, such as 50 100 200. Shared by both players.")}
              {field("raises", "Raise-to amounts", "Total chips committed on this river, not chips added. Only legal sizes are offered.")}
              <div className={styles.field}>
                <label htmlFor="river-maxRaises">Raises after the opening bet</label>
                <select id="river-maxRaises" value={input.maxRaises} aria-describedby="river-raise-help" onChange={event => update("maxRaises", event.target.value)}>
                  <option value="0">0 — call or fold to a bet</option><option value="1">1 — allow a raise</option><option value="2">2 — allow a raise and re-raise</option>
                </select>
                <small id="river-raise-help">Minimum raises, short all-ins, and returned uncalled chips follow the v3 rules. Unlisted sizes are unavailable.</small>
              </div>
              {field("iterations", "Solver iterations", "21–2000 passes through the learning loop. More work can improve the strategy; quality need not improve at every checkpoint.", true)}
            </fieldset>
            <button className={styles.primary} type="submit" disabled={busy !== null}>Check game size</button>
          </form>

          <section className={styles.preflight} aria-labelledby="preflight-heading">
            <h3 id="preflight-heading">Before you solve</h3>
            {preflight ? <>
              <dl className={styles.metrics}>
                <div><dt>Compatible deals</dt><dd>{count(preflight.counts.compatibleDeals)}</dd></div>
                <div><dt>Public states</dt><dd>{count(preflight.counts.publicStatesPerDeal)}</dd></div>
                <div><dt>Equivalent states</dt><dd>{count(preflight.counts.projectedFullStates)}</dd></div>
                <div><dt>Approximate node visits</dt><dd>{count(preflight.approximateNodeVisits)}</dd></div>
              </dl>
              <p>Board-blocked hands removed: {preflight.blockedCombos[0]} first-player, {preflight.blockedCombos[1]} second-player.</p>
              <p className={styles.note}>Equivalent states = 1 + deals × public states. Approximate work counts five tree traversals per iteration;
                it excludes grading and explanations and is not a time estimate.</p>
              <p className={styles.notice}>{preflight.allowed ? `Within the ${count(BROWSER_STATE_LIMIT)}-state browser teaching limit.`
                : `Too large for the browser: the limit is ${count(BROWSER_STATE_LIMIT)} states. Reduce ranges or available sizes. Larger games remain available through the local v3 script.`}</p>
            </> : <p>Check the game size to see exact deal and state counts, estimated work, and whether it fits the browser limit.</p>}
            <button type="button" className={styles.primary} disabled={!preflight?.allowed || busy !== null}
              aria-describedby="solve-help" onClick={solve}>Solve in browser</button>
            <p id="solve-help" className={styles.note}>{!preflight ? "Check the current inputs first. Changing any input requires another check."
              : !preflight.allowed ? "Solving is disabled because this game exceeds the browser limit." : "Runs on this device in a background worker. Speed depends on your device."}</p>
          </section>
          <div ref={statusRef} tabIndex={-1} className={styles.status}>
            <p role="status">{message}</p>
            {Object.keys(errors).length > 0 && <div role="alert" className={styles.error}>
              {errors.form ?? "Some inputs need attention. Each error is shown beside its field."}
            </div>}
            {busy === "solve" && <>
              <p>{progress?.phase === "explaining" ? "Building explanations…" : progress?.phase === "grading" ? "Independently grading the strategy…"
                : progress?.phase === "solving" ? "Learning the strategy…" : "Preparing the game…"}</p>
              <label className={styles.field}>Completed iterations
                <progress max={progress?.total || Number(input.iterations)} value={progress?.iterations ?? 0} />
              </label>
              <p>{count(progress?.iterations ?? 0)} / {count(progress?.total || Number(input.iterations))} iterations · {(elapsed / 1000).toFixed(1)} seconds elapsed</p>
              <p>{progress?.quality ? `Last measured exploitability: ${progress.quality.exploitability.toFixed(6)} chips at iteration ${progress.quality.iteration}.`
                : "Exploitability has not been measured yet."}</p>
              <p className={styles.note}>The bar counts completed iterations, not convergence or remaining time. Grading and explanations add work after the last iteration.</p>
              <button type="button" onClick={() => {
                setMessage("Cancellation requested. Stopping after the current background task…");
                post({ type: "cancel", id: requestId.current });
              }}>Cancel solve</button>
            </>}
          </div>
        </aside>

        <article id="river-result" className={styles.result} tabIndex={-1} aria-label="River result">
          <section className={styles.quality} aria-labelledby="result-heading">
            <p className={styles.eyebrow}>{result.source === "example" ? "Checked-in example · v3" : "Your custom result · v3"}</p>
            <h2 id="result-heading">A strategy you can inspect</h2>
            <p>Board: <strong>{result.request.board.join(" ")}</strong> · starting pot {result.request.committed[0] * 2} chips</p>
            <p className={styles.note}>This result belongs to the settings below. Editing the form does not change it.</p>
            <dl className={styles.metrics}>
              <div><dt>Exploitability</dt><dd>{result.quality.exploitability.toFixed(6)} chips</dd></div>
              <div><dt>Iterations</dt><dd>{count(result.quality.iteration)}</dd></div>
              <div><dt>First player’s best-response gain</dt><dd>{result.quality.gains[0].toFixed(6)} chips</dd></div>
              <div><dt>Second player’s best-response gain</dt><dd>{result.quality.gains[1].toFixed(6)} chips</dd></div>
            </dl>
            <p>A best response is the best legal strategy against the saved opponent strategy, without seeing hidden cards.
              Exploitability is the average of the two gains above. Lower means less room to improve by changing strategy in this game.</p>
            {result.elapsedMs !== null && <p>Completed in {(result.elapsedMs / 1000).toFixed(2)} seconds, including grading and explanations.</p>}
            <details>
              <summary>Result settings and reproducibility</summary>
              <dl className={styles.settings}>
                <div><dt>First range</dt><dd>{result.request.rangeText[0]}</dd></div>
                <div><dt>Second range</dt><dd>{result.request.rangeText[1]}</dd></div>
                <div><dt>Stacks behind</dt><dd>{result.request.stackBehind.join(" / ")}</dd></div>
                <div><dt>Opening bets</dt><dd>{result.request.openingBetSizes.join(", ")}</dd></div>
                <div><dt>Raise-to amounts</dt><dd>{result.request.maxRaises === 0 ? "Unused (no raises)" : result.request.raiseToSizes.join(", ")}</dd></div>
                <div><dt>Raise limit</dt><dd>{result.request.maxRaises}</dd></div>
                <div><dt>Deals / public states</dt><dd>{count(result.preflight.counts.compatibleDeals)} / {count(result.preflight.counts.publicStatesPerDeal)}</dd></div>
                <div><dt>First player’s net value</dt><dd>{result.quality.value[0].toFixed(9)} chips from hand start</dd></div>
              </dl>
              <p>Alternating CFR+, version 1, with linear averaging after {AVERAGING_DELAY} iterations. The same inputs and iteration count reproduce the numeric result;
                wall-clock time varies. Exact enumeration is used for all compatible cards and showdowns.</p>
              {result.provenance ? <>
                <p>Reproduce the checked-in result with <code>npm run audit:river:v3</code>.</p>
                <p>Rules SHA-256: <code>{result.provenance.rulesHash}</code></p>
                <p>Artifact SHA-256: <code>{result.provenance.payloadHash}</code></p>
              </> : <p>This custom result is a local calculation, not a separately audited, hashed release artifact.</p>}
            </details>
          </section>
          <DecisionInspector result={result} decision={decision} selectedKey={selectedKey} busy={busy !== null}
            disabled={busy === "solve" || busy === "preflight"}
            choose={key => {
              setSelectedKey(key); setBusy("inspect"); setErrors({});
              setMessage("Loading a decision in the background…");
              post({ type: "inspect", id: ++requestId.current, source: result.source, key });
            }} />
          <section className={styles.inset} aria-labelledby="ideas-heading">
            <h2 id="ideas-heading">What shapes the answer?</h2>
            <dl className={styles.lessons}>
              <div><dt>Price</dt><dd>A cheaper call needs a smaller share of the final pot to pay for itself.</dd></div>
              <div><dt>Position</dt><dd>The second player sees the first action before choosing. That extra information changes the decisions available.</dd></div>
              <div><dt>Blockers</dt><dd>Your cards and the board remove impossible opponent hands. Even a weak hand can remove a strong calling hand.</dd></div>
              <div><dt>Ranges</dt><dd>A hand’s value depends on the weighted hands it faces, and on which of those hands reach this point.</dd></div>
              <div><dt>Stack depth</dt><dd>Chips left behind limit calls and raises. A short all-in can change both the price and what can happen next.</dd></div>
              <div><dt>Bet sizing</dt><dd>A bigger bet risks more and gives the opponent a different price. Adding or removing a legal size changes the game being solved.</dd></div>
            </dl>
            <p className={styles.note}>This lab models two players on the river, equal prior contributions, no rake, and only the listed sizes.
              It does not solve earlier streets, multi-player pots, or every possible no-limit wager.</p>
          </section>
        </article>
      </div>
    </div>
  </main>;
}
