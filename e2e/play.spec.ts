import { chromium, expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";

const required = process.env.POKER_FACE_LIVE_REQUIRED === "1";
test("play explains the game's limits and the measured unusual-size weakness on the page", async ({page}) => {
  await page.goto("/play");
  await expect(page.getByRole("heading", {name: "Play the solver-backed AI", exact: true})).toBeVisible();
  await expect(page.getByText(/Preflop is scripted/)).toBeVisible();
  await expect(page.getByText(/hand-written ranges/)).toBeVisible();
  await expect(page.getByText(/12 saved flops/)).toBeVisible();
  await expect(page.getByText(/not exact GTO/)).toBeVisible();
  await expect(page.getByText(/23.4% of the subgame pot/)).toBeVisible();
  await expect(page.getByRole("link", {name: "Read the measured P2 audit"})).toHaveAttribute("href", /heads-up-play-p2-river/);
  if (process.env.POKER_FACE_LIVE_SAVED_ONLY === "1") {
    await expect(page.getByText(/Live play assets are not installed/)).toBeVisible();
    await expect(page.getByRole("button", {name: "Deal hand", exact: true})).toBeDisabled();
  }
  if (required) {
    const source = page.getByRole("link", {name: "Download corresponding AGPL engine source"});
    await expect(source).toHaveAttribute("href", /^\/solver-live\/source\/[a-f0-9]{64}\.tar\.gz$/);
    expect((await page.request.get((await source.getAttribute("href"))!)).ok()).toBe(true);
  }
  await expect(page).toHaveTitle("Play the Solver-backed AI | Poker Face");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://pokerface.katswint.com/play");
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", "https://pokerface.katswint.com/play");
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /^https:\/\//);
});

for (const width of [320, 390, 1280]) test(`play responsive layout at ${width}px`, async ({page}, info) => {
  await page.setViewportSize({width, height: 900}); await page.goto("/play");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const control of await page.locator("button, input, select").all()) await expect(control).toHaveAccessibleName(/.+/);
  await page.screenshot({path: info.outputPath(`play-setup-${width}.png`), fullPage: true});
  if (required) {
    await page.getByLabel("Your seat").selectOption("0"); await page.getByLabel("Hand seed").fill("0");
    await page.getByRole("button", {name: "Deal hand", exact: true}).click();
    await expect(page.getByRole("button", {name: "Check", exact: true})).toBeEnabled();
    await page.getByRole("button", {name: "Show decision hints", exact: true}).click();
    await expect(page.getByText(/Exact all-in equity/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path: info.outputPath(`play-hand-${width}.png`), fullPage: true});
  }
  if (width === 1280) {
    await page.addStyleTag({content: "html { font-size: 200%; }"});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path: info.outputPath("play-text-200.png"), fullPage: true});
  }
});

test.describe("prepared play UI", () => {
  test.skip(!required, "Requires the explicitly prepared production WASM gate");
  test("saved-policy grades wait for an action and show only the original model's EV gap", async ({page}) => {
    await page.goto("/play");
    await page.getByLabel("Your seat").selectOption("0"); await page.getByLabel("Hand seed").fill("0");
    await page.getByRole("button", {name:"Deal hand",exact:true}).click();
    await page.getByRole("button", {name:"Show decision hints",exact:true}).click();
    await expect(page.getByText("Choose an action first to see its saved-model EV gap.",{exact:true})).toBeVisible();
    // Frozen seed 0, BB, Jc Jd 4s: exported saved EVs 62.3 / 61.8 / 59.4 chips.
    // Check the displayed inputs separately, then independently subtract the chosen bet's EV.
    const table=page.getByRole("table",{name:"Approximate strategy at this decision"});
    await expect(table.locator("tbody tr").nth(0).locator("td").last()).toHaveText("0.623");
    await expect(table.locator("tbody tr").nth(1).locator("td").last()).toHaveText("0.618");
    await page.getByLabel("Bet or raise to (chips)").fill("182");
    await page.getByRole("button",{name:"Place bet",exact:true}).click();
    await expect(page.getByText("You: Bet to 1.82 bb (b182)",{exact:true})).toBeVisible();
    await page.getByLabel("Decision to inspect").selectOption({index:0});
    await expect(page.getByText(`You chose Bet to 1.82 bb. Saved-model EV gap: ${((62.3-61.8)/100).toFixed(3)} bb (0.5 chips).`,{exact:true})).toBeVisible();
    await expect(page.getByText(/This compares actions against the original saved policy, not the later re-solving AI/)).toBeVisible();
    await expect(page.getByText(/not a bound on solver or model error/)).toBeVisible();
  });
  test("invalid seeds are identified and their inline error is linked to the field", async ({page}) => {
    await page.goto("/play");
    const seed = page.getByLabel("Hand seed");
    await seed.fill("junk"); await page.getByRole("button", {name: "Deal hand", exact: true}).click();
    await expect(seed).toHaveAttribute("aria-invalid", "true");
    await expect(seed).toHaveAccessibleDescription(/whole hand seed/);
    await seed.fill("0"); await expect(seed).not.toHaveAttribute("aria-invalid", "true");
  });
  test("keyboard completes a real hand with an off-menu bet, history, math and conserved ledger", async ({page,browserName}) => {
    await page.goto("/play");
    await page.getByLabel("Your seat").selectOption("0"); await page.getByLabel("Hand seed").fill("0");
    await page.getByRole("button", {name: "Deal hand", exact: true}).focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("button", {name: "Check", exact: true})).toBeEnabled();
    await expect(page.getByText("AI cards: hidden", {exact: true})).toBeVisible();
    await page.getByLabel("Bet or raise to (chips)").focus();
    await page.keyboard.press("ControlOrMeta+A"); await page.keyboard.type("9750");
    // Safari/macOS's default Tab mode skips buttons; Option+Tab includes them.
    await page.keyboard.press(browserName==="webkit"&&process.platform==="darwin"?"Alt+Tab":"Tab");
    await expect(page.getByRole("button",{name:"Place bet",exact:true})).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByText(/Hand complete/).first()).toBeVisible();
    await expect(page.getByRole("heading", {name: "Hand history", exact: true})).toBeVisible();
    await expect(page.getByText(/1 completed hand/)).toBeVisible();
    await expect(page.getByText(/AI cards: hidden/)).toHaveCount(0);
    await page.getByLabel("Decision to inspect").selectOption({index:0});
    await expect(page.getByText(/EV grade unavailable: your chosen size is outside this saved menu/)).toBeVisible();
    await page.getByLabel("Decision to inspect").selectOption({index: 1});
    await expect(page.getByRole("columnheader", {name: "Frequency", exact: true})).toBeVisible();
    await expect(page.getByText(/MDF/).first()).toBeVisible();
    await expect(page.getByText(/Polar bluff share/).first()).toBeVisible();
    await expect(page.getByRole("heading", {name: "Where this decision came from", exact: true})).toBeVisible();
    const facts = page.locator("dl").filter({hasText: "Call price"});
    const value = (name:string) => facts.locator("div").filter({has: page.getByText(name,{exact:true})}).locator("dd");
    await expect(value("Call price")).toHaveText("9750 chips · 97.50 bb");
    await expect(value("Pot odds / break-even equity")).toHaveText(`${(9750/20050*100).toFixed(2)}%`);
    await expect(value("Minimum defence (MDF)")).toHaveText(`${(550/10300*100).toFixed(2)}%`);
    await expect(value("Polar bluff share")).toHaveText(`${(9750/20050*100).toFixed(2)}%`);
    const ledger = page.getByRole("table", {name:"Completed hands"});
    const nets = await ledger.locator("tbody td").allTextContents();
    expect(nets.map(parseFloat).reduce((s,n)=>s+n,0)).toBe(0.5);
  });

  test("a real turn Worker can be cancelled and retried without charging the off-menu bet twice", async ({page}) => {
    await page.goto("/play"); await page.getByLabel("Hand seed").fill("1");
    await page.getByRole("button",{name:"Deal hand",exact:true}).click();
    await page.getByLabel("Bet or raise to (chips)").fill("237");
    await page.getByRole("button",{name:"Place bet",exact:true}).click();
    await expect(page.getByText(/turn: solving/)).toBeVisible({timeout:60_000});
    await page.getByRole("button",{name:"Cancel thinking",exact:true}).focus(); await page.keyboard.press("Enter");
    const retry = page.getByRole("button",{name:"Retry pending decision",exact:true});
    await expect(retry).toBeVisible(); await expect(page.getByText("AI cards: hidden",{exact:true})).toBeVisible();
    await expect(page.getByText("Pot, including uncalled bets: 10.24 bb",{exact:true})).toBeVisible();
    await retry.focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("button",{name:"Check",exact:true})).toBeEnabled({timeout:120_000});
    await expect(page.getByText("Pot, including uncalled bets: 10.24 bb",{exact:true})).toBeVisible();
    await expect(page.getByText("You: Bet to 2.37 bb (b237)",{exact:true})).toHaveCount(1);
    await page.getByRole("button",{name:"Show decision hints",exact:true}).click();
    await expect(page.getByText(/New solve at the start of this street\./)).toBeVisible();
    await expect(page.getByText(/reported local exploitability/)).toBeVisible();
    await expect(page.getByText(/EV grade unavailable:.*Live and translated decisions are not graded/)).toBeVisible();
    await expect(page.getByText(/hand\/runout outcomes · no Monte Carlo sampling/)).toBeVisible({timeout:60_000});
  });

  test("missing engine bytes refuse the next decision and a fresh Worker succeeds after retry", async ({page,context}) => {
    await context.route("**/solver_bridge_wasm_bg.wasm", r=>r.fulfill({status:404,body:"missing"}));
    await page.goto("/play"); await page.getByLabel("Hand seed").fill("1");
    await page.getByRole("button",{name:"Deal hand",exact:true}).click();
    await page.getByLabel("Bet or raise to (chips)").fill("237");
    await page.getByRole("button",{name:"Place bet",exact:true}).click();
    const retry=page.getByRole("button",{name:"Retry pending decision",exact:true});
    await expect(retry).toBeVisible({timeout:60_000});
    await expect(page.getByText("Pot, including uncalled bets: 10.24 bb",{exact:true})).toBeVisible();
    await expect(page.getByRole("status")).toContainText(/404|fetch|load|asset/i);
    await context.unroute("**/solver_bridge_wasm_bg.wasm"); await retry.click();
    await expect(page.getByRole("button",{name:"Check",exact:true})).toBeEnabled({timeout:120_000});
    await expect(page.getByText("You: Bet to 2.37 bb (b237)",{exact:true})).toHaveCount(1);
  });
});

test("play has usable controls at real 200% browser zoom", async ({browserName,baseURL},info) => {
  test.skip(browserName!=="chromium","Real zoom API is Chromium-only; all engines also check 200% text");
  const extension=resolve("e2e/fixtures/browser-zoom");
  const context=await chromium.launchPersistentContext("",{channel:"chromium",viewport:null,deviceScaleFactor:undefined,
    args:["--window-size=1280,900",`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  try {
    const worker=context.serviceWorkers()[0]??await context.waitForEvent("serviceworker");
    const page=context.pages()[0];await page.goto(`${baseURL}/play`);
    const before=await page.evaluate(()=>({width:innerWidth,dpr:devicePixelRatio}));
    const zoom=await worker.evaluate(async()=>{
      const {tabs}=(globalThis as unknown as {chrome:{tabs:{query(q:object):Promise<{id:number}[]>;
        setZoomSettings(id:number,q:object):Promise<void>;setZoom(id:number,n:number):Promise<void>;getZoom(id:number):Promise<number>}}}).chrome;
      const [tab]=await tabs.query({active:true,currentWindow:true});await tabs.setZoomSettings(tab.id,{mode:"automatic",scope:"per-tab"});
      await tabs.setZoom(tab.id,2);return tabs.getZoom(tab.id);
    });
    expect(zoom).toBe(2);await expect.poll(()=>page.evaluate(()=>innerWidth)).toBe(before.width/2);
    expect(await page.evaluate(()=>devicePixelRatio)).toBe(before.dpr*2);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
    await page.keyboard.press("Tab");await expect(page.getByRole("link",{name:"Skip to the poker table"})).toBeFocused();
    await page.keyboard.press("Enter");await page.keyboard.press("Tab");await expect(page.getByLabel("Your seat")).toBeFocused();
    expect(await page.getByLabel("Your seat").evaluate(e=>getComputedStyle(e).outlineWidth)).toBe("2px");
    const cdp=await context.newCDPSession(page);
    const {data}=await cdp.send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
    await writeFile(info.outputPath("play-browser-zoom-200.png"),Buffer.from(data,"base64"));
    await info.attach("zoom.json",{body:JSON.stringify({before,zoom,after:await page.evaluate(()=>({width:innerWidth,dpr:devicePixelRatio}))}),contentType:"application/json"});
  }finally{await context.close();}
});
