"use client";
import { useEffect, useRef, useState } from "react";
import type { PlayController, PlayDecisionView } from "@/lib/hu-play/ui-controller";
import { decisionPrice } from "@/lib/hu-play/teaching";
import { TeachingClient } from "@/lib/hu-play/teaching-client";
import type { TeachingEvent } from "@/lib/hu-play/teaching-worker";
import type { FlopDescription } from "@/lib/hu-play/sources/flop-play";
import type { BridgeAction } from "@/lib/solver/bridge/contract";
import { actionToken } from "@/lib/hu-play/public-state";
import { gradePlayDecision } from "@/lib/hu-play/decision-grade";
import type { HeadsUpPublicState } from "@/lib/hu-play/types";
import styles from "./play.module.css";

const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
export const bb = (chips: number) => `${(chips / 100).toFixed(2)} bb`;
export function actionName(action: BridgeAction): string {
  return action.type === "bet" ? `Bet to ${bb(action.to)}` : action.type === "raise" ? `Raise to ${bb(action.to)}`
    : action.type[0].toUpperCase() + action.type.slice(1);
}

export default function DecisionMath({decision:d,controller,complete,aiHand,history}: {
  decision:PlayDecisionView; controller:PlayController; complete:boolean; aiHand:string|null; history:HeadsUpPublicState;
}) {
  const [equity,setEquity] = useState<TeachingEvent|null>(null), [attempt,setAttempt] = useState(0);
  const client = useRef<TeachingClient|null>(null);
  useEffect(() => {
    const c = new TeachingClient(setEquity); client.current=c;
    c.start(controller.equityInput(d.key));
    return () => { c.dispose(); if(client.current===c) client.current=null; };
  },[controller,d.key,attempt]);
  const price=decisionPrice(d.public), p=d.provenance;
  const grade=gradePlayDecision(d,history), localValues=d.actionEvBasis==="local-solved-policy";
  const flop="flop" in p ? p.flop as FlopDescription : null;
  const quality=p.source==="resolve" ? p : p.source==="translation" ? p.responseSolve : null;
  const pending=equity===null || equity.type==="progress";
  const source=p.source==="library" ? "Saved flop library"
    : flop?.passiveContinuation ? "Passive call rule after flop translation"
    : p.source==="translation" ? "Translated action" : p.kind==="nested" ? "New solve including your bet" : "New solve at the start of this street";
  return <section className={styles.math} aria-labelledby="play-math-title">
    <h2 id="play-math-title">The math at this decision</h2>
    <p>{d.actor==="human" ? "Your decision" : "AI decision"} · {d.public.street} · pot includes any uncalled bet: {bb(d.public.pot)}</p>
    {price ? <>
      <dl className={styles.facts}>
        <div><dt>Call price</dt><dd>{price.call} chips · {bb(price.call)}</dd></div>
        <div><dt>Pot odds / break-even equity</dt><dd>{pct(price.requiredEquity)}</dd></div>
        <div><dt>Minimum defence (MDF)</dt><dd>{pct(price.minimumDefence)}</dd></div>
        <div><dt>Polar bluff share</dt><dd>{pct(price.polarBluffShare)}</dd></div>
      </dl>
      <p>Calling risks {price.call} chips for a final pot of {price.potBeforeCall+price.call}:
        {" "}{price.call} ÷ ({price.potBeforeCall} + {price.call}) = {pct(price.requiredEquity)}.</p>
      <p>MDF: {price.potBeforeAggression} ÷ ({price.potBeforeAggression} + {price.aggressorRisk}) = {pct(price.minimumDefence)}.
        The bettor just risked {price.aggressorRisk} chips. After a raise, that risk can differ from your call price.</p>
      <p className={styles.note}>MDF is a benchmark against a bluff that always loses when called—not an instruction to call this often.
        Polar bluff share assumes perfectly strong hands or hopeless bluffs and no further betting. Real ranges are not that simple.</p>
    </> : <p>No bet is faced here. Call price, pot odds, MDF and polar bluff share are not applicable to this check/bet decision.</p>}
    <h3>Exact all-in equity against the AI’s reaching range</h3>
    <p className={styles.note}>Your share if all remaining cards are dealt with no more betting. Your cards remove impossible AI hands; ties split.
      This is exact enumeration against that range, not the value of calling through future bets, and not a claim of exact strategy.</p>
    {pending ? <p role="status">Enumerating compatible hands and runouts… {equity?.type==="progress"
      ? `${equity.progress.completedHands} of ${equity.progress.totalHands} hands; ${equity.progress.outcomes.toLocaleString("en-US")} outcomes checked.` : "Starting the separate teaching Worker."}</p>
      : equity.type==="result" ? <>
        <p className={styles.number}>{equity.result.equity===null ? "Unavailable: no compatible AI range remains." : pct(equity.result.equity)}</p>
        <p>{equity.result.compatibleHands} compatible AI hands · {equity.result.outcomes.toLocaleString("en-US")} hand/runout outcomes · no Monte Carlo sampling.</p>
        {equity.result.groups.length>0 && <table><caption>The AI’s possible hands, weighted by its played actions. Categories include the board.</caption>
          <thead><tr><th scope="col">Hand group</th><th scope="col">Share</th></tr></thead>
          <tbody>{equity.result.groups.map(g=><tr key={g.label}><th scope="row">{g.label}</th><td>{pct(g.share)}</td></tr>)}</tbody></table>}
      </> : <p role={equity.type==="error" ? "alert" : "status"}>{equity.type==="error" ? equity.message : "Equity calculation cancelled. No partial answer is shown."}</p>}
    {pending ? <button onClick={()=>client.current?.cancel()}>Cancel equity calculation</button>
      : equity.type!=="result" && <button onClick={()=>{setEquity(null);setAttempt(n=>n+1);}}>Retry equity calculation</button>}
    <h3>{d.actor==="ai" ? "Why the AI did that" : "What this model does with your hand"}</h3>
    {d.actor==="ai" && !complete ? <p>The AI’s hand-specific mix is hidden until the hand is over.</p>
      : d.strategy ? <>
        {d.actor==="ai" && <p>AI hand: {aiHand}. It draws from this mix; the most frequent action is not mandatory.</p>}
        <table><caption>Approximate strategy at this decision</caption><thead><tr><th scope="col">Action</th><th scope="col">Frequency</th><th scope="col">Action EV (bb)</th></tr></thead>
          <tbody>{d.strategy.map((row,i)=><tr key={actionToken(row.action)}><th scope="row">{actionName(row.action)}</th><td>{pct(row.probability)}</td>
            <td>{d.actionEvs?.[i]===null || d.actionEvs?.[i]===undefined ? localValues ? "Unavailable" : "Not exported" : (d.actionEvs[i]!/100).toFixed(3)}</td></tr>)}</tbody></table>
        <p className={styles.note}>{d.actionEvBasis==="original-saved-policy"
          ? "EVs belong to the original saved policy, rounded to 0.1 chip. They are not values of this composed AI after later re-solving. No live-play grade is inferred from them."
          : localValues ? "EV means expected chips returned from here minus chips still to pay. Earlier contributions are already spent. These values follow this local solved strategy. This does not predict the AI after later re-solving. The strategy is approximate, for this particular finite game."
          : "Action EVs were not exported for this decision. Equity is not substituted for action value."}</p>
      </> : <p>Your actual hand has no usable column in this model at this decision. No strategy or action value is invented.</p>}
    {d.actor==="human" && <>
      <h3>{localValues ? "Your action vs the local model shown before you acted" : "Your action vs the original saved model"}</h3>
      {grade.status==="ready" ? <>
        <p>You chose {actionName(grade.action)}. {grade.basis==="local-solved-policy" ? "Local-model" : "Saved-model"} EV gap: {(grade.gapChips/100).toFixed(3)} bb
          {" "}({grade.gapChips.toFixed(1)} chips).</p>
        <p>Best listed EV: {(grade.bestEvChips/100).toFixed(3)} bb ({grade.bestActions.map(actionName).join(" or ")});
          {" "}your action: {(grade.selectedEvChips/100).toFixed(3)} bb. The gap is best minus chosen.</p>
        {grade.basis==="local-solved-policy" ? <p className={styles.note}>This compares choices using the local model shown before your action.
          Values and gaps are displayed to 0.1 chip (0.001 bb). Display rounding is separate from numerical, solver-convergence and range errors;
          the local exploitability number does not bound the error for each hand. A zero gap is not a claim that an action is GTO-correct.
          Gaps are not added into a session score.</p> : <p className={styles.note}>This compares actions against the original saved policy, not the later re-solving AI.
          Rounding alone can change the gap by up to 0.1 chip (0.001 bb); that is not a bound on solver or model error.
          A zero gap is not a claim that an action is GTO-correct. Gaps are not added into a session score.</p>}
      </> : grade.status==="pending" ? <p>Choose an action first to see its {localValues ? "local-model" : "saved-model"} EV gap.</p>
        : <p>EV grade unavailable: {grade.reason==="off-menu" ? localValues ? "your chosen size is outside this original local menu." : "your chosen size is outside this saved menu."
          : grade.reason==="history-mismatch" ? "this decision does not match the current hand history."
          : "a complete action-value row from this decision’s model is not available here. Translated decisions are not graded."}
          {" "}Equity and action frequency are not substitutes for action EV.</p>}
    </>}
    <h3>Where this decision came from</h3>
    <p>{source}.</p>
    {flop?.passiveContinuation && <p className={styles.warning}>The translated saved line had ended, but a real bet remained. The AI uses a forced call/check rule here—not a solver-selected response. This is exploitable.</p>}
    {p.source==="translation" && <p>The mapping uses a public seeded draw between neighboring supported sizes.
      Chance of the smaller reference: {pct(p.probabilityA)}; selected {p.mappedTo==="a" ? "smaller" : "larger"} reference.
      Real chips are still paid. {p.reason && `Fallback reason: ${p.reason}.`}</p>}
    {quality ? <p>{quality.iterations} iterations · reported local exploitability {quality.exploitabilityPctPot===null ? "unavailable" : `${quality.exploitabilityPctPot.toFixed(4)}% of this subgame’s pot`}.
      This grades one local game, not the full composed AI.</p> : <p>No live-solve quality number applies to this saved decision or rule.</p>}
    <p>{p.ladder ? <>Range handling: {p.ladder.rung}; pruned mass BB {pct(p.ladder.prunedMass[0])}, BTN {pct(p.ladder.prunedMass[1])}.</>
      : "Range handling was not recorded; no retention number is inferred."} No turn cache is enabled on this page.</p>
    <p className={styles.note}>The AI reach follows its actual played action probabilities. Your range in its solve is only a model of how you might have played.
      Position means who acts first and who acts second. A later solve uses the real pot and remaining stacks, but does not make earlier translation safe.</p>
    <details><summary>Decision identity</summary><p>Spot SHA-256: <code>{p.spotHash}</code></p><p>Public path: <code>{d.key}</code></p>
      {d.humanActionMode && <p>Human action preparation: {d.humanActionMode}</p>}</details>
  </section>;
}
