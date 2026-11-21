import type {PushFoldDetail} from "@/lib/drills/push-fold/model";
import styles from "./drills.module.css";

const pct=(n:number)=>(100*n).toFixed(1)+"%";
export function PushFoldContext() {
  return <p className={styles.small}>Two players, equal starting stacks. The small blind folds or
    shoves; the big blind folds or calls. No limps, smaller raises, or later betting.
    The opponent uses the saved approximate strategy for this restricted game.</p>;
}
export function PushFoldPanel({detail:d}:Readonly<{detail:PushFoldDetail}>) {
  return <div className={styles.solverExplain}>
    <table className={styles.pushFoldTable}>
      <caption>Saved strategy and action values</caption>
      <thead><tr><th scope="col">Action</th><th scope="col">Plays</th><th scope="col">Value (bb)</th></tr></thead>
      <tbody>{d.actions.map(a=><tr key={a.id}><th scope="row">{a.label}</th><td>{pct(a.grade.frequency)}</td><td>{a.grade.evBb.toFixed(3)}</td></tr>)}</tbody>
    </table>
    <p className={styles.small}>Value means expected gain relative to folding now. The action gap is
      {" "}<strong>{d.gapBb.toFixed(3)} bb</strong>. Values and frequencies are rounded for display;
      grading uses the stored unrounded values. 0.01 bb is the practice tolerance, not a bound on solver error.</p>
    <dl className={styles.explanation}>
      <div><dt>{d.seat==="sb"?"Your equity if called":"Your equity against the shoving range"}</dt>
        <dd>{d.equity===null?"No compatible calling hands":pct(d.equity)} — your average share of the pot at showdown, including split pots.</dd></div>
      {d.foldProbability!==null && <div><dt>Opponent folds to your shove</dt><dd>{pct(d.foldProbability)} with your cards removed from their possible hands.</dd></div>}
      {d.requiredEquity!==null && <div><dt>Equity needed to call</dt><dd>{d.stack-1} ÷ {2*d.stack} = {pct(d.requiredEquity)}. This price includes the blinds already in the pot.</dd></div>}
      <div><dt>Why your cards matter</dt><dd>Your cards remove impossible opponent hands. Equity is weighted by how often each remaining hand calls or shoves in the saved strategy.</dd></div>
    </dl>
    <details className={styles.details}>
      <summary>Model, quality and question source</summary>
      <p>Approximate strategy for a specific shove-or-fold game, not universal or exact GTO.
        The 169 hand classes share strategies across suits. Showdown equities come from exact
        board enumeration stored to six decimals. This fixed matrix and the rounded saved strategy
        are what these action values grade.</p>
      <p>Combined best-response gain for this full {d.stack} bb game: {d.nashGapBb.toFixed(8)} bb.
        This is the sum of both players&apos; possible gains from changing strategy alone,
        weighted over all deals. It does not bound the error of each hand&apos;s action values.</p>
      <p>Questions sample hand classes uniformly within the selected difficulty, not in real-deal
        proportions. New questions use this dataset; reviews keep the exact saved hand and seat.</p>
      <p className={styles.dataIdentity}>Dataset SHA-256: {d.datasetId}</p>
      <p><a href="https://github.com/katswnt/poker-face/blob/main/tasks/drill-expansion-plan.md">Read the formulas, scope and reproduction contract</a></p>
    </details>
  </div>;
}
