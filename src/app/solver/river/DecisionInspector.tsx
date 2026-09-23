"use client";

import { useState } from "react";
import { riverActionLabel, riverHistoryLabel, type RiverLabDecision, type RiverLabResult } from "@/lib/solver/river/lab/model";
import styles from "./river.module.css";

const percent = (value: number | null) => value === null ? "Not available" : `${(100 * value).toFixed(1)}%`;
const chips = (value: number | null) => {
  if (value === null) return "Not available";
  const rounded = Math.abs(value) < 0.0005 ? 0 : value;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(3)}`;
};

function DecisionDetails({ decision }: { decision: RiverLabDecision }) {
  const { facts } = decision;
  const [actionId, setActionId] = useState(facts.actions.find(action => action.action === "call")?.action ?? facts.actions[0].action);
  const [responseId, setResponseId] = useState("");
  const action = facts.actions.find(candidate => candidate.action === actionId)!;
  const responses = decision.responses.filter(response => response.action === actionId);
  const response = responses.find(candidate => candidate.response === responseId)
    ?? responses.find(candidate => candidate.response === "call") ?? responses[0];
  const call = facts.actions.find(candidate => candidate.action === "call");
  const best = facts.actions.reduce((left, right) => (right.expectedValue ?? -Infinity) > (left.expectedValue ?? -Infinity) ? right : left);

  return <>
    <div className={styles.situation}>
      <div><span>Your hand</span><strong>{facts.privateCards.join(" ")}</strong></div>
      <div><span>Pot on table</span><strong>{facts.pot} chips</strong></div>
      <div><span>Cost to call</span><strong>{decision.callCost} chips</strong></div>
    </div>
    <p className={styles.history}>{riverHistoryLabel(facts.history)}</p>
    {facts.offPath ? <p className={styles.notice} role="status">
      This decision is off path: the saved strategy reaches it too rarely to support a reliable range or action value.
      Frequencies are shown, but they are not a recommendation.
    </p> : <p className={styles.answer}>
      <strong>{riverActionLabel(best.action)}</strong> has the highest measured chip value here.
      Compare the gaps below: close values can support more than one useful choice.
      These values assume both players follow the saved strategy after your choice.
    </p>}

    <h3>Compare your choices</h3>
    <p>Frequency means how often the saved strategy uses an action with this hand at this decision.
      Choose an action to see what can follow.</p>
    <div className={styles.actions}>
      {facts.actions.map(candidate => <button type="button" key={candidate.action}
        aria-pressed={candidate.action === actionId}
        onClick={() => { setActionId(candidate.action); setResponseId(""); }}>
        <span className={styles.actionTitle}><strong>{riverActionLabel(candidate.action)}</strong><strong>{percent(candidate.frequency)}</strong></span>
        <span className={styles.bar} aria-hidden="true"><span style={{ width: `${candidate.frequency * 100}%` }} /></span>
        <span>EV from now: <b>{chips(candidate.expectedAdditionalValue)}</b></span>
        <span>Behind best: <b>{candidate.differenceFromBest === null ? "Not available" : `${candidate.differenceFromBest.toFixed(3)} chips`}</b></span>
      </button>)}
    </div>
    <p className={styles.note}>EV means average chip change. “From now” counts only future payments and money received;
      folding is worth 0 from this point. Earlier contributions are already spent. Gaps use unrounded values.</p>

    {decision.finalCallPot !== null && <section className={styles.inset} aria-labelledby="price-heading">
      <h3 id="price-heading">What price are you getting?</h3>
      <p>You pay {decision.callCost} chips to compete for {decision.finalCallPot} chips after the call.
        You need at least <strong>{percent(decision.callCost / decision.finalCallPot)}</strong> of that pot on average to break even from now.</p>
      <p>Your share against the range that reached this decision is <strong>{percent(call?.showdownEquity ?? null)}</strong>.
        A split pot counts as half a win. Any uncalled chips are returned before this calculation.</p>
    </section>}

    <section className={styles.inset} aria-labelledby="after-heading">
      <h3 id="after-heading">After choosing {riverActionLabel(actionId)}</h3>
      <dl className={styles.metrics}>
        <div><dt>EV from now</dt><dd>{chips(action.expectedAdditionalValue)} chips</dd></div>
        <div><dt>EV from hand start</dt><dd>{chips(action.expectedValue)} chips</dd></div>
        <div><dt>Opponent folds next</dt><dd>{percent(action.immediateOpponentFoldProbability)}</dd></div>
        <div><dt>Share if a showdown happens</dt><dd>{percent(action.showdownEquity)}</dd></div>
      </dl>
      <p className={styles.note}>Showdown share counts ties as half a win and excludes hands that end in a fold.
        It can differ by action because different opponent hands continue.</p>
      <h4>Expected opponent responses</h4>
      {action.immediateOpponentResponses.length ? <ul className={styles.responseList}>
        {action.immediateOpponentResponses.map(item => <li key={item.action}>
          <span>{riverActionLabel(item.action)}</span><strong>{percent(item.probability)}</strong>
        </li>)}
      </ul> : <p>{facts.offPath ? "No reliable response estimate at this off-path decision." : "The hand ends with this action. There is no next response."}</p>}
      {action.immediateOpponentFoldProbability === null && <p className={styles.note}>“Opponent folds next” is unavailable when there is no fold decision to answer, or the decision is off path.</p>}
      <details>
        <summary>All possible ways the hand ends</summary>
        <dl className={styles.metrics}>
          <div><dt>Opponent folds now or later</dt><dd>{percent(action.outcomes.opponentFolds)}</dd></div>
          <div><dt>You fold now or later</dt><dd>{percent(action.outcomes.playerFolds)}</dd></div>
          <div><dt>You win at showdown</dt><dd>{percent(action.outcomes.showdownWin)}</dd></div>
          <div><dt>You split at showdown</dt><dd>{percent(action.outcomes.showdownSplit)}</dd></div>
          <div><dt>You lose at showdown</dt><dd>{percent(action.outcomes.showdownLoss)}</dd></div>
        </dl>
      </details>
    </section>

    <section className={styles.inset} aria-labelledby="range-heading">
      <h3 id="range-heading">How their possible hands change</h3>
      <p>A range is a weighted list of possible hands. These chances use your hand, the board, and the actions so far.
        A blocker is a card you can see that removes a possible opponent hand.</p>
      <p>Your own choice, with your hand already known, does not change this estimate. Their response can.</p>
      {responses.length > 0 && <label className={styles.field}>Opponent response after {riverActionLabel(actionId)}
        <select value={response?.response} onChange={event => setResponseId(event.target.value)}>
          {responses.map(item => <option key={item.response} value={item.response}>{riverActionLabel(item.response)} ({percent(item.probability)})</option>)}
        </select>
      </label>}
      {response && response.probability <= 1e-12 && <p className={styles.notice}>This response has essentially zero probability. Its updated range is not available.</p>}
      <details open={facts.opponentRange.length <= 16}>
        <summary>View all {facts.opponentRange.length} opponent hands</summary>
        <table className={styles.rangeTable}>
          <caption>Opponent range, given your {facts.privateCards.join(" ")}</caption>
          <thead><tr><th scope="col">Hand</th><th scope="col">Now</th>{response && <th scope="col">After {riverActionLabel(response.response)}</th>}</tr></thead>
          <tbody>{facts.opponentRange.map(combo => <tr key={combo.key}>
            <th scope="row">{combo.cards.join(" ")}</th><td>{percent(combo.probability)}</td>
            {response && <td>{percent(response.range.find(item => item.key === combo.key)?.probability ?? null)}</td>}
          </tr>)}</tbody>
        </table>
      </details>
      <p className={styles.note}>Updated weight = current chance × how often that hand takes the response, then rescale to 100%.
        Impossible hands stay at 0%. The solver does not get to see a hidden opponent hand.</p>
    </section>
  </>;
}

export default function DecisionInspector({ result, decision, selectedKey, busy, disabled, choose }: {
  result: RiverLabResult; decision: RiverLabDecision; selectedKey: string; busy: boolean; disabled: boolean;
  choose(key: string): void;
}) {
  const selected = result.decisions.find(item => item.informationSet === selectedKey) ?? result.decisions[0];
  const hands = [...new Set(result.decisions.filter(item => item.player === selected.player).map(item => item.privateCards.join(" ")))];
  const histories = result.decisions.filter(item => item.player === selected.player && item.privateCards.join(" ") === selected.privateCards.join(" "));
  return <section aria-labelledby="decision-heading" aria-busy={busy}>
    <h2 id="decision-heading">Inspect a decision</h2>
    <p>Pick who is acting, their hand, and the actions already taken. All legal decisions are available, including rarely reached ones.</p>
    <div className={styles.pickers}>
      <label className={styles.field}>Who is acting?
        <select value={selected.player} disabled={disabled} onChange={event => choose(result.decisions.find(item => item.player === Number(event.target.value))!.informationSet)}>
          <option value="0">First player (out of position)</option><option value="1">Second player (in position)</option>
        </select>
      </label>
      <label className={styles.field}>Your private hand
        <select value={selected.privateCards.join(" ")} disabled={disabled} onChange={event => choose(result.decisions.find(item => item.player === selected.player && item.privateCards.join(" ") === event.target.value && item.history.join() === selected.history.join())?.informationSet
          ?? result.decisions.find(item => item.player === selected.player && item.privateCards.join(" ") === event.target.value)!.informationSet)}>
          {hands.map(hand => <option key={hand}>{hand}</option>)}
        </select>
      </label>
    </div>
    <label className={styles.field}>Actions before this decision
      <select value={selectedKey} disabled={disabled} onChange={event => choose(event.target.value)}>
        {histories.map(item => <option value={item.informationSet} key={item.informationSet}>{riverHistoryLabel(item.history)}{item.offPath ? " (off path)" : ""}</option>)}
      </select>
    </label>
    {selectedKey === decision.facts.informationSet
      ? <DecisionDetails key={selectedKey} decision={decision} />
      : <p role="status">Loading this decision’s explanation…</p>}
  </section>;
}
