import { chromium, expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
const required=process.env.POKER_FACE_LIVE_REQUIRED==="1";
async function finish(page:Page,seed="0"){
  await page.getByLabel("Hand seed",{exact:true}).fill(seed);
  await page.getByRole("button",{name:/^Deal (next )?hand$/}).click();
  await page.getByLabel("Bet or raise to (chips)").fill("9750");await page.getByRole("button",{name:"Place bet",exact:true}).click();
  await expect(page.getByText(/Hand complete/).first()).toBeVisible();
}
async function openReview(page:Page){
  await page.getByText("Review completed hands",{exact:true}).click();
  const region=page.getByRole("region",{name:"Completed-hand review",exact:true});
  await expect(region.getByLabel("Review decision",{exact:true})).toBeVisible();return region;
}

test("review empty state explains completion and tab-lifetime limits",async({page})=>{
  await page.goto("/play");await expect(page.getByText(/Finish a hand to review its decisions/)).toBeVisible();
  await expect(page.getByText(/up to 20 completed hands/)).toBeVisible();
});

test.describe("prepared hand review",()=>{
  test.skip(!required,"Requires prepared real play assets; all H1 release checks run with assets required");
  test("completed review entry jumps directly to the review controls by keyboard",async({page,browserName})=>{
    await page.goto("/play");await finish(page);
    const link=page.getByRole("link",{name:"Review this session’s completed hands",exact:true});
    await expect(link).toBeVisible();await link.focus();await page.keyboard.press("Enter");
    await expect(page.locator("#play-review")).toBeFocused();
    await page.keyboard.press(browserName==="webkit"&&process.platform==="darwin"?"Alt+Tab":"Tab");await expect(page.getByText("Review completed hands",{exact:true})).toBeFocused();
  });
  test("keyboard review preserves earlier board, action values, exact price and unavailable off-menu grade",async({page,browserName})=>{
    await page.goto("/play");await finish(page);
    const summary=page.getByText("Review completed hands",{exact:true});await summary.focus();await page.keyboard.press("Enter");
    const r=page.getByRole("region",{name:"Completed-hand review",exact:true});await expect(r).toBeVisible();
    await expect(r.getByRole("heading",{name:"Decision 1 of 2",exact:true})).toBeVisible();
    await expect(r.getByText("Board at this decision",{exact:true})).toBeVisible();
    await expect(r.getByRole("img")).toHaveCount(5); // hero + flop; final cards are collapsed
    const table=r.getByRole("table",{name:"Recorded action values and frequencies"});
    await expect(table.locator("tbody tr").first().locator("td").last()).toHaveText("0.623");
    await expect(r.getByText(/EV comparison unavailable:.*outside.*menu/)).toBeVisible();
    await expect(r.getByText(/not a score against the composed AI/)).toBeVisible();
    const next=r.getByRole("button",{name:"Next decision",exact:true});await next.focus();await page.keyboard.press("Enter");
    await expect(r.getByRole("heading",{name:"Decision 2 of 2",exact:true})).toBeVisible();
    const facts=r.getByRole("list",{name:"Decision price math"});
    await expect(facts).toContainText(`Pot odds: ${(9750/20050*100).toFixed(2)}%`);
    await expect(facts).toContainText(`Minimum defence: ${(550/10300*100).toFixed(2)}%`);
    await expect(facts).toContainText(`Polar bluff share: ${(9750/20050*100).toFixed(2)}%`);
    await r.getByRole("button",{name:"Previous decision",exact:true}).focus();await page.keyboard.press("Enter");
    await expect(r.getByRole("heading",{name:"Decision 1 of 2",exact:true})).toBeVisible();
    await expect(r.getByRole("button",{name:"Previous decision",exact:true})).toBeDisabled();
    await r.getByLabel("Review decision",{exact:true}).focus();
    await page.keyboard.press(browserName==="webkit"&&process.platform==="darwin"?"Alt+Tab":"Tab");
    expect(await page.evaluate(()=>getComputedStyle(document.activeElement!).outlineWidth)).not.toBe("0px");
  });
  test("same seed is distinct, next deal closes review, download is complete and reload clears it",async({page})=>{
    await page.goto("/play");await finish(page);let r=await openReview(page);
    await r.getByText("Review file and build identity",{exact:true}).click();
    const [file]=await Promise.all([page.waitForEvent("download"),r.getByRole("button",{name:"Download this review",exact:true}).click()]);
    const stream=await file.createReadStream();const chunks=[];for await(const chunk of stream!)chunks.push(chunk);
    const data=JSON.parse(Buffer.concat(chunks).toString());expect(data.format).toBe("poker-face-completed-review");
    expect(data.decisions).toHaveLength(2);expect(data.decisions[0].equityInput.board).toHaveLength(3);
    expect(data.identity.buildHash).toMatch(/^[a-f0-9]{64}$/);expect(data.hand.aiHand).toBeTruthy();
    const before=data.decisions[0];
    await page.getByLabel("Hand seed",{exact:true}).fill("0");await page.getByRole("button",{name:"Deal next hand",exact:true}).click();
    await expect(page.getByRole("region",{name:"Completed-hand review",exact:true})).toHaveCount(0);
    await expect(page.getByText("AI cards: hidden",{exact:true})).toBeVisible();
    await page.getByLabel("Bet or raise to (chips)").fill("9750");await page.getByRole("button",{name:"Place bet",exact:true}).click();
    await expect(page.getByText(/Hand complete/).first()).toBeVisible();r=await openReview(page);
    await expect(r.getByLabel("Completed hand",{exact:true}).locator("option")).toHaveCount(2);
    await r.getByLabel("Completed hand",{exact:true}).selectOption("1");
    await r.getByText("Review file and build identity",{exact:true}).click();
    const [again]=await Promise.all([page.waitForEvent("download"),r.getByRole("button",{name:"Download this review",exact:true}).click()]);
    const s=await again.createReadStream();const parts=[];for await(const chunk of s!)parts.push(chunk);
    expect(JSON.parse(Buffer.concat(parts).toString()).decisions[0]).toEqual(before);
    await page.reload();await expect(page.getByText(/Finish a hand to review its decisions/)).toBeVisible();
  });
  test("review calculates range equity in its own Worker, cancels, retries and ignores a previous selection",async({page})=>{
    // Delay delivery, not computation: test stale results and cancel deterministically.
    await page.addInitScript(()=>{
      const RealWorker=window.Worker;
      window.Worker=class extends RealWorker{
        constructor(url:string|URL,options?:WorkerOptions){super(url,options);this.addEventListener("message",e=>{
          if(e.data?.type==="result"&&e.data?.result?.method==="exact-enumeration"&&!e.data.reviewDelivered){
            e.stopImmediatePropagation();setTimeout(()=>this.dispatchEvent(new MessageEvent("message",{data:{...e.data,reviewDelivered:true}})),500);
          }
        });}
      };
    });
    await page.goto("/play");await finish(page);const r=await openReview(page);const requests:string[]=[];
    page.on("request",q=>{if(q.url().includes("solver-live")||q.url().includes("solver-data"))requests.push(q.url());});
    await r.getByRole("button",{name:"Calculate range equity",exact:true}).click();
    await r.getByRole("button",{name:"Cancel review equity",exact:true}).click();
    await expect(r.getByText(/Equity calculation cancelled/)).toBeVisible();
    await r.getByRole("button",{name:"Calculate range equity",exact:true}).click();
    await r.getByRole("button",{name:"Next decision",exact:true}).click();
    await expect(r.getByText(/Equity has not been calculated for this decision/)).toBeVisible();
    await r.getByRole("button",{name:"Calculate range equity",exact:true}).click();
    await expect(r.getByText(/compatible hands.*hand\/runout outcomes/)).toBeVisible({timeout:60_000});
    expect(requests).toEqual([]);
    await expect(r.getByText(/no further betting.*not call EV/i)).toBeVisible();
  });
  for(const width of [320,390,1280])test(`completed review reflows at ${width}px`,async({page},info)=>{
    await page.setViewportSize({width,height:900});await page.goto("/play");await finish(page);const r=await openReview(page);
    for(const detail of await r.locator("details").all())await detail.locator(":scope > summary").click();
    for(const control of await r.locator("button,select,input,summary").all())await expect(control).toHaveAccessibleName(/.+/);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:info.outputPath(`review-${width}.png`),fullPage:true});
    await page.addStyleTag({content:"html {font-size:200%;}"});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:info.outputPath(`review-text-200-${width}.png`),fullPage:true});
  });
  test("review keyboard works at 200% zoom with real browser zoom in Chromium",async({browserName,baseURL,page:normalPage},info)=>{
    if(browserName!=="chromium"){
      await normalPage.goto("/play");await finish(normalPage);await openReview(normalPage);
      await normalPage.addStyleTag({content:"html {font-size:200%;}"});
      await normalPage.getByRole("button",{name:"Next decision",exact:true}).focus();await normalPage.keyboard.press("Enter");
      await expect(normalPage.getByRole("heading",{name:"Decision 2 of 2",exact:true})).toBeVisible();
      expect(await normalPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);return;
    }
    const extension=resolve("e2e/fixtures/browser-zoom"),context=await chromium.launchPersistentContext("",{channel:"chromium",viewport:null,
      deviceScaleFactor:undefined,args:["--window-size=1280,900",`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
    try{
      const worker=context.serviceWorkers()[0]??await context.waitForEvent("serviceworker"),page=context.pages()[0];
      await page.goto(`${baseURL}/play`);await finish(page);await openReview(page);
      const before=await page.evaluate(()=>({width:innerWidth,dpr:devicePixelRatio}));
      const zoom=await worker.evaluate(async()=>{
        const {tabs}=(globalThis as unknown as {chrome:{tabs:{query(q:object):Promise<{id:number}[]>;setZoom(id:number,n:number):Promise<void>;getZoom(id:number):Promise<number>}}}).chrome;
        const [tab]=await tabs.query({active:true,currentWindow:true});await tabs.setZoom(tab.id,2);return tabs.getZoom(tab.id);
      });expect(zoom).toBe(2);
      await expect.poll(()=>page.evaluate(()=>innerWidth)).toBe(before.width/2);
      expect(await page.evaluate(()=>devicePixelRatio)).toBe(before.dpr*2);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.getByRole("button",{name:"Next decision",exact:true}).focus();await page.keyboard.press("Enter");
      await expect(page.getByRole("heading",{name:"Decision 2 of 2",exact:true})).toBeVisible();
      await page.getByLabel("Review decision",{exact:true}).scrollIntoViewIfNeeded();
      const cdp=await context.newCDPSession(page);
      const {data}=await cdp.send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
      await writeFile(info.outputPath("review-real-zoom-200.png"),Buffer.from(data,"base64"));
      await info.attach("review-zoom.json",{body:JSON.stringify({before,zoom,after:await page.evaluate(()=>({width:innerWidth,dpr:devicePixelRatio}))}),contentType:"application/json"});
    }finally{await context.close();}
  });
});
