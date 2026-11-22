"use client";
import { useEffect, useRef, useState } from "react";
import { reviewDecision, serializeReview, type CompletedReview, type ReviewCollection } from "@/lib/hu-play/review";
import { TeachingClient } from "@/lib/hu-play/teaching-client";
import type { TeachingEvent } from "@/lib/hu-play/teaching-worker";
import { cardText } from "@/lib/drills/solver/tree";
import { actionName, bb } from "./DecisionMath";
import styles from "./review.module.css";

const pct=(n:number)=>`${(n*100).toFixed(2)}%`;
const ranks:Record<string,string>={A:"Ace",K:"King",Q:"Queen",J:"Jack",T:"Ten"};
const suits:Record<string,string>={c:"clubs",d:"diamonds",h:"hearts",s:"spades"};
function Cards({values}:{values:readonly string[]}) {return <span className={styles.cards}>{values.map(c=><span key={c} className={styles.card}
  role="img" aria-label={`${ranks[c[0]]??c[0]} of ${suits[c[1]]}`}>{cardText(c)}</span>)}</span>;}
function download(r:CompletedReview){
  const url=URL.createObjectURL(new Blob([serializeReview(r)],{type:"application/json"})),a=document.createElement("a");
  a.href=url;a.download=`poker-face-review-${r.id}-seed-${r.hand.seed}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function ReviewMath({review,index}:{review:CompletedReview;index:number}){
  const x=reviewDecision(review,index),d=x.decision,p=d.provenance;
  const [equity,setEquity]=useState<TeachingEvent|null>(null),client=useRef<TeachingClient|null>(null);
  useEffect(()=>()=>{client.current?.dispose();},[]);
  function calculate(){client.current?.dispose();setEquity({type:"progress",id:0,progress:{completedHands:0,totalHands:0,outcomes:0}});const c=new TeachingClient(setEquity);client.current=c;c.start(x.equityInput);}
  const waiting=equity?.type==="progress",quality=p.source==="resolve"?p:p.source==="translation"?p.responseSolve:null;
  const source=p.source==="library"?"Original saved policy":p.source==="translation"?"Translated action or passive rule":"Local solved policy";
  return <div>
    <h3>Decision {index+1} of {review.decisions.length}</h3>
    <p>{d.actor==="human"?"You":"AI"} · {d.public.toAct===0?"BB (acts first on each street)":"BTN (acts second on each street)"} · {d.public.street}.</p>
    <p>Board at this decision</p><Cards values={x.equityInput.board}/>
    <p>Your cards</p><Cards values={[review.hand.humanHand.slice(0,2),review.hand.humanHand.slice(2,4)]}/>
    <p>Pot: {bb(d.public.pot)}, including any uncalled bet. Stacks behind: BB {bb(d.public.stacks[0])}, BTN {bb(d.public.stacks[1])}.</p>
    <p><strong>Action taken: {actionName(x.action)}.</strong></p>
    <h4>Price of this decision</h4>
    {x.price?<>
      <ul aria-label="Decision price math">
        <li>Call price: {x.price.call} chips ({bb(x.price.call)})</li>
        <li>Pot odds: {pct(x.price.requiredEquity)}</li>
        <li>Minimum defence: {pct(x.price.minimumDefence)}</li>
        <li>Polar bluff share: {pct(x.price.polarBluffShare)}</li>
      </ul>
      <p>Calling risks {x.price.call} for a final pot of {x.price.potBeforeCall+x.price.call} chips.
        Minimum defence uses {x.price.potBeforeAggression} ÷ ({x.price.potBeforeAggression} + {x.price.aggressorRisk});
        the bettor’s added chips can differ from the call price after a raise.</p>
      <p className={styles.note}>Minimum defence is a benchmark against a bluff that always loses when called, not a required calling frequency.
        Polar bluff share assumes perfectly strong hands or hopeless bluffs and no more betting.</p>
    </>:<p>No bet was faced. Call price, pot odds, minimum defence and polar bluff share do not apply.</p>}
    <h4>The recorded model</h4>
    <p>{source}. {d.actor==="ai"?"These frequencies concern the AI’s actual hand, shown only after completion.":"These frequencies concern your hand in that model."}</p>
    {d.strategy?<table><caption>Recorded action values and frequencies</caption>
      <thead><tr><th scope="col">Action</th><th scope="col">Frequency</th><th scope="col">EV (bb)</th></tr></thead>
      <tbody>{d.strategy.map((a,i)=><tr key={i}><th scope="row">{actionName(a.action)}</th><td>{pct(a.probability)}</td>
        <td>{d.actionEvs?.[i]===null||d.actionEvs?.[i]===undefined?"Unavailable":(d.actionEvs[i]!/100).toFixed(3)}</td></tr>)}</tbody>
    </table>:<p>No usable hand column was recorded; action values are unavailable.</p>}
    <p className={styles.note}>EV means expected chips returned from here minus chips still to pay. Earlier contributions are spent.
      {d.actionEvBasis==="original-saved-policy"?" These values belong to the original saved policy, rounded to 0.1 chip.":
        d.actionEvBasis==="local-solved-policy"?" These values follow this particular local solved strategy.":" No supported action-value model was recorded here."}
      {" "}They do not predict the AI after later re-solving.</p>
    {d.actor==="human"&&(x.grade.status==="ready"?<p><strong>{x.grade.basis==="original-saved-policy"?"Saved-model":"Local-model"} EV gap: {(x.grade.gapChips/100).toFixed(3)} bb.</strong>
      {" "}Best listed {(x.grade.bestEvChips/100).toFixed(3)} bb minus chosen {(x.grade.selectedEvChips/100).toFixed(3)} bb.</p>
      :<p>EV comparison unavailable: {x.grade.status==="unavailable"&&x.grade.reason==="off-menu"?"this action is outside the recorded menu."
        :"this decision has no complete supported value row. Translated choices are not graded."}</p>)}
    <p className={styles.note}>This is not a score against the composed AI. Gaps are not added across hands or models.
      Values and gaps are displayed to 0.1 chip (0.001 bb); saved-value rounding can move a gap by up to 0.1 chip.
      Display rounding does not bound solver or range errors. A zero gap is not a claim of GTO correctness.</p>
    <h4>Your equity against the recorded AI range</h4>
    <p>This uses your cards, this earlier board and the AI’s possible hands at that time. It assumes no further betting and is not call EV.
      The AI’s actual hand and the later cards do not enter this calculation.</p>
    {equity===null?<p>Equity has not been calculated for this decision.</p>
      :equity.type==="progress"?<p role="status">Enumerating: {equity.progress.completedHands} of {equity.progress.totalHands} hands,
        {" "}{equity.progress.outcomes.toLocaleString("en-US")} outcomes checked.</p>
      :equity.type==="result"?<>
        <p>{equity.result.equity===null?"Unavailable: no compatible range remains.":`Exact all-in equity: ${pct(equity.result.equity)}.`}</p>
        <p>{equity.result.compatibleHands} compatible hands · {equity.result.outcomes.toLocaleString("en-US")} hand/runout outcomes · no Monte Carlo sampling.</p>
        {equity.result.groups.length>0&&<table><caption>Recorded AI range by hand group; categories include the board</caption>
          <thead><tr><th scope="col">Hand group</th><th scope="col">Share</th></tr></thead>
          <tbody>{equity.result.groups.map(g=><tr key={g.label}><th scope="row">{g.label}</th><td>{pct(g.share)}</td></tr>)}</tbody></table>}
      </>:<p role={equity.type==="error"?"alert":"status"}>{equity.type==="error"?equity.message:"Equity calculation cancelled. No partial answer is shown."}</p>}
    {waiting?<button onClick={()=>client.current?.cancel()}>Cancel review equity</button>
      :equity?.type!=="result"&&<button onClick={calculate}>Calculate range equity</button>}
    <h4>Where the model came from</h4>
    {quality?<p>{quality.iterations} iterations; reported local exploitability {quality.exploitabilityPctPot===null?"unavailable":`${quality.exploitabilityPctPot.toFixed(4)}% of the subgame pot`}.
      This does not bound this hand’s error or the full AI.</p>:<p>No live-solve quality number applies to this saved policy or rule.</p>}
    {p.source==="translation"&&<p>Translated using a public seeded draw: {pct(p.probabilityA)} chance of the smaller reference;
      selected the {p.mappedTo==="a"?"smaller":"larger"} reference. Real chips were still paid. A passive rule may follow a translated flop.</p>}
    {p.ladder&&<p>Range handling: {p.ladder.rung}; pruned mass BB {pct(p.ladder.prunedMass[0])}, BTN {pct(p.ladder.prunedMass[1])}.</p>}
    <p>The AI reach follows its played action probabilities. Your range in its solve is a model, not knowledge of your cards.</p>
    <details><summary>Recorded decision identity</summary><p>Spot SHA-256: <code>{p.spotHash}</code></p>
      <p>Public path: <code>{d.key}</code></p><p>Range source: {x.equityInput.aiRange.source}.</p>
      <p>{x.equityInput.aiRange.entries.length} recorded range rows before removing your blockers. The download includes every weight and value.</p>
      {d.humanActionMode&&<p>Action preparation: {d.humanActionMode}</p>}</details>
  </div>;
}
function ReviewHand({review:r}:{review:CompletedReview}){
  const [index,setIndex]=useState(0);
  return <>
    <p>Hand {r.id} · seed {r.hand.seed} · you were {r.hand.humanSeat===0?"BB (first)":"BTN (second)"}.</p>
    <label htmlFor="review-decision">Review decision</label>
    <select id="review-decision" value={index} onChange={e=>setIndex(Number(e.target.value))}>{r.decisions.map((row,i)=><option key={row.eventIndex} value={i}>
      {i+1}. {row.decision.public.street} · {row.decision.actor==="human"?"You":"AI"}</option>)}</select>
    <div className={styles.controls}>
      <button disabled={index===0} onClick={()=>setIndex(i=>i-1)}>Previous decision</button>
      <button disabled={index===r.decisions.length-1} onClick={()=>setIndex(i=>i+1)}>Next decision</button>
    </div>
    <ReviewMath key={index} review={r} index={index}/>
    <details><summary>Final result and revealed cards</summary>
      <p>Your net: {bb(r.ledger.humanNet)}; AI net: {bb(r.ledger.aiNet)}. The external dead blind adds 0.50 bb to their sum.</p>
      <p>AI cards</p><Cards values={[r.hand.aiHand.slice(0,2),r.hand.aiHand.slice(2,4)]}/>
      <p>Final public board</p><Cards values={[...r.hand.public.board.flop,...(r.hand.public.board.turn?[r.hand.public.board.turn]:[]),...(r.hand.public.board.river?[r.hand.public.board.river]:[])]}/>
      <p>Winning does not prove a good decision; losing does not prove a mistake.</p>
    </details>
    <details><summary>Review file and build identity</summary>
      <p>Download includes this completed hand’s cards, original ranges, action values and provenance. JSON format version 1. The app cannot yet import these files.</p>
      <button onClick={()=>download(r)}>Download this review</button>
      <p>Build SHA-256: <code>{r.identity.buildHash}</code></p><p>Engine source SHA-256: <code>{r.identity.engineSourceHash}</code></p>
    </details>
  </>;
}
export default function HandReview({collection,error}:{collection:ReviewCollection;error:string}){
  const [open,setOpen]=useState(false),[selected,setSelected]=useState<number|null>(null);
  const r=collection.reviews.find(r=>r.id===selected)??collection.reviews.at(-1);
  return <section className={styles.review} id="play-review" tabIndex={-1} aria-labelledby="review-title">
    <h2 id="review-title">Learn from completed hands</h2>
    <p>Keep up to 20 completed hands in this tab, within an 8 MiB serialized-data limit. Oldest reviews are removed first.
      Reloading or leaving this page clears them. Review does not run another solve.</p>
    {error&&<p role="alert">Review unavailable for the latest hand: {error} Your hand and ledger remain available.</p>}
    {collection.evicted>0&&<p>{collection.evicted} older {collection.evicted===1?"review was":"reviews were"} removed to keep memory bounded.</p>}
    {!r?<p>Finish a hand to review its decisions.</p>:<details onToggle={e=>setOpen(e.currentTarget.open)}>
      <summary>Review completed hands</summary>
      {open&&<section aria-label="Completed-hand review">
        <p>Review the model recorded at each decision. Later cards do not rewrite its range or values.</p>
        <label htmlFor="review-hand">Completed hand</label><select id="review-hand" value={r.id} onChange={e=>setSelected(Number(e.target.value))}>
          {collection.reviews.map(h=><option key={h.id} value={h.id}>Hand {h.id} · seed {h.hand.seed} · {h.hand.humanSeat===0?"BB":"BTN"}</option>)}</select>
        <ReviewHand key={r.id} review={r}/>
      </section>}
    </details>}
  </section>;
}
