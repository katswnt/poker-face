import {readFileSync} from "node:fs";
import {expect,test,type Page} from "@playwright/test";
import {createEquityRangeSource} from "../src/lib/drills/equity-range/source";
import {startSession} from "../src/lib/drills/session";
import {initialState} from "../src/lib/drills/scheduler";
import {STORAGE_KEY} from "../src/lib/drills/storage";
import manifest from "../src/lib/drills/equity-range/manifest.json";
const source=createEquityRangeSource({fetcher:(async(url:string)=>new Response(readFileSync(`public${url}`))) as typeof fetch});
async function question(seed=42,level:1|2|3=3){const p=startSession(initialState(),seed,{kind:"type",type:"equity-range"},level,0).pending!;return source.generate(p.seed,p.level);}
const overflow=async(page:Page)=>expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

test("equity range shows every weighted hand and blocker, accepts keyboard answers and explains exact counts",async({page})=>{
  const q=await question(),detail=q.equityRange!.result;
  await page.goto("/drills?drill=equity-range&level=3&seed=42");
  await expect(page.getByRole("button",{name:"Equity vs range",exact:true})).toHaveAttribute("aria-pressed","true");
  const table=page.getByRole("table",{name:"Opponent's possible hands"});
  await expect(table).toBeVisible();await expect(table.getByRole("row")).toHaveCount(detail.rows.length+1);
  for(let i=0;i<detail.rows.length;i++){
    const row=table.getByRole("row").nth(i+1),data=detail.rows[i];
    await expect(row).toContainText(`Weight ${data.weight}`);
    await expect(row).toContainText(data.blockedBy.length?"Removed":`${data.weight}/${detail.weightSum}`);
    const ranks:Record<string,string>={2:"two",3:"three",4:"four",5:"five",6:"six",7:"seven",8:"eight",9:"nine",T:"ten",J:"jack",Q:"queen",K:"king",A:"ace"};
    const suits:Record<string,string>={c:"clubs",d:"diamonds",h:"hearts",s:"spades"};
    for(const card of data.blockedBy)await expect(row.getByRole("cell")).toContainText(`${ranks[card[0]]??card[0]} of ${suits[card[1]]}`);

  }
  await expect(page.getByText(/average share of the pot if no more bets are made/i).first()).toBeVisible();
  await expect(page.getByText(/practice tolerance, not.*uncertainty/i)).toBeVisible();
  const input=page.getByLabel("Your answer (percent)");await expect(input).toBeFocused();
  await input.fill("101");await input.press("Enter");await expect(input).toHaveAttribute("aria-invalid","true");
  await expect(page.locator("#drill-answer-error")).toContainText("0 to 100");await expect(page.getByRole("button",{name:/Next question/})).toHaveCount(0);
  await input.fill(String(q.answer.value));await input.press("Enter");
  await expect(page.getByText("Correct",{exact:true})).toBeVisible();
  await expect(page.getByText(/Equity \(rounded\):/)).toBeVisible();
  await expect(page.getByText(`${detail.outcomeCount} distinct hand/runout outcomes`,{exact:false})).toBeVisible();
  await expect(page.getByText(`${detail.numerator}/${detail.denominator}`,{exact:false}).first()).toBeVisible();
  const next=page.getByRole("button",{name:/Next question/});await expect(next).toBeFocused();
  await page.keyboard.press("Shift+Tab");await expect(page.getByText("Counts and question source",{exact:true})).toBeFocused();
  await page.keyboard.press("Enter");await expect(page.getByText(manifest.datasetId,{exact:false})).toBeVisible();
  await expect(page.getByRole("link",{name:"Frozen practice inputs"})).toHaveAttribute("href",/drills-equity-range-d2-inputs.json/);
  await page.keyboard.press("n");await expect(input).toBeFocused();await expect(input).toHaveValue("");
});

test("equity range lazy loading, retry and stale mode switch do not start an answer early",async({page})=>{
  const requested:string[]=[];page.on("request",r=>requested.push(r.url()));
  await page.goto("/drills?drill=pot-odds&seed=1");await expect(page.getByLabel("Your answer (percent)")).toBeVisible();
  expect(requested.some(x=>x.includes("/equity-range-v1/"))).toBe(false);
  await page.route("**/drill-data/equity-range-v1/**",r=>r.abort("internetdisconnected"));
  await page.getByRole("button",{name:"Equity vs range",exact:true}).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Could not load equity-range data");
  await expect(page.getByRole("timer")).toHaveCount(0);
  await page.unrouteAll();await page.getByRole("button",{name:"Retry",exact:true}).click();
  await expect(page.getByRole("table",{name:"Opponent's possible hands"})).toBeVisible();
  await page.reload();let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});
  await page.route("**/drill-data/equity-range-v1/**",async r=>{await gate;await r.continue();});
  await page.getByRole("button",{name:"Equity vs range",exact:true}).click();
  await expect(page.getByRole("status")).toContainText("verifying");await expect(page.getByRole("timer")).toHaveCount(0);
  await page.getByRole("button",{name:"Pot odds",exact:true}).click();release();await page.unrouteAll({behavior:"wait"});
  await expect(page.getByRole("button",{name:"Pot odds",exact:true})).toHaveAttribute("aria-pressed","true");
  await expect(page.getByLabel("Your answer (percent)")).toBeFocused();await expect(page.getByRole("table")).toHaveCount(0);
});

test("equity range review replays its exact case and persists the key",async({page})=>{
  const q=await question();const state={...initialState(),review:[{id:q.id,type:q.type,seed:q.seed,level:q.level,box:1,dueAt:0,lapses:1,key:q.reviewKey}]};
  await page.addInitScript(({key,state})=>localStorage.setItem(key,JSON.stringify(state)),{key:STORAGE_KEY,state});
  await page.goto("/drills?drill=review");const table=page.getByRole("table",{name:"Opponent's possible hands"});await expect(table).toBeVisible();
  await expect(table.getByRole("row")).toHaveCount(q.equityRange!.result.rows.length+1);
  const input=page.getByLabel("Your answer (percent)");await input.fill(String(q.answer.value));await input.press("Enter");
  await expect(page.getByText("Correct",{exact:true})).toBeVisible();
  const items=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).review,STORAGE_KEY);expect(items[0].key).toBe(q.reviewKey);
});

test("equity range refuses unavailable versions without substituting a question",async({page})=>{
  const q=await question(),key=q.reviewKey!.replace(manifest.datasetId,"0".repeat(64));
  const state={...initialState(),review:[{id:`equity-range:${key}`,type:q.type,seed:q.seed,level:q.level,box:1,dueAt:0,lapses:1,key}]};
  await page.addInitScript(({key,state})=>localStorage.setItem(key,JSON.stringify(state)),{key:STORAGE_KEY,state});
  await page.goto("/drills?drill=review");await expect(page.getByRole("main").getByRole("alert")).toContainText("unavailable dataset");
  await expect(page.getByLabel("Your answer (percent)")).toHaveCount(0);
  await page.getByRole("button",{name:"Remove it and continue",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Nothing to review yet"})).toBeVisible();
});

for(const width of [320,390,1280])test(`equity range ${width}px complete range and feedback reflow`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.goto("/drills?drill=equity-range&level=3&seed=42");
  await expect(page.getByRole("table",{name:"Opponent's possible hands"})).toBeVisible();await overflow(page);
  await page.screenshot({path:info.outputPath(`equity-range-${width}-question.png`),fullPage:true});
  const input=page.getByLabel("Your answer (percent)");await input.fill("50");await input.press("Enter");
  await expect(page.getByRole("button",{name:/Next question/})).toBeVisible();await overflow(page);
  await page.getByText("Counts and question source",{exact:true}).click();await overflow(page);
  await page.screenshot({path:info.outputPath(`equity-range-${width}-feedback.png`),fullPage:true});
});

test("equity range 200% CSS zoom remains readable and keyboard usable",async({page},info)=>{
  await page.setViewportSize({width:1280,height:900});await page.goto("/drills?drill=equity-range&level=3&seed=42");
  await page.locator("html").evaluate(el=>{el.style.zoom="2";});const input=page.getByLabel("Your answer (percent)");await expect(input).toBeFocused();
  await input.fill("50");await input.press("Enter");await expect(page.getByRole("button",{name:/Next question/})).toBeFocused();await overflow(page);
  await page.screenshot({path:info.outputPath("equity-range-zoom-200.png"),fullPage:true});
});
