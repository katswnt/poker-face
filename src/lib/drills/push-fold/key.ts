import { isDepth, type Seat } from "./model";
export class DrillKeyError extends Error { override name = "DrillKeyError"; }
export function parsePushFoldKey(key: string): {datasetId:string;stack:number;seat:Seat;hand:number} | null {
  const m = /^([a-f0-9]{64})\|([2-9]\.0|[2-9]\.5|1[0-9]\.[05]|20\.0)\|(sb|bb)\|(0|[1-9][0-9]{0,2})$/.exec(key);
  if (!m || !isDepth(Number(m[2])) || Number(m[4]) > 168) return null;
  return {datasetId:m[1],stack:Number(m[2]),seat:m[3] as Seat,hand:Number(m[4])};
}
