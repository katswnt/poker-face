// Presentational pieces for solver-backed decision questions. Types and formatting only: the
// solver source itself is loaded with a dynamic import by Drills.tsx.
import { fmtChipsBb, fmtPct, fmtSignedChipsBb } from "@/lib/drills/format";
import type { DecisionBand, GradeResult, Question, SolverDetail } from "@/lib/drills/types";
import styles from "./drills.module.css";

export const BAND_LABELS: Readonly<Record<DecisionBand, string>> = {
  best: "Best",
  mixed: "Solver mix",
  inaccuracy: "Close",
  mistake: "Mistake",
  blunder: "Big mistake",
};

const pct = (x: number) => fmtPct(x * 100);

export function SolverHistory({ detail }: Readonly<{ detail: SolverDetail }>) {
  return (
    <div className={styles.history}>
      <h3 className={styles.sectionLabel}>Action so far</h3>
      <ol>{detail.history.map(line => <li key={line}>{line}</li>)}</ol>
    </div>
  );
}

export function PricePanel({ detail }: Readonly<{ detail: SolverDetail }>) {
  return (
    <div className={styles.solverPanel}>
      <h3 className={styles.sectionLabel}>{detail.facingBet ? "The price you face" : "The price your bet sets"}</h3>
      <ul className={styles.priceList}>
        {detail.price.map(row => (
          <li key={row.label}>
            <strong>{row.label}</strong>
            <span>
              {detail.facingBet
                ? <>You need {pct(row.potOdds)} equity to call · your range defends at least {pct(row.mdf)} (MDF)</>
                : <>{detail.villainName} needs {pct(row.potOdds)} equity to call (also the bluff share of a polar bet) · MDF {pct(row.mdf)}</>}
            </span>
            <span className={styles.plugged}>{row.plugged}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RangePanel({ detail }: Readonly<{ detail: SolverDetail }>) {
  return (
    <div className={styles.solverPanel}>
      <h3 className={styles.sectionLabel}>{detail.villainName}&apos;s range here</h3>
      <ul className={styles.rangeBars}>
        {detail.villainRange.map(group => (
          <li key={group.label}>
            <span>{group.label}</span>
            <span className={styles.bar} aria-hidden="true"><span style={{ width: `${Math.round(group.share * 100)}%` }} /></span>
            <span className={styles.barValue}>{pct(group.share)}</span>
          </li>
        ))}
      </ul>
      <p className={styles.small}>
        Weighted by how often each combo reaches this point in the solve; your cards removed. Categories count the
        board, so on a paired board every hand has at least a pair.
      </p>
    </div>
  );
}

export function decisionVerdict(q: Question, result: GradeResult): { headline: string; detail: string } {
  if (q.answer.kind !== "decision" || !q.solver) return { headline: "", detail: "" };
  const chosen = q.solver.actions.find(a => a.id === result.given);
  const best = q.solver.actions.find(a => a.id === q.answer.value);
  if (!chosen || !best) return { headline: "", detail: "" };
  const g = chosen.grade;
  const loss = g.evLossChips > 0 ? `loses ${fmtChipsBb(g.evLossChips)} bb (${g.evLossPctPot.toFixed(2)}% of the pot) against the best action` : "same EV as the best action";
  return {
    headline: BAND_LABELS[g.band],
    detail: `You: ${chosen.label}, ${loss}. Best: ${best.label}. Solver plays your action ${pct(g.frequency)} with this hand.`,
  };
}

export function SolverExplanation({ q, given }: Readonly<{ q: Question; given: string | null }>) {
  const d = q.solver;
  if (!d) return null;
  return (
    <div className={styles.solverExplain}>
      <div className={styles.tableWrap}>
        <table className={styles.actionTable}>
          <caption className={styles.sectionLabel}>Solver, for {q.hole?.map(c => c.rank + c.suit).join("")}</caption>
          <thead>
            <tr><th scope="col">Action</th><th scope="col">Plays</th><th scope="col">EV</th><th scope="col">Loss</th><th scope="col">Grade</th></tr>
          </thead>
          <tbody>
            {d.actions.map(a => (
              <tr key={a.id} aria-current={a.id === given ? "true" : undefined}>
                <th scope="row">{a.label}{a.id === given ? " (you)" : ""}</th>
                <td>{pct(a.grade.frequency)}</td>
                <td>{fmtSignedChipsBb(a.grade.evChips)} bb</td>
                <td>{a.grade.evLossPctPot.toFixed(2)}%</td>
                <td>{BAND_LABELS[a.grade.band]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.small}>
        EV is from now on, in big blinds (a fold is 0); loss is the gap to the best action as a share of
        the {fmtChipsBb(d.potChips)} bb pot. Within 0.3% of the pot is best; an action the solver plays at least 20% of
        the time with this hand also counts; EVs within 0.1 chip (the data&apos;s rounding) are ties.
      </p>
      <dl className={styles.explanation}>
        <div>
          <dt>Your equity</dt>
          <dd>
            {d.equity === null ? "Not saved for this hand." : (
              <>
                {pct(d.equity)} against {d.villainName}&apos;s range at this point (all-in equity: what you&apos;d win if the
                cards were dealt out now, not what you realize).
                {d.facingBet && d.price[0] && <> The call needs {pct(d.price[0].potOdds)}: equity is {d.equity >= d.price[0].potOdds ? "above" : "below"} the price.</>}
              </>
            )}
          </dd>
        </div>
      </dl>
      <PricePanel detail={d} />
      <RangePanel detail={d} />
      <p className={styles.provenance}>{d.provenance}</p>
    </div>
  );
}
