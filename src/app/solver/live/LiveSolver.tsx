"use client";

import Link from "next/link";
import { useEffect, useReducer, useRef, useState } from "react";
import type { BridgeSpotV1 } from "@/lib/solver/bridge/contract";
import { createBrowserSolver } from "@/lib/solver/bridge/live/browser";
import { parseLiveSpot } from "@/lib/solver/bridge/live/admission";
import { compatibleDeals, LiveInputError, parseLiveInput, SMALL_RIVER, SMALL_TURN, type LiveInput, type LiveInputErrors } from "@/lib/solver/bridge/live/input";
import { initialLiveUi, liveUiReducer } from "@/lib/solver/bridge/live/ui-state";
import { actionText, hasCompatibleOpponent, type SavedLiveExample } from "@/lib/solver/bridge/live/view";
import type { LiveDeployment } from "@/lib/solver/bridge/live/deployment-node";
import { formatBytes } from "@/lib/solver/bridge/wasm-admission";
import styles from "./live.module.css";

const count = (n: number) => n.toLocaleString("en-US"), chips = (n: number) => n.toFixed(6);
const boardText = (s: BridgeSpotV1) => [...s.board.flop, s.board.turn, s.board.river].filter(Boolean).join(" ");
function download(value: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + "\n"], { type: "application/json" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function LiveSolver({ example, deployment }: { example: SavedLiveExample; deployment: LiveDeployment | null }) {
  const [input, setInput] = useState<LiveInput>({ ...SMALL_TURN });
  const [mode, setMode] = useState("form"), [json, setJson] = useState(JSON.stringify(example.spot, null, 2));
  const [errors, setErrors] = useState<LiveInputErrors>({}), [hand, setHand] = useState(0);
  const [inputNote, setInputNote] = useState("");
  const [state, dispatch] = useReducer(liveUiReducer, example, initialLiveUi);
  const client = useRef<ReturnType<typeof createBrowserSolver> | null>(null), started = useRef(0);
  const errorRef = useRef<HTMLDivElement>(null), statusRef = useRef<HTMLElement>(null);
  const busy = state.busy !== null;
  useEffect(() => () => { client.current?.dispose(); client.current = null; }, []);
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => dispatch({ type: "tick", elapsedMs: performance.now() - started.current }), 250);
    return () => clearInterval(timer);
  }, [busy]);
  useEffect(() => {
    const first = Object.keys(errors)[0]; if (!first) return;
    (document.getElementById(`live-${first}`) ?? errorRef.current)?.focus();
  }, [errors]);
  const displayed = state.displayed, summary = displayed.summary, selectedHand = Math.min(hand, summary.hands.length - 1);
  const reachable = hasCompatibleOpponent(displayed.spot, summary.hands[selectedHand]);
  function changed() { dispatch({ type: "edit" }); setErrors({}); setInputNote(""); }
  function preset(next: LiveInput) { setMode("form"); setInput({ ...next }); changed(); }
  function start(spot: BridgeSpotV1, spotJson: string, operation: "estimate" | "solve") {
    if (!deployment || busy) return;
    if (typeof Worker === "undefined" || typeof WebAssembly === "undefined" || !globalThis.crypto?.subtle) {
      setErrors({ form: "This browser cannot start the solver here. Use a current browser over HTTPS, or explore the saved example." }); return;
    }
    started.current = performance.now(); setErrors({});
    dispatch({ type: "start", spot, json: spotJson, mode: operation });
    statusRef.current?.focus();
    client.current ??= createBrowserSolver(event => {
      dispatch({ type: "event", event });
      if (event.type === "result") setHand(0);
      if ((event.type === "cancelled" || event.type === "error" || event.type === "result") && document.activeElement?.id === "live-cancel") {
        requestAnimationFrame(() => statusRef.current?.focus({ preventScroll: true }));
      }
    });
    const deviceMemoryGiB = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    client.current.start({ type: operation, spotJson, assetBase: deployment.assetBase,
      environment: { profile: "unknown", ...(deviceMemoryGiB === undefined ? {} : { deviceMemoryGiB }) } });
  }
  function check() {
    if (busy) return;
    try {
      if (mode === "json") { const spot = parseLiveSpot(json); setInputNote("Imported rules are used exactly as written; no menu or precision fallback."); start(spot, json, "estimate"); }
      else {
        const parsed = parseLiveInput(input);
        setInputNote(`${parsed.removed[0]} first-player and ${parsed.removed[1]} second-player combinations removed because they use board cards. `
          + (parsed.roundedWeights ? "Relative weights were rounded to the solver’s float32 precision." : "Weights normalized to each range’s largest weight; no rounding was needed."));
        start(parsed.spot, JSON.stringify(parsed.spot), "estimate");
      }
    } catch (error) { setErrors(error instanceof LiveInputError ? error.errors : { [mode === "json" ? "json" : "form"]: error instanceof Error ? error.message : "Check the game." }); }
  }
  function field(key: keyof LiveInput, label: string, help: string, numeric = false) {
    return <div className={styles.field}>
      <label htmlFor={`live-${key}`}>{label}</label>
      <input id={`live-${key}`} value={input[key]} inputMode={numeric ? "numeric" : "text"} required
        maxLength={key.startsWith("range") ? 2000 : 100} autoCapitalize="off" spellCheck={false} autoComplete="off"
        aria-invalid={!!errors[key]} aria-describedby={`live-${key}-help${errors[key] ? ` live-${key}-error` : ""}`}
        onChange={e => { setInput({ ...input, [key]: e.target.value }); changed(); }} />
      <small id={`live-${key}-help`}>{help}</small>
      {errors[key] && <span id={`live-${key}-error`} className={styles.error}>{errors[key]}</span>}
    </div>;
  }
  const preflight = state.prepared?.event;
  return <main className={styles.page}><div className={styles.shell}>
    <a href="#live-result" className={styles.skip}>Skip to completed result</a>
    <header className={styles.header}>
      <nav className={styles.nav} aria-label="Solver navigation"><Link href="/">← Poker Face</Link><Link href="/solver/lab">Leduc lab</Link>
        <Link href="/solver/river">River teaching lab</Link><Link href="/solver/flop">Saved flop library</Link><Link href="/drills">Drills</Link></nav>
      <p className={styles.eyebrow}>Two players · turn or river · local browser solve</p>
      <h1>Live Turn &amp; River Solver</h1>
      <p className={styles.intro}>Start with a checked example. Then change the cards, possible hands or bet sizes and solve a small game of your own.</p>
      <p className={styles.note}>An approximate strategy for this specific finite game—not universal or exact GTO.
        Showdowns enumerate the remaining cards; learning the strategy takes a limited number of iterations. No GPU training, rake or live flops.</p>
      <div className={styles.buttons}><a href="#live-setup">Set up a game ↓</a><a href="#live-result">Explore the saved result ↓</a></div>
    </header>
    <div className={styles.layout}>
      <section className={styles.setup} aria-labelledby="live-setup">
        <h2 id="live-setup">1. Set up a game</h2>
        <p>Position means who acts first and who acts second on each street. Both players start with the same effective stack—the amount each can win from the other.</p>
        <div className={styles.buttons}><button disabled={busy} onClick={() => preset(SMALL_TURN)}>Fill small turn</button>
          <button disabled={busy} onClick={() => preset(SMALL_RIVER)}>Fill small river</button></div>
        <form noValidate onSubmit={e => { e.preventDefault(); check(); }}>
          <fieldset disabled={busy}><legend>Game inputs</legend>
            <div className={styles.field}><label htmlFor="live-mode">Input style</label><select id="live-mode" value={mode} onChange={e => { setMode(e.target.value); changed(); }}>
              <option value="form">Guided setup</option><option value="json">Advanced: Spot v1 JSON</option></select></div>
            {mode === "form" ? <>
              {field("board", "Board cards", "Four cards for the turn; five for the river. c = clubs, d = diamonds, h = hearts, s = spades.")}
              {field("range0", "First player’s possible hands", "Example: AA AQs 7h6h:50%. Separate hands with spaces or commas.")}
              {field("range1", "Second player’s possible hands", "Up to 64 combinations per player after removing board cards.")}
              <details><summary>How ranges and weights work</summary><p>AA includes all pairs of aces. AQs means suited; AQo means different suits. AsQh names two exact cards.
                Add :50% for half as much weight. We remove board-blocked hands, reject overlapping entries and normalize relative weights to float32.
                These are inputs you choose, not recommended or solved preflop ranges.</p></details>
              {field("pot", "Starting pot (chips)", "The money already in the middle; whole chips, at least 4.", true)}
              {field("stack", "Effective stack per player (chips)", "What each can still bet. At most 10 times the pot.", true)}
              {field("bets", "Opening sizes (% of pot)", "One or two sizes, 25–200, or allin. Example: 50 100. Used for both players on each remaining street.")}
              <div className={styles.field}><label htmlFor="live-raiseLimit">Raises after an opening bet, per street</label>
                <select id="live-raiseLimit" value={input.raiseLimit} onChange={e => { setInput({ ...input, raiseLimit: e.target.value }); changed(); }}>
                  <option value="0">No raises</option><option value="1">One raise</option></select></div>
              {input.raiseLimit === "1" && field("raise", "Raise-to multiplier", "2 means raise to twice the previous bet-to amount. Use 2–4; stacks and minimum-raise rules still apply.")}
              {field("iterations", "Maximum learning iterations", "1–10,000. Stops earlier if reported exploitability reaches 0.01% of the starting pot. Also stops after 120 seconds.", true)}
            </> : <div className={styles.field}><label htmlFor="live-json">Spot v1 JSON</label>
              <textarea id="live-json" rows={14} value={json} maxLength={256 * 1024} spellCheck={false} aria-invalid={!!errors.json}
                aria-describedby={`live-json-help${errors.json ? " live-json-error" : ""}`} onChange={e => { setJson(e.target.value); changed(); }} />
              <small id="live-json-help">Pre-filled with the saved example’s exact game. Imports keep their own menus, iteration target and export scope. Turn/river, float32 and browser limits still apply.</small>
              {errors.json && <span id="live-json-error" className={styles.error}>{errors.json}</span>}
            </div>}
          </fieldset>
          {!deployment && <p className={styles.notice}>Live solver assets are not installed in this build. The saved example works without them.
            Developers: run <code>npm run prepare:wasm:live</code> after the WASM build, then rebuild the app.</p>}
          <div ref={errorRef} tabIndex={-1} role="alert" className={styles.error}>{Object.keys(errors).length > 0 && <p>Check the highlighted input. {errors.form}</p>}{state.error && <p>{state.error}</p>}</div>
          <div className={styles.buttons}><button className={styles.primary} type="submit" disabled={busy || !deployment}>Check game size</button></div>
          <p className={styles.note}>Check size before solving. Editing any input clears that check. The displayed completed result stays unchanged.</p>
        </form>
        {inputNote && <p className={styles.note}>{inputNote}</p>}
        <details><summary>Browser limits and offline option</summary><p>Single-threaded float32 only. Up to 64 hands per player, 100,000 estimated exported states and a 256 MiB solver memory reservation.
          This is not a cap on total browser memory or a guarantee against running out of memory, especially on phones. Larger solves stay available through the repository’s scripts.</p>
          <p>Preflight builds card and game tables, but does not allocate strategy storage. First-street export is an explicit advanced option; it still solves future streets.</p>
          <a href="https://github.com/katswnt/poker-face">Repository and offline instructions</a></details>
      </section>
      <div className={styles.results}>
        <section className={styles.panel} aria-labelledby="live-check-title" tabIndex={-1} ref={statusRef}><h2 id="live-check-title">2. Check, then solve</h2>
          <p role="status" aria-live="polite" aria-atomic="true">{state.message}</p>
          {preflight && state.prepared ? <>
            <p>{boardText(state.prepared.spot)} · {state.prepared.spot.startingPot} pot · {state.prepared.spot.effectiveStack} effective stack</p>
            <dl className={styles.metrics}>
              <div><dt>Compatible private-hand deals</dt><dd>{count(compatibleDeals(state.prepared.spot))}</dd></div>
              <div><dt>Exported public states (upper bound)</dt><dd>{count(preflight.estimate.estimateExport.nodes)}</dd></div>
              <div><dt>Exported action × hand cells (upper bound)</dt><dd>{count(preflight.estimate.estimateExport.cells)}</dd></div>
              <div><dt>Requested iteration cap</dt><dd>{count(state.prepared.spot.solve.maxIterations)}</dd></div>
              <div><dt>Strategy/game storage estimate</dt><dd>{formatBytes(preflight.verdict.engineBytes)}</dd></div>
              <div><dt>Export and copies reservation</dt><dd>{formatBytes(preflight.verdict.exportBytes)}</dd></div>
              <div><dt>Fixed + observed preflight overhead</dt><dd>{formatBytes(preflight.verdict.overheadBytes)}</dd></div>
              <div><dt>Solver reservation / admission budget</dt><dd>{formatBytes(preflight.verdict.totalBytes)} / {formatBytes(preflight.verdict.budgetBytes)}</dd></div>
            </dl><p className={styles.notice}>{preflight.verdict.reason}</p>
            <p className={styles.note}>These are export-work bounds, not an exact count of internal solver operations or a time prediction.
              {state.prepared.spot.solve.exportScope === "first-street" && " Only the starting street will be exported; the engine still solves future streets."}</p>
            <div className={styles.buttons}><button className={styles.primary} disabled={busy || !preflight.verdict.ok}
              onClick={() => start(state.prepared!.spot, state.prepared!.json, "solve")}>Solve checked game</button>
              <button disabled={busy} onClick={() => download(state.prepared!.spot, "poker-face-spot.json")}>Download checked game</button></div>
          </> : <p>Choose a small game on the left, then select “Check game size”. No solve runs automatically.</p>}
          {(busy || state.elapsedMs > 0) && <dl className={styles.metrics}>
            <div><dt>Elapsed time</dt><dd>{(state.elapsedMs / 1000).toFixed(1)} seconds</dd></div>
            <div><dt>Completed iterations</dt><dd>{count(state.progress?.iterations ?? 0)}</dd></div>
            <div><dt>Last measured exploitability</dt><dd>{state.progress?.exploitability === null || !state.progress ? "Not measured yet" : `${chips(state.progress.exploitability)} chips`}</dd></div>
            <div><dt>Measured at iteration</dt><dd>{state.progress?.measuredAtIteration ?? "Not measured yet"}</dd></div>
          </dl>}
          {busy && <div className={styles.buttons}><button id="live-cancel" aria-disabled={state.busy === "cancelling"} onClick={() => {
            if (state.busy !== "cancelling") { dispatch({ type: "cancel" }); client.current?.cancel(); }
          }}>{state.busy === "cancelling" ? "Cancelling…" : "Cancel background task"}</button></div>}
          {state.preview && <details><summary>Non-final preview: first hand</summary>
            <p>{state.preview.hands[0]} at iteration {state.preview.iteration}. These frequencies can change; this is not a completed result.</p>
            <table className={styles.table}><caption>Current root preview</caption><thead><tr><th scope="col">Action</th><th scope="col">Frequency</th></tr></thead>
              <tbody>{state.preview.engineActions.map((a, i) => <tr key={a}><th scope="row">{actionText(a)}</th><td>{(100 * state.preview!.strategy[i][0]).toFixed(1)}%</td></tr>)}</tbody></table>
          </details>}
        </section>
        <section className={styles.panel} id="live-result" tabIndex={-1} aria-labelledby="live-result-title">
          <h2 id="live-result-title">3. Inspect the completed result</h2>
          <p className={styles.eyebrow}>{displayed.source === "saved" ? "Saved, independently checked example" : "Completed browser solve · engine-reported quality"}</p>
          <p className={styles.notice}>This result belongs to the game below, not necessarily the current form inputs.</p>
          <p>{boardText(displayed.spot)} · {displayed.spot.startingPot} chips in the pot · {displayed.spot.effectiveStack} chips behind each player</p>
          <dl className={styles.metrics}>
            <div><dt>Exploitability (engine-reported)</dt><dd>{chips(summary.exploitability)} chips</dd></div>
            <div><dt>Target</dt><dd>{chips(summary.target)} chips · {summary.reached ? "reached" : "not reached"}</dd></div>
            <div><dt>Completed iterations</dt><dd>{count(summary.iterations)}</dd></div>
            <div><dt>Exported states</dt><dd>{count(summary.exportedNodes)}</dd></div>
          </dl>
          <p className={styles.note}>Exploitability is half the sum of both players’ best-response gains: how much a perfect counter-strategy could improve against this strategy in this game.
            Smaller is better. It does not certify your input ranges or describe your loss on every hand.</p>
          {displayed.source === "saved" ? <p className={styles.note}>Independent TypeScript check: {chips(example.independent.exploitability)} chips.
            The engine and independent checker agree within {example.independent.toleranceChips} chips.</p>
            : <p className={styles.note}>This custom result has not been independently re-graded. Small reference games check this engine, but they do not certify every custom game.</p>}
          <div className={styles.field}><label htmlFor="live-hand">First player’s hand at the opening decision</label>
            <select id="live-hand" value={selectedHand} onChange={e => setHand(+e.target.value)}>{summary.hands.map((h, i) => <option key={h} value={i}>{h}</option>)}</select></div>
          {reachable ? <><table className={styles.table}><caption>How often this strategy takes each action with {summary.hands[selectedHand]}</caption>
            <thead><tr><th scope="col">Action</th><th scope="col">Frequency</th></tr></thead><tbody>{summary.actions.map((a, i) => <tr key={a}>
              <th scope="row">{actionText(a)}</th><td>{(100 * summary.strategy[i][selectedHand]).toFixed(2)}%</td></tr>)}</tbody></table>
          <dl className={styles.metrics}><div><dt>Value following this strategy (chips)</dt><dd>{summary.ev[selectedHand] >= 0 ? "+" : ""}{summary.ev[selectedHand].toFixed(4)}</dd></div>
            <div><dt>Showdown share if both check down</dt><dd>{(100 * summary.equity[selectedHand]).toFixed(2)}%</dd></div></dl></>
            : <p className={styles.notice}>This hand has no compatible opponent hands in this range. Frequencies and values are not meaningful here.</p>}
          <p className={styles.note}>Value includes the strategy’s future bets and folds, with half the starting pot subtracted from the returned pot share.
            It is not the EV of each action. Showdown share counts ties and remaining cards against the starting opponent range after card removal—not a future calling range.</p>
          <details><summary>Game identity, ranges and source</summary><dl className={styles.settings}>
            <div><dt>Game ID</dt><dd>{summary.spotId}</dd></div><div><dt>First-player range</dt><dd>{displayed.spot.ranges[0].combos.map(h => `${h.combo}:${h.weight}`).join(" ")}</dd></div>
            <div><dt>Second-player range</dt><dd>{displayed.spot.ranges[1].combos.map(h => `${h.combo}:${h.weight}`).join(" ")}</dd></div>
            <div><dt>Spot SHA-256</dt><dd><code>{summary.spotHash}</code></dd></div><div><dt>Engine revision</dt><dd><code>{summary.engineCommit}</code></dd></div>
            {displayed.provenance && <div><dt>WASM build SHA-256</dt><dd><code>{displayed.provenance.buildHash}</code></dd></div>}
            {displayed.source === "saved" && <div><dt>Saved example SHA-256</dt><dd><code>{example.payloadHash}</code></dd></div>}
          </dl><div className={styles.buttons}><button onClick={() => download(displayed.spot, "poker-face-result-game.json")}>Download result’s game</button>
            {displayed.raw && <button disabled={busy} onClick={() => download(displayed.raw, "poker-face-strategy.json")}>Download full strategy</button>}</div></details>
          <div className={styles.buttons}><button disabled={busy} onClick={() => { dispatch({ type: "example", example }); setHand(0); }}>Show saved example</button></div>
          <p>For action EVs, opponent responses and plain-language lessons at individual river decisions, use the <Link href="/solver/river">River teaching lab</Link>.</p>
        </section>
      </div>
    </div>
    <footer className={styles.footer}><h2>What makes the answer change?</h2><p>Price is what you risk to continue. Position controls who acts first and who can respond.
      Blockers remove impossible opponent hands. Ranges decide which possible hands matter most. Stack depth limits future bets; the bet menu defines which choices this finite game can consider.</p>
      <p className={styles.note}>Run locally in your browser: game inputs are not sent to a solving server. Small-game correctness checks do not establish global unexploitable poker play.
        Physical-phone memory limits remain unvalidated; cancel or use the saved example if your device struggles.</p>
      {deployment && <><p><a href={deployment.sourceArchive}>Download corresponding solver source and licenses</a> · <a href={`${deployment.assetBase}source/BUILD.txt`}>Build instructions</a> · <a href={`${deployment.assetBase}LICENSES.txt`}>Dependency licenses</a></p>
        <p className={styles.note}>AGPL-3.0-or-later. Build: <code>{deployment.buildHash}</code>. Source archive SHA-256: <code>{deployment.sourceArchiveHash}</code>.</p></>}
    </footer>
  </div></main>;
}
