import {riverCardObject} from "@/lib/solver/river/cards";
import type {EquityRangeDetail} from "@/lib/drills/equity-range/model";
import {Cards,cardWords} from "./DrillCards";
import styles from "./drills.module.css";

export function EquityRangeContext({detail}:{readonly detail:EquityRangeDetail}) {
  const {result}=detail,{input}=result;
  const removed=result.rows.filter(r=>r.blockedBy.length).length;
  return <section className={styles.solverPanel} aria-label="Equity assumptions and opponent range">
    <p className={styles.small}>Equity means your average share of the pot if no more bets are made. A split pot counts as half. Assume the opponent has one of the hands below; these hand-written weights are practice assumptions, not a prediction of how someone plays.</p>
    <table className={styles.equityRangeTable}>
      <caption>Opponent&apos;s possible hands</caption>
      <thead><tr><th scope="col">Hand</th><th scope="col">Weight and chance</th></tr></thead>
      <tbody>{result.rows.map(row=><tr key={row.cards.join("")}>
        <th scope="row"><Cards cards={row.cards.map(riverCardObject)} /></th>
        <td>Weight {row.weight}<br />{row.blockedBy.length ? <>
          Removed: {row.blockedBy.map(c=>`${cardWords(riverCardObject(c))} is ${input.hero.includes(c)?"in your hand":"on the board"}`).join("; ")}.
        </> : <>{row.weight}/{result.weightSum} of the remaining range</>}</td>
      </tr>)}</tbody>
    </table>
    <p className={styles.small}>A weight of 2 means twice as likely as a weight of 1 before removal. {removed} impossible {removed===1?"hand is":"hands are"} removed because a card is already visible. Remaining weights add to {result.weightSum}; divide each weight by that total. This is card removal, also called blockers.</p>
  </section>;
}

export function EquityRangePanel({detail}:{readonly detail:EquityRangeDetail}) {
  const {result}=detail;
  const compatible=result.rows.filter(r=>r.runouts>0).length,runouts=result.input.board.length===4?44:1;
  return <div className={styles.solverExplain}>
    <p className={styles.small}>{result.outcomeCount} distinct hand/runout outcomes: {compatible} possible opponent hands × {runouts} {runouts===1?"completed board":"remaining river cards per hand"}. {runouts===44?"Each opponent hand removes two more cards: 52 − 2 yours − 4 on the board − 2 theirs = 44.":"The board is complete, so there are no future cards to draw."}</p>
    <p className={styles.small}>The weighted total is {result.weightedOutcomes}: {result.weightedWins} wins, {result.weightedTies} splits and {result.weightedLosses} losses after applying the stated weights. These weights are not additional distinct outcomes or random trials. Every outcome was enumerated; no Monte Carlo sampling was used.</p>
    <details className={styles.details}>
      <summary>Counts and question source</summary>
      <ul className={styles.equityCounts}>{result.rows.map(row=><li key={row.cards.join("")}>
        <Cards cards={row.cards.map(riverCardObject)} />: {row.blockedBy.length?"removed; no runouts":`Wins: ${row.wins}; splits: ${row.ties}; losses: ${row.losses}; total: ${row.runouts}`}. Weight {row.weight}.
      </li>)}</ul>
      <p>36 hand-written turn/river examples, 12 per level. Cases are sampled evenly within a level for practice, not by how often they occur in real play. The counts were checked with two independent hand evaluators. Equity for these exact inputs does not make the range a solved strategy or supply a call value.</p>
      <p className={styles.dataIdentity}>Case {result.input.id}. Dataset SHA-256: {detail.datasetId}.</p>
      <p><a href="https://github.com/katswnt/poker-face/blob/main/tasks/drills-equity-range-d2-inputs.json">Frozen practice inputs</a> · <a href="/drill-data/equity-range-v1/cases.json">Download exact counts</a></p>
    </details>
  </div>;
}
