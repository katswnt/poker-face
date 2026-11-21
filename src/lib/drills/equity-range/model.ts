import { isRiverCard, type RiverCard, type RiverCombo } from "../../solver/river/cards";
import type { Level } from "../types";

export const MAX_DATA_BYTES = 200 * 1024;
export interface EquityInput {
  readonly id: string;
  readonly level: Level;
  readonly hero: RiverCombo;
  readonly board: readonly RiverCard[];
  readonly range: readonly { readonly cards: RiverCombo; readonly weight: number }[];
}
export interface EquityRow {
  readonly cards: RiverCombo;
  readonly weight: number;
  readonly blockedBy: readonly RiverCard[];
  readonly wins: number;
  readonly ties: number;
  readonly losses: number;
  readonly runouts: number;
}
export interface EquityCase {
  readonly input: EquityInput;
  readonly rows: readonly EquityRow[];
  readonly weightSum: number;
  readonly outcomeCount: number;
  readonly weightedWins: number;
  readonly weightedTies: number;
  readonly weightedLosses: number;
  readonly weightedOutcomes: number;
  readonly numerator: number;
  readonly denominator: number;
}
export interface EquityDataset { readonly format: "poker-face-equity-range"; readonly version: 1; readonly cases: readonly EquityCase[]; }
export interface EquityRangeDetail { readonly datasetId: string; readonly result: EquityCase; }
const object = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const nat = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const fail = (): never => { throw new Error("Invalid equity-range data."); };
function cards(v: unknown, lengths: readonly number[]): RiverCard[] {
  if (!Array.isArray(v) || !lengths.includes(v.length) || !v.every(isRiverCard) || new Set(v).size !== v.length) return fail();
  return [...v];
}
export function parseEquityInput(v: unknown): EquityInput {
  if (!object(v) || typeof v.id !== "string" || !/^[a-z][a-z0-9-]{0,39}$/.test(v.id) || ![1,2,3].includes(v.level as number)) return fail();
  const hero = cards(v.hero,[2]) as unknown as RiverCombo, board = cards(v.board,[4,5]);
  const known = new Set([...hero,...board]); if (known.size !== hero.length+board.length) return fail();
  if (!Array.isArray(v.range) || !v.range.length || v.range.length > 12) return fail();
  const seen = new Set<string>();
  const range = v.range.map(r => {
    if (!object(r) || !nat(r.weight) || r.weight < 1 || r.weight > 10) return fail();
    const combo = cards(r.cards,[2]) as unknown as RiverCombo, key = [...combo].sort().join("");
    if (seen.has(key)) return fail(); seen.add(key);
    return {cards:combo,weight:r.weight};
  });
  if (!range.some(r=>r.cards.every(c=>!known.has(c)))) return fail();
  return {id:v.id,level:v.level as Level,hero,board,range};
}
/** Checks all arithmetic and structure, without evaluating poker hands in the browser.
 * Authentic showdown counts are pinned by the download hash and independently reproduced offline. */
export function validateEquityDataset(v: unknown): EquityDataset {
  if (!object(v) || v.format !== "poker-face-equity-range" || v.version !== 1 || !Array.isArray(v.cases) || v.cases.length !== 36) return fail();
  const ids = new Set<string>();
  const cases = v.cases.map(value => {
    if (!object(value)) return fail();
    const input = parseEquityInput(value.input), known = new Set([...input.hero,...input.board]);
    if (ids.has(input.id)) return fail(); ids.add(input.id);
    if (!Array.isArray(value.rows) || value.rows.length !== input.range.length) return fail();
    const rows: EquityRow[] = value.rows.map((r,index) => {
      const expected = input.range[index], blockedBy = expected.cards.filter(c=>known.has(c));
      const runouts = blockedBy.length ? 0 : input.board.length === 4 ? 44 : 1;
      if (!object(r) || JSON.stringify(r.cards) !== JSON.stringify(expected.cards) || r.weight !== expected.weight || JSON.stringify(r.blockedBy) !== JSON.stringify(blockedBy)
          || !nat(r.wins) || !nat(r.ties) || !nat(r.losses) || r.runouts !== runouts || r.wins+r.ties+r.losses !== runouts) return fail();
      return {cards:expected.cards,weight:expected.weight,blockedBy,wins:r.wins,ties:r.ties,losses:r.losses,runouts};
    });
    const weightSum = rows.reduce((n,r)=>n+(r.runouts ? r.weight : 0),0);
    const outcomeCount = rows.reduce((n,r)=>n+r.runouts,0);
    const weightedWins = rows.reduce((n,r)=>n+r.weight*r.wins,0), weightedTies = rows.reduce((n,r)=>n+r.weight*r.ties,0), weightedLosses = rows.reduce((n,r)=>n+r.weight*r.losses,0);
    const weightedOutcomes = weightedWins+weightedTies+weightedLosses;
    const totals = {weightSum,outcomeCount,weightedWins,weightedTies,weightedLosses,weightedOutcomes,numerator:2*weightedWins+weightedTies,denominator:2*weightedOutcomes};
    for (const [key,expected] of Object.entries(totals)) if (value[key] !== expected) return fail();
    return {input,rows,...totals};
  });
  for (const level of [1,2,3]) if (cases.filter(c=>c.input.level===level).length !== 12) return fail();
  return {format:"poker-face-equity-range",version:1,cases};
}
