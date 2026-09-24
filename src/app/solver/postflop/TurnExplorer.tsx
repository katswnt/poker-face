"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { actionLabel, callPrice, conditionalStatus, historyLabel, type ExplorerCatalog, type ExplorerChunk, type HandView, type NodeView, type SavedScenario } from "@/lib/solver/postflop/explorer/model";
import { createExplorerStore } from "@/lib/solver/postflop/explorer/store";
import styles from "./postflop.module.css";

const percent = (n: number | null, digits = 1) => n === null ? "Not available" : n > 0 && n < 10 ** -digits / 100 ? `<${(10 ** -digits).toFixed(digits)}%` : `${(n * 100).toFixed(digits)}%`;
const chips = (n: number | null, digits = 3) => n === null ? "Not available" : `${n > 0.5 * 10 ** -digits ? "+" : ""}${(Math.abs(n) < 0.5 * 10 ** -digits ? 0 : n).toFixed(digits)}`;
const player = (p: number) => p === 0 ? "First player" : "Second player";
const outcomes = ["You fold, now or later", "Opponent folds, now or later", "You win at showdown", "Split at showdown", "You lose at showdown"];

function ReachNote({ reach, privateHand = true }: { reach: number; privateHand?: boolean }) {
  const status = conditionalStatus(reach);
  return <>
    <p className={styles.note}>Saved-play reach: {percent(reach, 5)} of all hands, {privateHand ? "including the chance of this private hand and earlier actions." : "counting earlier actions and public cards, with both private hands unknown."}</p>
    {status === "off" || status === "tiny" ? <p className={styles.notice}>{status === "off" ? "This history is off path: the saved strategy never reaches it." : "This history has too little reach for reliable conditional figures."} {privateHand ? "Frequencies remain visible, but chip values, equity and conditional ranges are not available." : "Conditional card chances and values are not available. Legal paths remain open."}</p>
      : status === "rare" ? <p className={styles.notice}>Rare decision. The whole-game quality figure does not bound the error in this decision’s action values.</p> : null}
  </>;
}

function HandDecision({ hand, node, scenario, follow }: { hand: HandView; node: NodeView; scenario: SavedScenario; follow: (index: number) => void }) {
  const [selected, setSelected] = useState(hand.actions.reduce((best, a, i, list) => a.frequency > list[best].frequency ? i : best, 0));
  const fact = hand.actions[selected], actor = node.state.actor!;
  const [responseIndex, setResponseIndex] = useState(-1);
  const response = fact.responses[responseIndex];
  return <>
    <ReachNote reach={hand.reach} />
    <h3>Compare this hand’s choices</h3>
    <p>Frequency is how often the saved strategy chooses an action. Value asks: if you choose it now, then both players follow the saved strategy, what do you earn on average?</p>
    <div className={styles.actions}>
      {hand.actions.map((action, i) => <button type="button" key={action.action} aria-pressed={i === selected} onClick={() => { setSelected(i); setResponseIndex(-1); }}>
        <span className={styles.actionTitle}><strong>{actionLabel(action.action)}</strong><strong>{percent(action.frequency)}</strong></span>
        <span>Value from now: {chips(action.evFromNow)} chips</span>
        <span>Behind highest value: {action.behindBest === null ? "Not available" : `${action.behindBest.toFixed(3)} chips`}</span>
      </button>)}
    </div>
    <p className={styles.note}>“From now” excludes money already paid; folding is worth 0 here. Close values can support different choices. These are measured continuation values, not guaranteed profits or a new solve.</p>
    <button type="button" className={styles.primary} onClick={() => follow(selected)}>Follow {actionLabel(fact.action)}</button>
    <p className={styles.note}>Following an action moves through the public game. Inspecting a hand does not lock either player’s cards for later steps.</p>

    <section className={styles.section} aria-labelledby="action-facts-heading">
      <h3 id="action-facts-heading">After choosing {actionLabel(fact.action)}</h3>
      <dl className={styles.metrics}>
        <div><dt>Value from hand start</dt><dd>{chips(fact.ev)} chips</dd></div>
        <div><dt>Opponent folds next</dt><dd>{percent(fact.foldNext)}</dd></div>
        <div><dt>Share if betting stopped</dt><dd>{percent(hand.checkdownShare)}</dd></div>
        <div><dt>Share among later showdowns</dt><dd>{percent(fact.showdownShare)}</dd></div>
      </dl>
      <p>“If betting stopped” counts every possible last card against the opponent’s current range, with ties worth half. “Among later showdowns” counts only hands that continue to showdown after this action. Folds and later bets can make these very different.</p>
      <p className={styles.note}>A fold percentage is unavailable when no immediate fold choice exists. A showdown share is unavailable when no showdown occurs, or the conditional decision is undefined.</p>
      <details><summary>All possible ways the hand ends</summary><dl className={styles.rows}>{outcomes.map((label, i) => <div key={label}><dt>{label}</dt><dd>{percent(fact.outcomes?.[i] ?? null)}</dd></div>)}</dl></details>
    </section>

    <section className={styles.section} aria-labelledby="responses-heading">
      <h3 id="responses-heading">The opponent’s next response</h3>
      {fact.responses.length ? <ul className={styles.rows}>{fact.responses.map(r => <li key={r.action}><span>{actionLabel(r.action)}</span><strong>{percent(r.probability)}</strong></li>)}</ul>
        : <p>No immediate opponent choice follows: the hand ends, or the river card comes next.</p>}
      <h4>How their possible hands change</h4>
      <p>Your own forced action, with your hand known, does not change this estimate. Their response can. A card you hold can rule out one of their possible hands: that is a blocker.</p>
      {fact.responses.length > 0 && <label className={styles.field}>Compare the range after a response
        <select value={responseIndex} onChange={e => setResponseIndex(Number(e.target.value))}><option value={-1}>Before their response</option>{fact.responses.map((r, i) => <option key={r.action} value={i}>After {actionLabel(r.action)}</option>)}</select>
      </label>}
      {response && response.opponent === null && <p className={styles.notice}>That response has no reliable conditional range here. It is not a uniform range.</p>}
      <table className={styles.table}>
        <caption>Opponent hands, given your {scenario.hands[actor][hand.hand]}</caption>
        <thead><tr><th scope="col">Hand</th><th scope="col">Now</th>{response && <th scope="col">After {actionLabel(response.action)}</th>}</tr></thead>
        <tbody>{scenario.hands[1 - actor].map((cards, i) => <tr key={cards}><th scope="row">{cards}</th><td>{percent(hand.opponent?.[i] ?? null)}</td>{response && <td>{percent(response.opponent?.[i] ?? null)}</td>}</tr>)}</tbody>
      </table>
    </section>
  </>;
}

function RiverChoice({ node, reveal }: { node: NodeView; reveal: (i: number) => void }) {
  const [selected, setSelected] = useState(Math.max(0, node.children.findIndex(c => c.compatibleDeals > 0)));
  const child = node.children[selected];
  return <>
    <h3>The last card comes next</h3>
    <p>Both private hands are unknown in this public preview. Card chances account for both ranges and earlier actions—not the hand you last inspected.</p>
    <label className={styles.field}>Possible river card<select value={selected} onChange={e => setSelected(Number(e.target.value))}>{node.children.map((c, i) => <option value={i} key={c.label} disabled={!c.compatibleDeals}>{c.label} — {c.compatibleDeals ? percent(c.probability) : "no compatible private hands"}</option>)}</select></label>
    <p>On {child.label}, the first player’s expected net result from hand start is <strong>{chips(child.value0)} chips</strong>, following the saved strategy. It is conditional on this card arriving—not a value that was known on the turn.</p>
    <button className={styles.primary} type="button" onClick={() => reveal(selected)} disabled={!child.compatibleDeals}>Reveal {child.label}</button>
    <details><summary>Compare all possible river cards</summary><p>Different cards remove different private hands as well as changing hand strength. A higher conditional result does not make that card more likely.</p>
      <table className={styles.table}><caption>Public river preview, both private hands unknown</caption><thead><tr><th scope="col">Card</th><th scope="col">Chance</th><th scope="col">First player’s net chips</th></tr></thead><tbody>{node.children.map(c => <tr key={c.label}><th scope="row">{c.label}</th><td>{percent(c.probability)}</td><td>{chips(c.value0)}</td></tr>)}</tbody></table>
    </details>
  </>;
}

function HistoryJump({ chunk, current, jump }: { chunk: ExplorerChunk; current: number; jump: (n: number) => void }) {
  const [selected, setSelected] = useState(current);
  return <div><label className={styles.field}>Choose a turn history<select value={selected} onChange={e => setSelected(Number(e.target.value))}>{chunk.nodes.map(n => <option key={n.id} value={n.id}>{historyLabel(n.state)}{n.state.phase === "terminal" ? " — hand ends" : ""}</option>)}</select></label><button type="button" onClick={() => jump(selected)}>Open turn history</button></div>;
}

export default function TurnExplorer({ catalog, initial }: { catalog: ExplorerCatalog; initial: ExplorerChunk }) {
  const [store] = useState(() => createExplorerStore(catalog, initial));
  const view = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  const [draft, setDraft] = useState(initial.scenario), [hands, setHands] = useState([0, 0]);
  const heading = useRef<HTMLHeadingElement>(null);
  const loadStatus = useRef<HTMLDivElement>(null);
  useEffect(() => { if (view.navigation > 0) heading.current?.focus(); }, [view.navigation]);
  useEffect(() => { if (view.status === "error") loadStatus.current?.focus(); }, [view.status]);
  const scenario = catalog.scenarios.find(s => s.id === view.scenario)!;
  const node = view.chunk.nodes.find(n => n.id === view.node)!;
  const actor = node.state.actor, hand = node.hands.find(h => h.hand === hands[actor ?? 0]) ?? node.hands[0];
  const price = callPrice(scenario.request, node.state);
  const navigate = (index: number) => { const child = node.children[index]; void store.navigate({ scenario: view.scenario, node: child.node, card: child.card }); };
  const stateTitle = node.state.phase === "play" ? `${player(actor!)} to act` : node.state.phase === "river-card" ? "Choose a river card" : "This hand has ended";
  return <main className={styles.page}>
    <a className={styles.skip} href="#turn-decision">Skip to the decision</a>
    <div className={styles.shell}>
      <header className={styles.header}>
        <nav aria-label="Solver navigation" className={styles.nav}><Link href="/">← Poker Face</Link><Link href="/solver/flop">Flop to river library</Link><Link href="/solver/river">River lab</Link><Link href="/solver/lab">Leduc lab</Link><Link href="/solver">Push/fold explorer</Link></nav>
        <p className={styles.eyebrow}>Saved strategies · two players · turn and river</p>
        <h1>One card left. What changes?</h1>
        <p className={styles.intro}>Follow a turn choice into the river. See how the last card, the price, and the opponent’s possible hands shape the next decision.</p>
        <p className={styles.scope}>Approximate strategies for these specific finite games—not universal or exact GTO. Cards and showdowns were counted exactly; strategies were learned over a limited number of iterations. Nothing is being solved in your browser.</p>
        <a href="#turn-decision">Explore the saved decision ↓</a>
        <noscript><p className={styles.notice}>The initial saved facts are readable without JavaScript. Enable JavaScript to change hands or follow the game.</p></noscript>
      </header>
      <div className={styles.layout}>
        <aside className={styles.setup} aria-label="Saved game and assumptions">
          <h2>Choose a saved game</h2>
          <label className={styles.field}>Saved example<select value={draft} onChange={e => setDraft(e.target.value)}>{catalog.scenarios.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>
          <button type="button" className={styles.primary} aria-describedby="load-status" onClick={() => void store.start(draft)}>Open saved example</button>
          <p>{scenario.description}</p>
          <p className={styles.note}>Two small teaching examples from the configurable engine. The separate 64-hand capacity example stays offline. These are handcrafted ranges, not recommended preflop strategies.</p>
          <h3>Loaded: {scenario.title}</h3>
          <dl className={styles.settings}>
            <div><dt>Turn board</dt><dd>{scenario.request.board.join(" ")}</dd></div>
            <div><dt>Starting pot</dt><dd>{2 * scenario.request.committedPerPlayer} chips</dd></div>
            {([0, 1] as const).map(p => <div key={p}><dt>{player(p)}’s range</dt><dd>{scenario.request.rangeText[p]}</dd></div>)}
            <div><dt>Starting stacks</dt><dd>{scenario.request.stackBehind.join(" / ")} chips</dd></div>
          </dl>
          <p>“First” and “second” mean who acts first and second on each betting round. This is what position means here.</p>
          <p className={styles.note}>Card key: T = ten; c = clubs, d = diamonds, h = hearts, s = spades.</p>
          <p>Whole-game exploitability: <strong>{scenario.quality.exploitability.toFixed(6)} chips</strong>. Lower means less room to improve against the saved opponent strategy in this game.</p>
          <details><summary>Bet sizes, assumptions and quality</summary>
            {scenario.request.streets.map((menu, i) => <div key={i}><h4>{i === 0 ? "Turn" : "River"} choices</h4><p>Open to {menu.openingTargets.join(" / ")} chips. Raise to {menu.raiseTargets.join(" / ")} chips. At most {menu.raiseLimit} raise after an opening bet. Extra all-in choice: {menu.includeAllIn ? "yes" : "no"}.</p></div>)}
            <p>Amounts count this street only. Illegal sizes disappear; normal targets are not clipped to a stack. Uncalled chips are returned. No rake, preflop, flop solving, or actions outside these menus.</p>
            <dl className={styles.settings}><div><dt>Iterations</dt><dd>{scenario.quality.iterations} CFR+, averaging delay 20</dd></div><div><dt>Exploitability</dt><dd>{scenario.quality.exploitability.toFixed(9)} chips ({scenario.quality.percentOfPot.toFixed(6)}% of starting pot)</dd></div>{scenario.quality.gains.map((gain, p) => <div key={p}><dt>{player(p)}’s deviation gain</dt><dd>{gain.toFixed(9)} chips</dd></div>)}</dl>
            <p>Exploitability is the average of the two gains from switching to the best legal response against the saved opponent strategy. Lower leaves less room to improve in this game. Percent of pot is not percentage accuracy, and this does not bound every rare decision’s error.</p>
            <p>{scenario.counts.deals} compatible deals · {scenario.counts.publicStates.toLocaleString("en-US")} public states · {scenario.counts.informationSets.toLocaleString("en-US")} information sets.</p>
          </details>
          <details><summary>Source hashes and reproducibility</summary><p>Derived browser data v1, turn rules v2. Full policy stays offline; each fetched chunk is checked against its recorded size and SHA-256. The embedded first view is checked during artifact reproduction.</p><dl className={styles.settings}>{Object.entries(scenario.provenance).map(([name, hash]) => <div key={name}><dt>{name}</dt><dd><code>{hash}</code></dd></div>)}</dl><code>npm run audit:turn:explorer</code><p><a href="https://github.com/katswnt/poker-face/blob/main/tasks/saved-turn-explorer-spec.md">Read the explanation contract</a></p></details>
        </aside>
        <article className={styles.result} aria-label="Saved turn and river result">
          <div className={styles.loadStatus} id="load-status" ref={loadStatus} tabIndex={-1}>
            <p role="status" aria-label="Saved result status">{view.status === "loading" ? "Loading a checked saved result. The previous view remains below." : view.status === "error" ? "The requested result was not loaded. The previous view is unchanged." : `Ready: ${scenario.title}. ${node.state.river ?? "Turn"}. ${stateTitle}.`}</p>
            {view.status === "loading" && <button type="button" onClick={() => { store.cancel(); heading.current?.focus(); }}>Cancel load</button>}
            {view.status === "error" && <><p role="alert">{view.error}</p><button type="button" onClick={() => { loadStatus.current?.focus(); void store.retry(); }}>Retry load</button></>}
          </div>
          <div className={styles.navigation}><button type="button" disabled={!view.trail.length} onClick={() => void store.back()}>Back one step</button><button type="button" onClick={() => void store.start()}>Return to turn start</button></div>
          {!view.trail.length && <p className={styles.note}>At the start, or after a history shortcut, there is no previous navigation step.</p>}
          {view.card === null && <HistoryJump key={`${view.scenario}/${view.node}`} chunk={view.chunk} current={view.node} jump={n => void store.jump(n)} />}
          <section aria-labelledby="turn-decision" aria-busy={view.status === "loading"}>
            <h2 id="turn-decision" ref={heading} tabIndex={-1}>{stateTitle}</h2>
            <p className={styles.board}>Board: <strong>{scenario.request.board.join(" ")}{node.state.river ? ` ${node.state.river}` : " · river not yet dealt"}</strong></p>
            <p className={styles.history}>{historyLabel(node.state)}</p>
            <dl className={styles.metrics}><div><dt>Pot on the table</dt><dd>{2 * (scenario.request.committedPerPlayer + node.state.carried) + node.state.streetPaid[0] + node.state.streetPaid[1]} chips</dd></div><div><dt>Chips left, first / second</dt><dd>{scenario.request.stackBehind.map((stack, p) => stack - node.state.carried - node.state.streetPaid[p]).join(" / ")}</dd></div></dl>
            {node.state.returned.some(n => n > 0) && <p>Uncalled chips returned so far, first / second: {node.state.returned.join(" / ")}. They are not in the pot.</p>}
            {node.state.phase === "play" && hand ? <>
              <label className={styles.field}>Inspect the acting player’s hand<select value={hand.hand} onChange={e => setHands(previous => previous.map((h, p) => p === actor ? Number(e.target.value) : h))}>{node.hands.map(h => <option key={h.hand} value={h.hand}>{scenario.hands[actor!][h.hand]}</option>)}</select></label>
              <p className={styles.note}>Only hands compatible with this board and at least one opponent hand are listed. If a new card removes your previous selection, the first compatible hand is shown.</p>
              <p>Cost to call: <strong>{price.cost} chips</strong>. {price.shareRequired === null ? "No call payment is due." : <>That competes for {price.potAfterCall} chips after any uncalled excess is returned—a break-even share of {percent(price.shareRequired)} if no more money went in.</>} Later betting can change the action’s value.</p>
              <HandDecision key={`${view.scenario}/${view.node}/${hand.hand}`} hand={hand} node={node} scenario={scenario} follow={navigate} />
              <details><summary>The whole acting range at this decision</summary><p>These action frequencies weight each hand by how often it reaches this history. They are not a simple average of the hand rows.</p><ul className={styles.rows}>{node.children.map((child, i) => <li key={child.label}><span>{actionLabel(child.label)}</span><strong>{percent(node.mix?.[i] ?? null)}</strong></li>)}</ul><table className={styles.table}><caption>Each acting hand’s share of this decision</caption><thead><tr><th scope="col">Hand</th><th scope="col">Share</th></tr></thead><tbody>{node.hands.map(h => <tr key={h.hand}><th scope="row">{scenario.hands[actor!][h.hand]}</th><td>{percent(node.mix ? h.reach / node.reach : null)}</td></tr>)}</tbody></table></details>
            </> : node.state.phase === "river-card" ? <><ReachNote reach={node.reach} privateHand={false} /><RiverChoice key={`${view.scenario}/${view.node}`} node={node} reveal={navigate} /></>
              : node.state.phase === "terminal" ? <><h3>{node.state.folded === null ? "Showdown" : `${player(node.state.folded)} folded`}</h3><p>First player’s expected net result: {chips(node.terminalValue0)} chips. Second player’s: {chips(node.terminalValue0 === null ? null : -node.terminalValue0)} chips.</p><p>This averages the hands that reach this ending under saved play; it does not reveal either player’s private cards.</p><ReachNote reach={node.reach} privateHand={false} /></>
                : <p className={styles.notice}>No compatible private hands exist at this public state. Return to the turn start to choose another path.</p>}
          </section>
        </article>
      </div>
    </div>
  </main>;
}
