// Offline evaluation of the actual rounded saved profiles. This does not solve again.
import matrix from "../../solver/equity-matrix.json";
import { DISJOINT } from "../../solver/comboCounts";
import { HANDS } from "../../solver/hands";
import { isDepth, type PushFoldDepth, type PushFoldRow } from "./model";

interface Profile { stack: number; sb: number; bb: number; sbShove: readonly number[]; bbCall: readonly number[]; }
export function evaluateProfile(p: Profile): PushFoldDepth {
  if (!isDepth(p.stack) || p.sb !== 0.5 || p.bb !== 1 || [p.sbShove,p.bbCall].some(a => a.length !== 169 || a.some(x => !Number.isFinite(x) || x < 0 || x > 1))) throw new Error("Expected a saved 2–20 bb, 0.5/1 blind profile.");
  const sb: PushFoldRow[] = [], bb: (PushFoldRow | null)[] = [];
  let sbGainBb = 0, bbGainBb = 0;
  for (let h = 0; h < 169; h++) {
    const mass = HANDS[h].weight * 1225;
    let callMass = 0, sbEquityMass = 0, shoveMass = 0, bbEquityMass = 0;
    for (let k = 0; k < 169; k++) {
      const called = DISJOINT[h][k] * p.bbCall[k];
      callMass += called; sbEquityMass += called * matrix.equity[h][k];
      const shoved = DISJOINT[k][h] * p.sbShove[k];
      shoveMass += shoved; bbEquityMass += shoved * (1 - matrix.equity[k][h]);
    }
    const ev = ((mass - callMass) * 1.5 + 2 * p.stack * sbEquityMass - callMass * (p.stack - 0.5)) / mass;
    sb.push({hand:h,frequency:p.sbShove[h],evBb:ev,equity:callMass ? sbEquityMass / callMass : null,foldProbability:(mass-callMass)/mass,reachProbability:1});
    sbGainBb += HANDS[h].weight / 1326 * (Math.max(0, ev) - p.sbShove[h] * ev);
    if (shoveMass === 0) { bb.push(null); continue; }
    const equity = bbEquityMass / shoveMass, callEv = 2 * p.stack * equity - (p.stack - 1);
    bb.push({hand:h,frequency:p.bbCall[h],evBb:callEv,equity,foldProbability:null,reachProbability:shoveMass/mass});
    bbGainBb += HANDS[h].weight / 1326 * shoveMass / mass * (Math.max(0,callEv) - p.bbCall[h] * callEv);
  }
  return {version:1,stack:p.stack,sb,bb,sbGainBb,bbGainBb,nashGapBb:sbGainBb+bbGainBb};
}
