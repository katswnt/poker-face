import {defineConfig,devices} from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({...base,testMatch:"drills-push-fold.spec.ts",projects:[
  {name:"chromium",use:{...devices["Desktop Chrome"]}},
  {name:"firefox",use:{...devices["Desktop Firefox"]}},
  {name:"webkit",use:{...devices["Desktop Safari"]}},
]});
