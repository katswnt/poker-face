"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { FLOP_CONDITIONAL_MIN, FLOP_RARE_REACH, flopHistory, flopStreet, type FlopCatalog, type FlopScenario, type FlopSlice, type FlopViewNode } from "@/lib/solver/postflop/flop-library/model";
import { createFlopExplorerStore, flopDecisionLink, flopViewNodes } from "@/lib/solver/postflop/flop-library/store";
import { flopCallPrice, flopHandDetails, reachedFlopDeals } from "@/lib/solver/postflop/flop-library/query";
import styles from "./flop.module.css";

const pct = (n: number | null, digits = 1) => n === null ? "Not available" : n > 0 && n < 10 ** -digits / 100 ? `<${(10 ** -digits).toFixed(digits)}%` : `${(100 * n).toFixed(digits)}%`;
const chips = (n: number | null) => n === null ? "Not available" : `${n > 0.0005 ? "+" : ""}${(Math.abs(n) < 0.0005 ? 0 : n).toFixed(3)}`;
const player = (p: number) => p === 0 ? "First player" : "Second player";
const title = (s: string) => s[0].toUpperCase() + s.slice(1);
function actionLabel(action: string, node: FlopViewNode, scenario: FlopScenario) {
  if (node.state.actor === null) return title(action);
  if (action === "bet") return `Bet ${Math.min(scenario.request.betSizes[node.state.street], scenario.request.stackBehind[node.state.actor] - node.state.put[node.state.actor])}`;
  if (action === "call") return `Call ${flopCallPrice(scenario, node).cost}`;
  return title(action);
}
function Reach({ reach, privateHand = false }: { reach: number; privateHand?: boolean }) {
  return <>
    <p className={styles.note}>Saved-play reach: {pct(reach, 5)} of all hands, including earlier actions and cards{privateHand ? " and this private hand" : ", with both hands unknown"}.</p>
    {reach <= FLOP_CONDITIONAL_MIN ? <p className={styles.notice}>{reach === 0 ? "Off path: the saved strategy never reaches this decision." : "Too little reach for reliable conditional figures."} Legal choices remain visible; conditional values and ranges are not available.</p>
      : reach < FLOP_RARE_REACH ? <p className={styles.notice}>Rare decision. Whole-game exploitability does not bound the error in this decision’s action values.</p> : null}
  </>;
}
function Assumptions({ scenario }: { scenario: FlopScenario }) {
  return <>
    <h3>What this game assumes</h3>
    <p>{scenario.provenance}</p>
    <dl className={styles.settings}>
      <div><dt>Starting pot</dt><dd>{2 * scenario.request.committedPerPlayer} chips; each player already paid {scenario.request.committedPerPlayer}</dd></div>
      <div><dt>Chips behind, first / second</dt><dd>{scenario.request.stackBehind.join(" / ")}</dd></div>
      <div><dt>One opening size, flop / turn / river</dt><dd>{scenario.request.betSizes.join(" / ")} chips, capped at the bettor’s remaining stack</dd></div>
      <div><dt>Raises / rake</dt><dd>No raises. No rake.</dd></div>
      <div><dt>Compatible starting deals</dt><dd>{scenario.counts.compatibleDeals.toLocaleString("en-US")}</dd></div>
    </dl>
    <details><summary>Both exact starting ranges</summary>{scenario.request.rangeText.map((range, p) => <div key={p}><h4>{player(p)}</h4><p className={styles.rangeText}>{range}</p></div>)}<p>A number after “:” is a relative weight, not an action frequency. Shared cards rule out impossible hand pairs.</p></details>
    <p><a href={scenario.inputs.url} download={`${scenario.id}.json`}>Download this game’s inputs</a></p>
    <details><summary>Quality and reproducibility</summary>
      <dl className={styles.settings}>
        <div><dt>Completed iterations</dt><dd>{scenario.quality.iterations.toLocaleString("en-US")} CFR+, delay 20</dd></div>
        <div><dt>Exploitability</dt><dd>{scenario.quality.exploitability.toFixed(9)} chips ({scenario.quality.percentOfPot.toFixed(4)}% of starting pot)</dd></div>
        <div><dt>Best-response gains, first / second</dt><dd>{scenario.quality.gains.map(n => n.toFixed(9)).join(" / ")} chips</dd></div>
        <div><dt>First player’s starting value</dt><dd>{chips(scenario.quality.value[0])} net chips</dd></div>
        <div><dt>Public states / information sets</dt><dd>{scenario.counts.publicStates.toLocaleString("en-US")} / {scenario.counts.informationSets.toLocaleString("en-US")}</dd></div>
        <div><dt>Source SHA-256</dt><dd><code>{scenario.sourceHash}</code></dd></div>
        <div><dt>Policy SHA-256</dt><dd><code>{scenario.policyHash}</code></dd></div>
      </dl>
      <p>A best-response gain measures how much one player could improve against the other’s saved strategy. Exploitability is half the sum of both gains. It is not a percentage of action-frequency accuracy.</p>
      <p>Exact card enumeration does not make this an exact equilibrium. The strategy is approximate for the declared finite game. Missing sizes, assumed ranges and absent rake are separate limitations.</p>
    </details>
  </>;
}
function Ranges({ scenario, node, nodes, selectHand }: { scenario: FlopScenario; node: FlopViewNode; nodes: Map<number, FlopViewNode>; selectHand: (hand: number) => void }) {
  const [position, setPosition] = useState<number>(node.state.actor ?? 0), [group, setGroup] = useState<string | null>(null);
  const pairs = reachedFlopDeals(scenario, node, nodes), mass = scenario.hands[position].map((_, h) => pairs.reduce((sum, p) => sum + (p.hands[position] === h ? p.reach : 0), 0));
  const total = mass.reduce((a, b) => a + b, 0), known = total > FLOP_CONDITIONAL_MIN;
  const className = (h: string) => h[0] === h[2] ? `${h[0]}${h[2]}` : `${h[0]}${h[2]} ${h[1] === h[3] ? "suited" : "offsuit"}`;
  const groups = [...new Set(scenario.hands[position].map(className))];
  return <details className={styles.section}><summary>Explore the ranges: hand groups and exact cards</summary>
    <label className={styles.field}>Position to inspect<select value={position} onChange={e => { setPosition(Number(e.target.value)); setGroup(null); }}><option value={0}>First player</option><option value={1}>Second player</option></select></label>
    <p>Position here means who acts first and second—not a solved preflop seat. These shares include earlier actions and card removal, with both hands unknown. Groups are weighted by how often they reach this history, not averaged equally.</p>
    <div className={styles.rangeGrid}>{groups.map(g => <button type="button" key={g} aria-pressed={group === g} onClick={() => setGroup(group === g ? null : g)}><strong>{g}</strong><span>{known ? pct(mass.reduce((sum, w, h) => sum + (className(scenario.hands[position][h]) === g ? w / total : 0), 0)) : "Not available"}</span></button>)}</div>
    <p className={styles.note}>{group ? `Showing ${group}. Select the group again to show every combination.` : "Showing every exact combination."} Suited means the same suit; offsuit means different suits.</p>
    <table className={styles.table}><caption>{player(position)}: exact cards and current range share</caption><thead><tr><th scope="col">Cards</th><th scope="col">Share</th><th scope="col">Decision</th></tr></thead>
      <tbody>{scenario.hands[position].map((h, i) => !group || className(h) === group ? <tr key={h}><th scope="row">{h}</th><td>{known ? pct(mass[i] / total) : "Not available"}</td><td>{position === node.state.actor && node.hands.some(h => h.hand === i) ? <button type="button" onClick={() => selectHand(i)}>Inspect {h}</button> : "No choice here"}</td></tr> : null)}</tbody></table>
  </details>;
}
function Decision({ scenario, node, nodes, follow, initialHand }: { scenario: FlopScenario; node: FlopViewNode; nodes: Map<number, FlopViewNode>; follow: (action: number) => void; initialHand: number | null }) {
  const [handIndex, setHand] = useState(initialHand ?? node.hands[0]?.hand ?? 0), [actionIndex, setAction] = useState(0), [responseIndex, setResponse] = useState(-1);
  const hand = node.hands.find(h => h.hand === handIndex) ?? node.hands[0], actor = node.state.actor!;
  if (!hand) return <p>No compatible private hands remain on this board. Use Back or Start over to choose another path.</p>;
  const details = flopHandDetails(scenario, node, hand, nodes), fact = details.actions[actionIndex], response = fact.responses[responseIndex], price = flopCallPrice(scenario, node);
  const choose = (h: number) => { setHand(h); setAction(0); setResponse(-1); };
  return <>
    <label className={styles.field}>Exact hand to inspect<select value={hand.hand} onChange={e => choose(Number(e.target.value))}>{node.hands.map(h => <option key={h.hand} value={h.hand}>{scenario.hands[actor][h.hand]}</option>)}</select></label>
    <Reach reach={hand.reach} privateHand />
    <h3>Compare this hand’s choices</h3>
    <p>Frequency means how often the saved strategy chooses an action. Value asks what you earn on average if you choose it now, then both players follow the saved strategy.</p>
    <div className={styles.actions}>{details.actions.map((a, i) => <button type="button" key={a.label} aria-pressed={i === actionIndex} onClick={() => { setAction(i); setResponse(-1); }}><span className={styles.actionTitle}><strong>{actionLabel(a.label, node, scenario)}</strong><strong>{pct(a.frequency)}</strong></span><span>Value from now: {chips(a.evFromNow)} chips</span><span>Behind highest value: {a.gap === null ? "Not available" : `${a.gap.toFixed(3)} chips`}</span></button>)}</div>
    <p className={styles.note}>“From now” excludes chips already paid. Folding is worth zero from now. Chip values are rounded to three decimals. Close values can support different choices; these are continuation values, not promised profits.</p>
    <button className={styles.primary} type="button" onClick={() => follow(actionIndex)}>Follow {actionLabel(fact.label, node, scenario)}</button>
    <p className={styles.note}>Inspecting a hand does not fix either player’s private cards when you follow the public game.</p>
    <p><a href={flopDecisionLink(scenario, node, hand.hand)}>Link to this exact decision and hand</a> <span className={styles.note}>(copy the link to share)</span></p>
    <section className={styles.section} aria-labelledby="flop-action-facts"><h3 id="flop-action-facts">After choosing {actionLabel(fact.label, node, scenario)}</h3>
      <dl className={styles.metrics}><div><dt>Value from hand start</dt><dd>{chips(fact.ev)} chips</dd></div><div><dt>Opponent folds next</dt><dd>{pct(fact.foldNext)}</dd></div><div><dt>Share if betting stopped</dt><dd>{pct(hand.checkdownShare)}</dd></div><div><dt>Share among later showdowns</dt><dd>{pct(fact.showdownShare)}</dd></div></dl>
      <p>“If betting stopped” counts all remaining cards against the opponent’s current possible hands; a tie is half a win. “Among later showdowns” counts only the hands that actually continue to showdown. Folds and later bets can make the two very different.</p>
      {price.cost > 0 && <p>Calling costs {price.cost} chips to contest a {price.potAfterCall}-chip pot after the call. If no more money went in, you would need {pct(price.share)} of that pot to break even. Earlier streets can still have later betting, so this price alone does not decide the action.</p>}
      <details><summary>How the hand can end</summary><dl className={styles.rows}>{["You fold, now or later", "Opponent folds, now or later", "You win at showdown", "Split at showdown", "You lose at showdown"].map((label, i) => <div key={label}><dt>{label}</dt><dd>{pct(fact.outcomes?.[i] ?? null)}</dd></div>)}</dl></details>
    </section>
    <section className={styles.section} aria-labelledby="flop-responses"><h3 id="flop-responses">The opponent’s next response</h3>
      {fact.responses.length ? <ul className={styles.rows}>{fact.responses.map(r => <li key={r.action}><span>{title(r.action)}</span><strong>{pct(r.probability)}</strong></li>)}</ul> : <p>No immediate opponent choice follows: the hand ends, or a public card comes next.</p>}
      <details><summary>How their possible hands change</summary><p>A card you hold can rule out an opposing hand: that is a blocker. Their earlier actions also change this range. Forcing your own action, with your hand known, does not change it; their response can.</p>
        {fact.responses.length > 0 && <label className={styles.field}>Opponent range after a response<select value={responseIndex} onChange={e => setResponse(Number(e.target.value))}><option value={-1}>Before their response</option>{fact.responses.map((r, i) => <option key={r.action} value={i}>After {title(r.action)}</option>)}</select></label>}
        {response?.opponent === null && <p className={styles.notice}>That response has no reliable conditional range here. It is not a uniform range.</p>}
        <table className={styles.table}><caption>Opponent’s exact hands, given your {scenario.hands[actor][hand.hand]}</caption><thead><tr><th scope="col">Cards</th><th scope="col">Now</th>{response && <th scope="col">After {title(response.action)}</th>}</tr></thead><tbody>{scenario.hands[1 - actor].map((h, i) => <tr key={h}><th scope="row">{h}</th><td>{pct(details.opponent?.[i] ?? null)}</td>{response && <td>{pct(response.opponent?.[i] ?? null)}</td>}</tr>)}</tbody></table>
      </details>
    </section>
    <Ranges scenario={scenario} node={node} nodes={nodes} selectHand={choose} />
  </>;
}
function NextCard({ node, follow }: { node: FlopViewNode; follow: (a: number) => void }) {
  const [selected, select] = useState(Math.max(0, node.edges.findIndex(e => e.preview!.support > 0))), card = node.edges[selected];
  const name = node.state.street === 0 ? "turn" : "river", known = node.summary!.reach > FLOP_CONDITIONAL_MIN;
  return <>
    <h3>The {name} card comes next</h3><p>This preview keeps both private hands unknown. Earlier actions and both ranges affect the chance of a card—not the hand you last inspected.</p>
    <label className={styles.field}>Possible {name} card<select value={selected} onChange={e => select(Number(e.target.value))}>{node.edges.map((e, i) => <option key={e.node} value={i} disabled={!e.preview!.support}>{e.label} — {e.preview!.support ? pct(known ? e.preview!.reach / node.summary!.reach : null) : "no compatible hands"}</option>)}</select></label>
    <p>On {card.label}, the first player’s expected net result from hand start is <strong>{chips(card.preview!.value0)} chips</strong>, following the saved strategy.</p>
    <button type="button" className={styles.primary} disabled={!card.preview!.support} onClick={() => follow(selected)}>Reveal {card.label}</button>
    <details><summary>Compare every possible {name} card</summary><table className={styles.table}><caption>Public card preview, both hands unknown</caption><thead><tr><th scope="col">Card</th><th scope="col">Chance</th><th scope="col">First player’s net chips</th></tr></thead><tbody>{node.edges.map(e => <tr key={e.node}><th scope="row">{e.label}</th><td>{pct(known ? e.preview!.reach / node.summary!.reach : null)}</td><td>{chips(e.preview!.value0)}</td></tr>)}</tbody></table></details>
  </>;
}
export default function FlopExplorer({ catalog, initial }: { catalog: FlopCatalog; initial: { scenario: FlopScenario; flop: FlopSlice } }) {
  const [store] = useState(() => createFlopExplorerStore(catalog, initial, { worker: () => new Worker(new URL("./flop.worker.ts", import.meta.url)) }));
  const view = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot), nodes = flopViewNodes(view), node = nodes.get(view.node)!;
  const [texture, setTexture] = useState("All"), [draft, setDraft] = useState(initial.scenario.id);
  const heading = useRef<HTMLHeadingElement>(null), status = useRef<HTMLDivElement>(null), handledRevision = useRef(0);
  const entries = catalog.scenarios.filter(s => texture === "All" || s.texture === texture), selected = entries.some(e => e.id === draft) ? draft : entries[0]?.id;
  useEffect(() => {
    const navigate = () => { if (window.location.hash && window.location.hash !== "#flop-decision") void store.openLink(window.location.hash); };
    // Every saved location is encoded in the hash. Back/forward already fires
    // hashchange; also listening to popstate would start two identical loads.
    navigate(); window.addEventListener("hashchange", navigate);
    return () => { window.removeEventListener("hashchange", navigate); };
  }, [store]);
  useEffect(() => {
    if (!view.revision || handledRevision.current === view.revision) return;
    handledRevision.current = view.revision;
    if (view.cause === "push") window.history.pushState(null, "", flopDecisionLink(view.scenario, flopViewNodes(view).get(view.node)!, view.hand));
    if (view.status === "error") status.current?.focus(); else if (view.status === "ready") heading.current?.focus();
  }, [view]);
  const pending = view.status === "loading" || view.status === "inspecting";
  return <main className={styles.page}>
    <a className={styles.skip} href="#flop-decision">Skip to the decision</a><div className={styles.shell}>
      <header className={styles.header}><nav className={styles.nav} aria-label="Solver labs"><Link href="/">Poker Face</Link><Link href="/solver/postflop">Turn &amp; river</Link><Link href="/solver/river">River lab</Link><Link href="/solver/lab">Leduc lessons</Link></nav>
        <p className={styles.eyebrow}>SAVED SOLVER LIBRARY</p><h1>From flop to river.</h1><p className={styles.intro}>Follow a decision through the next two cards. See what changes—and which hands make the difference.</p>
        <p className={styles.scope}>Six saved, jointly solved heads-up games. Approximate strategies for these finite games—not exact or universal GTO. One opening size per street, no raises, no rake. Large solves run offline on a CPU; this page loads saved results.</p>
      </header>
      <div className={styles.layout}><aside className={styles.setup} aria-label="Saved scenario setup"><h2>Choose a saved game</h2>
        <label className={styles.field}>Board texture<select value={texture} onChange={e => setTexture(e.target.value)}>{["All", "Dry", "Two-tone", "Paired", "Connected", "Monotone"].map(t => <option key={t}>{t}</option>)}</select></label>
        <label className={styles.field}>Saved scenario<select value={selected} onChange={e => setDraft(e.target.value)}>{entries.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>
        <button type="button" className={styles.primary} onClick={() => { if (selected) void store.openScenario(selected); }}>Open scenario</button>
        <p className={styles.note}>The menu is a draft until you open it. Unsupported boards and bet sizes are not substituted with a nearby result.</p>
        <h3>Currently open: {view.scenario.title}</h3><p>{view.scenario.description}</p><p><a href="#flop-decision">Jump to the current decision</a></p>
        <Assumptions scenario={view.scenario} />
      </aside>
      <section className={styles.result} aria-label="Saved decision">
        <div ref={status} tabIndex={-1} className={styles.loadStatus} aria-busy={pending}><p role={view.status === "error" ? "alert" : "status"}>{view.message || "Checked saved result ready. No solver is running in this page."}</p>
          {pending && <button type="button" onClick={() => store.cancel()}>Cancel</button>}{view.status === "error" && store.canRetry() && <button type="button" onClick={() => void store.retry()}>Retry</button>}
        </div>
        <div className={styles.navigation}><button type="button" onClick={() => void store.back()} disabled={node.parent === null}>Back</button><button type="button" onClick={() => void store.reset()}>Start over</button></div>
        <h2 id="flop-decision" tabIndex={-1} ref={heading}>{flopStreet(node.state.street)} · {node.state.actor === null ? node.state.phase === "card" ? "Next card" : "Hand ends" : `${player(node.state.actor)} to act`}</h2>
        <p className={styles.board}>Board: {[...view.scenario.request.board, node.state.turn, node.state.river].filter(Boolean).join(" · ")}</p><p className={styles.history}>{flopHistory(node.state)}</p>
        <p>First means first to act; second sees the first player’s choice before responding. That order stays the same on every street.</p>
        <Reach reach={node.summary!.reach} />
        {node.state.phase === "play" ? <Decision key={`${view.scenario.sourceHash}:${node.id}:${view.hand}`} scenario={view.scenario} node={node} nodes={nodes} initialHand={view.hand} follow={a => void store.follow(a)} />
          : node.state.phase === "card" ? <NextCard key={node.id} node={node} follow={a => void store.follow(a)} />
          : <section><h3>{node.state.folded === null ? "Showdown" : `${player(node.state.folded)} folds`}</h3><p>First player’s expected net result, with both private hands unknown: {chips(node.summary!.value0)} chips.</p><p>Uncalled chips returned, first / second: {node.state.put.map(n => n - Math.min(...node.state.put)).join(" / ")}. Returned chips are not winnings.</p><p><a href={flopDecisionLink(view.scenario, node)}>Link to this ending</a></p></section>}
        {view.elapsedMs !== null && <p className={styles.note}>River explanation: {view.repeatedStates?.toLocaleString("en-US")} repeated states evaluated in {view.elapsedMs.toFixed(1)} ms in a worker. The saved policy was not changed or re-solved.</p>}
        <details className={styles.section}><summary>Why price, cards and sizing matter</summary><p>Price is what you must pay to continue compared with the pot you can win. Position changes which choices you have already seen. Blockers are your cards ruling out some opposing hands. A range is a weighted set of possible hands, not a peek at someone’s cards.</p><p>Deeper stacks leave room for more money to go in later. Different bet sizes change prices and responses. This saved game tests only its declared sizes and ranges; it does not tell you the best play for every real poker situation.</p></details>
      </section></div>
    </div>
  </main>;
}
