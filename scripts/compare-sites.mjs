import { chromium } from "playwright";

const url = process.argv[2] || "http://127.0.0.1:8891/";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (err) => errors.push(err.message));

await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
for (const y of [0, 400, 800, 1200, 2000, 3000]) {
  await page.evaluate((yy) => window.scrollTo(0, yy), y);
  await page.waitForTimeout(800);
}

const state = await page.evaluate(() => ({
  errors: window.__framer_hadFatalError || false,
  videos: [...document.querySelectorAll("video")].map((v) => ({
    paused: v.paused,
    readyState: v.readyState,
    currentTime: v.currentTime,
  })),
  paul: document.querySelector('[data-framer-name="PAUL"]')?.style.transform,
  geller: document.querySelector('[data-framer-name="GELLER"]')?.style.transform,
}));

console.log(url);
console.log("page errors:", errors);
console.log(JSON.stringify(state, null, 2));
await browser.close();
