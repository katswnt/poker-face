import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { createPushFoldSource } from "../src/lib/drills/push-fold/source";
import { startSession } from "../src/lib/drills/session";
import { initialState } from "../src/lib/drills/scheduler";
import { STORAGE_KEY } from "../src/lib/drills/storage";
import manifest from "../src/lib/drills/push-fold/manifest.json";

const source=createPushFoldSource({fetcher:(async(url:string)=>new Response(readFileSync(`public${url}`))) as typeof fetch});
async function question(seed=42) {
  const pending=startSession(initialState(),seed,{kind:"type",type:"push-fold"},1,0).pending!;
  return source.generate(pending.seed,pending.level);
}
const overflow=async(page:Page)=>expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

test("push/fold keyboard answer, values, model limits and next focus",async({page})=>{
  const q=await question();
  await page.goto("/drills?drill=push-fold&level=1&seed=42");
  await expect(page.getByRole("button",{name:"Push or fold",exact:true})).toHaveAttribute("aria-pressed","true");
  await expect(page.getByRole("heading",{name:q.prompt})).toBeVisible();
  await expect(page.getByText(/No limps, smaller raises, or later betting/)).toBeVisible();
  const choices=page.getByRole("group",{name:"Your answer"}).getByRole("button");
  await expect(choices.first()).toBeFocused();
  await expect(page.getByText(/Within 0.01 bb of the higher action value/)).toBeVisible();
  await expect(page.getByRole("group",{name:"Your answer"})).toHaveAttribute("aria-describedby","drill-choice-hint");
  await page.keyboard.press(q.answer.value==="fold"?"1":"2");
  await expect(page.getByText("Correct",{exact:true})).toBeVisible();
  const table=page.getByRole("table",{name:"Saved strategy and action values"});
  await expect(table.getByRole("columnheader",{name:"Value (bb)"})).toBeVisible();
  for(const action of q.pushFold!.actions){
    const row=table.getByRole("row").filter({hasText:action.label});
    await expect(row).toContainText(action.grade.evBb.toFixed(3));
    await expect(row).toContainText(`${(action.grade.frequency*100).toFixed(1)}%`);
  }
  await expect(page.getByRole("button",{name:/Next question/})).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByText("Model, quality and question source",{exact:true})).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/not universal or exact GTO/)).toBeVisible();
  await expect(page.getByText(/0.01 bb is the practice tolerance/)).toBeVisible();
  await page.keyboard.press("n"); await expect(choices.first()).toBeEnabled(); await expect(choices.first()).toBeFocused();
});

test("push/fold lazy loading, failed download retry, and switch during a pending fetch",async({page})=>{
  const requests:string[]=[]; page.on("request",r=>requests.push(r.url()));
  await page.goto("/drills?drill=pot-odds&seed=1");
  await expect(page.getByLabel("Your answer (percent)")).toBeVisible();
  expect(requests.some(p=>p.includes("/drill-data/push-fold-v1/"))).toBe(false);
  await page.route("**/drill-data/push-fold-v1/**",r=>r.abort("internetdisconnected"));
  await page.getByRole("button",{name:"Push or fold",exact:true}).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Could not load push/fold data");
  await page.unrouteAll(); await page.getByRole("button",{name:"Retry",exact:true}).click();
  await expect(page.getByRole("group",{name:"Your answer"})).toBeVisible();
  await page.reload();
  let release!:()=>void; const gate=new Promise<void>(r=>{release=r;});
  await page.route("**/drill-data/push-fold-v1/**",async r=>{await gate;await r.continue();});
  await page.getByRole("button",{name:"Push or fold",exact:true}).click();
  await expect(page.getByRole("status")).toContainText("verifying");
  await page.getByRole("button",{name:"Pot odds",exact:true}).click();
  release(); await page.unrouteAll({behavior:"wait"});
  await expect(page.getByLabel("Your answer (percent)")).toBeFocused();
  await expect(page.getByRole("button",{name:"Pot odds",exact:true})).toHaveAttribute("aria-pressed","true");
});

test("push/fold persisted review and removed dataset are explicit",async({page})=>{
  const q=await question();
  const state={...initialState(),review:[{id:q.id,type:q.type,seed:q.seed,level:q.level,box:1,dueAt:0,lapses:1,key:q.reviewKey}]};
  await page.addInitScript(({key,state})=>localStorage.setItem(key,JSON.stringify(state)),{key:STORAGE_KEY,state});
  await page.goto("/drills?drill=review");
  await expect(page.getByRole("heading",{name:q.prompt})).toBeVisible();
  await page.getByRole("group",{name:"Your answer"}).getByRole("button").first().click();
  await expect(page.getByRole("button",{name:/Next question/})).toBeVisible();
  const review=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).review,STORAGE_KEY);
  expect(review[0].key).toBe(q.reviewKey);

});

test("push/fold unavailable dataset can be removed without substitution",async({page})=>{
  const q=await question(); const key=q.reviewKey!.replace(manifest.datasetId,"0".repeat(64));
  const state={...initialState(),review:[{id:`push-fold:${key}`,type:q.type,seed:q.seed,level:q.level,box:1,dueAt:0,lapses:1,key}]};
  await page.addInitScript(({key,state})=>localStorage.setItem(key,JSON.stringify(state)),{key:STORAGE_KEY,state});
  await page.goto("/drills?drill=review");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("unavailable dataset");
  await expect(page.getByRole("group",{name:"Your answer"})).toHaveCount(0);
  await page.getByRole("button",{name:"Remove it and continue",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Nothing to review yet"})).toBeVisible();
});

for(const width of [320,390,1280])test(`push/fold ${width}px readable before and after answering`,async({page},info)=>{
  await page.setViewportSize({width,height:900});
  await page.goto("/drills?drill=push-fold&level=1&seed=42");
  const choice=page.getByRole("group",{name:"Your answer"}).getByRole("button").first();
  await expect(choice).toBeVisible(); await overflow(page); await choice.click();
  await expect(page.getByRole("table")).toBeVisible(); await overflow(page);
  await page.screenshot({path:info.outputPath(`push-fold-${width}.png`),fullPage:true});
});

test("push/fold 200% zoom reflows and remains keyboard usable",async({page},info)=>{
  await page.setViewportSize({width:1280,height:900});
  await page.goto("/drills?drill=push-fold&level=1&seed=42");
  await page.locator("html").evaluate(el=>{el.style.zoom="2";});
  const choices=page.getByRole("group",{name:"Your answer"}).getByRole("button");
  await expect(choices.first()).toBeFocused(); await page.keyboard.press("2");
  await expect(page.getByRole("button",{name:/Next question/})).toBeFocused(); await overflow(page);
  await page.screenshot({path:info.outputPath("push-fold-zoom-200.png"),fullPage:true});
});
