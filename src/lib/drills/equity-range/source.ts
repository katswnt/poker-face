import {questionRng} from "../rng";
import type {Level,Question} from "../practice-types";
import {buildEquityRangeQuestion} from "./build";
import {EquityRangeKeyError,parseEquityRangeKey} from "./key";
import {MAX_DATA_BYTES,validateEquityDataset,type EquityDataset} from "./model";
import manifest from "./manifest.json";
export interface EquityRangeSource {
  generate(seed:number,level:Level):Promise<Question>;
  fromKey(key:string,seed:number,level:Level):Promise<Question>;
}
export function createEquityRangeSource({fetcher=fetch}:{fetcher?:typeof fetch}={}):EquityRangeSource {
  let memo:Promise<EquityDataset>|null=null;
  function load():Promise<EquityDataset> {
    memo??=(async()=>{
      const response=await fetcher(`/drill-data/equity-range-v1/${manifest.file}`);
      if(!response.ok)throw new Error(`Could not load equity-range data (${response.status}). Check your connection and retry.`);
      const reader=response.body?.getReader();if(!reader)throw new Error("Equity-range data is empty. Retry.");
      const parts:Uint8Array[]=[];let count=0;
      try{
        while(true){const {done,value}=await reader.read();if(done)break;count+=value.byteLength;
          if(count>MAX_DATA_BYTES||count>manifest.bytes)throw new Error("Equity-range data is too large. Retry.");parts.push(value);}
      }catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
      if(count!==manifest.bytes)throw new Error("Equity-range data length did not match. Retry.");
      const bytes=new Uint8Array(count);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
      const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),b=>b.toString(16).padStart(2,"0")).join("");
      if(digest!==manifest.sha256)throw new Error("Equity-range data failed its integrity check. Retry.");
      const data=validateEquityDataset(JSON.parse(new TextDecoder().decode(bytes)));
      if(JSON.stringify(data.cases.map(c=>({id:c.input.id,level:c.input.level})))!==JSON.stringify(manifest.cases))throw new Error("Equity-range case index did not match. Retry.");
      return data;
    })().catch(error=>{memo=null;throw new Error(error instanceof Error && /equity-range/i.test(error.message)?error.message:"Could not load equity-range data. Check your connection and retry.");});
    return memo;
  }
  return {
    async generate(seed,level){
      const choices=manifest.cases.filter(c=>c.level===level),rng=questionRng("equity-range",seed>>>0,level);
      const chosen=choices[Math.floor(rng()*choices.length)];if(!chosen)throw new EquityRangeKeyError("This equity-range level is unavailable.");
      const data=await load(),result=data.cases.find(c=>c.input.id===chosen.id)!;
      return buildEquityRangeQuestion(result,seed);
    },
    async fromKey(key,seed,level){
      const parsed=parseEquityRangeKey(key),ref=parsed&&manifest.cases.find(c=>c.id===parsed.caseId);
      if(!parsed||parsed.datasetId!==manifest.datasetId||!ref||ref.level!==level)throw new EquityRangeKeyError("This saved equity-range question belongs to an unavailable dataset or case. Remove it to continue.");
      const data=await load();return buildEquityRangeQuestion(data.cases.find(c=>c.input.id===parsed.caseId)!,seed);
    },
  };
}
