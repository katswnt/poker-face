"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { LiveDeployment } from "@/lib/solver/bridge/live/deployment-node";
import { PlayController, type PlayView } from "@/lib/hu-play/ui-controller";
import { browserPlayFactory } from "@/lib/hu-play/ui-browser";
import { actionToken, illegalActionReason, sizedActionBounds } from "@/lib/hu-play/public-state";
import type { BridgeAction, BridgePlayer } from "@/lib/solver/bridge/contract";
import { cardText } from "@/lib/drills/solver/tree";
import DecisionMath, { actionName, bb } from "./DecisionMath";
import styles from "./play.module.css";

const ranks:Record<string,string>={A:"Ace",K:"King",Q:"Queen",J:"Jack",T:"Ten"};
const suits:Record<string,string>={c:"clubs",d:"diamonds",h:"hearts",s:"spades"};
function Card({value}:{value:string}) {return <span className={styles.card} role="img" aria-label={`${ranks[value[0]]??value[0]} of ${suits[value[1]]}`}>{cardText(value)}</span>;}
function cards(combo:string) {return [combo.slice(0,2),combo.slice(2,4)].map(c=><Card key={c} value={c}/>);}
function download(controller:PlayController) {
  const log=controller.completedLog(),url=URL.createObjectURL(new Blob([JSON.stringify(log,null,2)+"\n"],{type:"application/json"}));
  const a=document.createElement("a");a.href=url;a.download=`poker-face-hand-${log.config.handSeed}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export default function PlayTable({deployment}:{deployment:LiveDeployment|null}) {
  const [view,setView]=useState<PlayView|null>(null),[seat,setSeat]=useState("0"),[seed,setSeed]=useState("0");
  const [amount,setAmount]=useState(""),[error,setError]=useState(""),[hints,setHints]=useState(false),[selected,setSelected]=useState("");
  const [elapsed,setElapsed]=useState(0),[seedError,setSeedError]=useState("");
  const [activeController,setActiveController]=useState<PlayController|null>(null);
  const controller=useRef<PlayController|null>(null),unsubscribe=useRef<(()=>void)|null>(null),status=useRef<HTMLParagraphElement>(null);
  const phase=view?.phase??"idle",busy=["loading","thinking","cancelling"].includes(phase),h=view?.hand;
  const complete=phase==="complete",ledger=view?.ledger??[],canDeal=!busy&&(!h||complete);
  const bounds=h ? sizedActionBounds(h.public) : null;
  const decision=view?.decisions.find(d=>d.key===selected)??view?.decisions.at(-1);
  const facing=h ? Math.max(...h.public.streetPut)-h.public.streetPut[h.humanSeat] : 0;
  const actualAmount=amount==="" ? bounds?.min??0 : Number(amount);
  useEffect(()=>()=>{unsubscribe.current?.();controller.current?.dispose();controller.current=null;},[]);
  useEffect(()=>{if(!busy)return;const start=performance.now();const t=setInterval(()=>setElapsed(performance.now()-start),250);return()=>clearInterval(t);},[busy]);
  function getController() {
    if(!deployment)throw new Error("Live play assets are not installed.");
    if(!controller.current){
      const deviceMemoryGiB=(navigator as Navigator&{deviceMemory?:number}).deviceMemory;
      const c=new PlayController(browserPlayFactory(deployment.assetBase,{profile:"unknown",...(deviceMemoryGiB===undefined?{}:{deviceMemoryGiB})}));
      controller.current=c;setActiveController(c);unsubscribe.current=c.subscribe(()=>setView(c.getSnapshot()));
    }
    return controller.current;
  }
  async function deal() {
    if(!canDeal)return;
    const n=Number(seed);
    if(!/^\d+$/.test(seed)||!Number.isSafeInteger(n)||n<0||n>0xffffffff){setSeedError("Use a whole hand seed from 0 to 4294967295.");return;}
    setSeedError("");setError("");setHints(false);setSelected("");setAmount("");setElapsed(0);
    try {
      const c=getController(),humanSeat=(seat==="alternate" ? ledger.length%2 : Number(seat)) as BridgePlayer;
      status.current?.focus();await c.start(n,humanSeat);
      if(controller.current===c&&["human","complete"].includes(c.getSnapshot().phase))setSeed(String((n+1)>>>0));
    }catch(e){setError(e instanceof Error?e.message:String(e));}
  }
  async function act(action:BridgeAction) {
    if(!h||phase!=="human")return;
    const illegal=illegalActionReason(h.public,action);if(illegal){setError(illegal);return;}
    setError("");setAmount("");setSelected("");setElapsed(0);status.current?.focus();await controller.current!.act(action);
  }
  function bet(){if(!bounds)return;if(!Number.isSafeInteger(actualAmount)||actualAmount<bounds.min||actualAmount>bounds.max){setError(`Enter a whole chip total from ${bounds.min} to ${bounds.max}.`);return;}void act({type:bounds.type,to:actualAmount});}
  return <main className={styles.page}><div className={styles.shell}>
    <a className={styles.skip} href="#play-table">Skip to the poker table</a>
    <header className={styles.header}>
      <nav aria-label="Play navigation"><Link href="/">← Poker Face</Link><a href="/solver/live">Live turn &amp; river solver</a><Link href="/solver/flop">Saved flop library</Link><Link href="/drills">Math drills</Link></nav>
      <p className={styles.eyebrow}>Heads-up practice · 100bb formation · no GPU training</p>
      <h1>Play the solver-backed AI</h1>
      <p>Play a hand. Then look at the price, the possible hands, and where each decision came from.</p>
      <p>Preflop is scripted: BTN opens to 2.5bb and BB calls, with a folded small blind’s 0.5bb left in the pot.
        We use hand-written ranges and 12 saved flops—not a solved preflop strategy.</p>
      <p>Approximate strategies for specific finite games, not exact GTO. Local re-solving is not a global guarantee.</p>
      <aside className={styles.warning} aria-label="Known AI weakness"><p><strong>Unusual bet sizes can exploit this AI.</strong> The P2 audit measured composed-policy local exploitability as high as
        {" "}23.4% of the subgame pot. That is not your expected win rate or a bound for every hand.</p><a href="https://github.com/katswnt/poker-face/blob/main/tasks/heads-up-play-p2-river.md">Read the measured P2 audit</a></aside>
    </header>
    <div className={styles.layout}>
      <section className={styles.tableArea} id="play-table" tabIndex={-1} aria-labelledby="play-table-title">
        <h2 id="play-table-title">Your table</h2>
        <form className={styles.setup} onSubmit={e=>{e.preventDefault();void deal();}}>
          <fieldset disabled={!canDeal}><legend>Next deal settings</legend>
            <label htmlFor="play-seat">Your seat</label><select id="play-seat" value={seat} onChange={e=>setSeat(e.target.value)} aria-describedby="play-position">
              <option value="0">BB — act first</option><option value="1">BTN — act second</option><option value="alternate">Alternate seats</option></select>
            <p id="play-position" className={styles.note}>Position means who acts first and who acts second on each street.</p>
            <label htmlFor="play-seed">Hand seed</label><input id="play-seed" value={seed} inputMode="numeric" maxLength={10} onChange={e=>{setSeed(e.target.value);setSeedError("");}}
              aria-invalid={!!seedError} aria-describedby={`play-seed-help${seedError?" play-seed-error":""}`}/>
            <p id="play-seed-help" className={styles.note}>Same seed and choices reproduce the hand. The next seed advances by one. Each deal resets to 100bb.</p>
            {seedError&&<p id="play-seed-error" role="alert" className={styles.error}>{seedError}</p>}
          </fieldset>
          {!deployment&&<p className={styles.warning}>Live play assets are not installed in this build. No substitute AI runs. <a href="/solver/live">Explore the saved teaching example</a>.</p>}
          <button type="submit" className={styles.primary} disabled={!canDeal||!deployment}>{h&&complete?"Deal next hand":"Deal hand"}</button>
          {h&&!complete&&<p className={styles.note}>Finish this hand before dealing another. Cancel pauses a calculation; it does not undo completed bets.</p>}
        </form>
        <p ref={status} tabIndex={-1} id="play-status" role="status" aria-live="polite">{view?.message??"Choose your seat, then deal a hand."}</p>
        {error&&<p id="play-input-error" role="alert" className={styles.error}>{error}</p>}
        {busy&&<div className={styles.thinking}>
          <p>Elapsed: {(elapsed/1000).toFixed(1)} seconds. No percentage complete is estimated.</p>
          {view?.progress&&<p>{view.progress.street}: {view.progress.stage}. Completed iterations: {view.progress.iterations??"not available yet"}.
            {view.progress.exploitability!==null&&<> Last measured exploitability: {view.progress.exploitability.toFixed(6)} chips at iteration {view.progress.measuredAtIteration}.</>}</p>}
          <button aria-disabled={phase==="cancelling"} onClick={()=>{status.current?.focus();controller.current?.cancel();}}>Cancel thinking</button>
        </div>}
        {(phase==="cancelled"||phase==="error")&&<div className={styles.buttons}><button onClick={()=>{setError("");setElapsed(0);void controller.current?.resume();}}>Retry pending decision</button></div>}
        <p className={styles.note}>Turn solves can take tens of seconds, especially in Firefox. Phone performance is unvalidated. Browser limits may refuse a game; no ranges are silently trimmed.</p>
        {h&&<>
          <section className={styles.felt} aria-label="Current hand">
            <p>Hand seed {h.seed} · {h.public.street} · you are {h.humanSeat===0?"BB (first)":"BTN (second)"}</p>
            <div className={styles.seat}><h3>AI</h3><p>{h.aiHand?`AI cards: ${h.aiHand}`:"AI cards: hidden"}</p>
              {h.aiHand&&<div className={styles.cards}>{cards(h.aiHand)}</div>}<p>Stack: {bb(h.finalStacks?.[1-h.humanSeat]??h.public.stacks[1-h.humanSeat])}</p></div>
            <div className={styles.board} aria-label="Board cards">{[...h.public.board.flop,...(h.public.board.turn?[h.public.board.turn]:[]),...(h.public.board.river?[h.public.board.river]:[])].map(c=><Card key={c} value={c}/>)}</div>
            <p className={styles.pot}>{complete?"Final pot (already awarded)":"Pot, including uncalled bets"}: {bb(h.public.pot)}</p>
            <div className={styles.seat}><h3>You</h3><div className={styles.cards}>{cards(h.humanHand)}</div><p>Stack: {bb(h.finalStacks?.[h.humanSeat]??h.public.stacks[h.humanSeat])}</p></div>
          </section>
          {phase==="human"&&<section aria-label="Your actions" className={styles.actions}>
            <div className={styles.buttons}>{facing>0?<><button onClick={()=>void act({type:"fold"})}>Fold</button><button onClick={()=>void act({type:"call"})}>Call {bb(facing)}</button></>
              :<button onClick={()=>void act({type:"check"})}>Check</button>}</div>
            {bounds&&<form onSubmit={e=>{e.preventDefault();bet();}}>
              <label htmlFor="play-size-slider">Size in chips (street total)</label>
              <input id="play-size-slider" type="range" min={bounds.min} max={bounds.max} step={1} value={Math.min(bounds.max,Math.max(bounds.min,Number.isFinite(actualAmount)?actualAmount:bounds.min))}
                onChange={e=>{setAmount(e.target.value);setError("");}} aria-describedby="play-size-help"/>
              <label htmlFor="play-size">Bet or raise to (chips)</label>
              <input id="play-size" type="text" inputMode="numeric" value={amount===""?String(bounds.min):amount} onChange={e=>{setAmount(e.target.value);setError("");}}
                aria-invalid={!!error} aria-describedby={`play-size-help${error?" play-input-error":""}`}/>
              <button type="submit" className={styles.primary}>{bounds.type==="bet"?"Place bet":"Raise"}</button>
              <p id="play-size-help" className={styles.note}>Whole chips: {bounds.min}–{bounds.max}. 100 chips = 1bb. The amount is your total on this street, not extra chips.
                {Number.isSafeInteger(actualAmount)&&actualAmount>=bounds.min&&actualAmount<=bounds.max&&<> Add {actualAmount-h.public.streetPut[h.humanSeat]} chips now ({bb(actualAmount-h.public.streetPut[h.humanSeat])}).</>} Off-menu sizes are allowed.</p>
            </form>}
          </section>}
          {decision&&<div className={styles.buttons}><button aria-expanded={hints||complete} aria-controls="play-inspector" onClick={()=>setHints(x=>!x)} disabled={complete}>{hints||complete?"Decision hints shown":"Show decision hints"}</button>
            {complete&&<button onClick={()=>download(controller.current!)}>Download completed hand</button>}</div>}
          <section className={styles.history}><h2>Hand history</h2>
            <p>Scripted preflop: BTN 2.5bb, BB 2.5bb, external dead small blind 0.5bb. Flop: {h.public.flop.map(cardText).join(" ")}.</p>
            <ol>{h.public.events.map((e,i)=><li key={i}>{e.kind==="card"?`${e.street}: ${cardText(e.card)}`:`${e.player===h.humanSeat?"You":"AI"}: ${actionName(e.action)} (${actionToken(e.action)})`}</li>)}</ol>
          </section>
        </>}
        <section className={styles.ledger}><h2>This practice session</h2><p>{ledger.length} completed {ledger.length===1?"hand":"hands"} · your net: {bb(ledger.reduce((s,r)=>s+r.humanNet,0))}</p>
          <p className={styles.note}>Only finished hands count. Each deal starts fresh at 100bb; the folded small blind adds 0.5bb per hand.
            Both players’ nets therefore sum to +0.5bb per completed hand, not zero. Stored only until you leave or reload this page.</p>
          {ledger.length>0&&<table><caption>Completed hands</caption><thead><tr><th scope="col">Seed</th><th scope="col">Your net</th><th scope="col">AI net</th></tr></thead>
            <tbody>{ledger.map(r=><tr key={r.id}><th scope="row">{r.seed}</th><td>{bb(r.humanNet)}</td><td>{bb(r.aiNet)}</td></tr>)}</tbody></table>}
        </section>
      </section>
      <aside className={styles.inspector} id="play-inspector" aria-label="Decision teaching panel">
        {h&&view&&decision&&(hints||complete)&&activeController?<>
          <label htmlFor="play-inspect">Decision to inspect</label><select id="play-inspect" value={decision.key} onChange={e=>setSelected(e.target.value)}>
            {view.decisions.map((d,i)=><option key={d.key} value={d.key}>{i+1}. {d.public.street} · {d.actor==="human"?"You":"AI"}</option>)}</select>
          <DecisionMath key={`${h.seed}|${decision.key}`} decision={decision} controller={activeController} complete={complete} aiHand={h.aiHand} history={h.public}/>
        </>:<><h2>Learn from each decision</h2><p>During play, choose “Show decision hints” for the price and your equity against the AI’s range.
          After the hand, inspect the AI’s hand-specific mix and the source of each decision.</p><p>The AI’s actual cards and mix stay hidden until the hand is complete.</p></>}
      </aside>
    </div>
    <footer className={styles.footer}><h2>Engine and source</h2><p>Flops use saved strategies and action translation, sometimes a labelled passive call rule.
      Turn and river decisions use bounded single-thread browser solves. This page does not use the unfinished turn cache.</p>
      {deployment?<><a href={deployment.sourceArchive}>Download corresponding AGPL engine source</a><dl className={styles.identity}>
        <dt>Build SHA-256</dt><dd><code>{deployment.buildHash}</code></dd><dt>Engine source SHA-256</dt><dd><code>{deployment.sourceHash}</code></dd>
        <dt>Source archive SHA-256</dt><dd><code>{deployment.sourceArchiveHash}</code></dd></dl></>:<p>No live engine is served by this build.</p>}
      <a href="https://github.com/katswnt/poker-face">Poker Face source, roadmap and reproduction instructions (AGPL-3.0-or-later)</a>
    </footer>
  </div></main>;
}
