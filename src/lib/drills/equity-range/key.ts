export class EquityRangeKeyError extends Error { override name = "DrillKeyError"; }
export function parseEquityRangeKey(key: string): {datasetId:string;caseId:string}|null {
  const match=/^([a-f0-9]{64})\|([a-z][a-z0-9-]{0,39})$/.exec(key);
  return match ? {datasetId:match[1],caseId:match[2]} : null;
}
