import { questionRng } from "../rng";
import type { Level, Question } from "../practice-types";
import { buildPushFoldQuestion } from "./build";
import { DrillKeyError, parsePushFoldKey } from "./key";
import { MAX_DEPTH_BYTES, validateDepth, type PushFoldDepth, type Seat } from "./model";
import manifest from "./manifest.json";

export interface PushFoldSource {
  generate(seed:number,level:Level):Promise<Question>;
  fromKey(key:string,seed:number,level:Level):Promise<Question>;
}
export function createPushFoldSource({fetcher = fetch}: {fetcher?:typeof fetch} = {}): PushFoldSource {
  const memo = new Map<number,Promise<PushFoldDepth>>();
  function depth(stack:number):Promise<PushFoldDepth> {
    const ref = manifest.chunks.find(c=>c.stack === stack);
    if(!ref)return Promise.reject(new DrillKeyError("This saved stack size is unavailable."));
    let promise = memo.get(stack);
    if(!promise) {
      promise = (async()=>{
        const response = await fetcher(`/drill-data/push-fold-v1/${ref.file}`);
        if(!response.ok)throw new Error(`Could not load push/fold data (${response.status}). Check your connection and retry.`);
        // Bound streamed bytes too: Content-Length is not always present or trustworthy.
        const reader = response.body?.getReader();
        if(!reader)throw new Error("Push/fold data is empty. Retry.");
        const parts:Uint8Array[]=[]; let count=0;
        try {
          while(true){const {done,value}=await reader.read();if(done)break;count+=value.byteLength;
            if(count>MAX_DEPTH_BYTES || count>ref.bytes)throw new Error("Push/fold data is too large. Retry.");parts.push(value);}
        }catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
        if(count!==ref.bytes)throw new Error("Push/fold data length did not match. Retry.");
        const bytes = new Uint8Array(count);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
        const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),b=>b.toString(16).padStart(2,"0")).join("");
        if(digest!==ref.sha256)throw new Error("Push/fold data failed its integrity check. Retry.");
        return validateDepth(JSON.parse(new TextDecoder().decode(bytes)),stack);
      })().catch(error=>{memo.delete(stack);throw error instanceof DrillKeyError ? error : new Error(error instanceof Error && /push\/fold/i.test(error.message) ? error.message : "Could not load push/fold data. Check your connection and retry.");});
      memo.set(stack,promise);
    }
    return promise;
  }
  return {
    async generate(seed,level){
      const rng=questionRng("push-fold",seed>>>0,level), seat:Seat=rng()<0.5?"sb":"bb";
      const depths=level===1?[2,5,10]:manifest.chunks.map(c=>c.stack);
      const profile=await depth(depths[Math.floor(rng()*depths.length)]);
      const margin=level===1?0.25:level===2?0.05:0;
      const eligible=profile[seat].filter(row=>row && Math.abs(row.evBb)>=margin);
      const row=eligible[Math.floor(rng()*eligible.length)];
      if(!row)throw new Error("No push/fold questions meet this level's rules.");
      return buildPushFoldQuestion(profile,seat,row.hand,seed,level);
    },
    async fromKey(key,seed,level){
      const parsed=parsePushFoldKey(key);
      if(!parsed || parsed.datasetId!==manifest.datasetId)throw new DrillKeyError("This saved push/fold question belongs to an unavailable dataset. Remove it to continue.");
      const profile=await depth(parsed.stack);
      if(!profile[parsed.seat][parsed.hand])throw new DrillKeyError("This saved decision is unreachable.");
      return buildPushFoldQuestion(profile,parsed.seat,parsed.hand,seed,level);
    },
  };
}
