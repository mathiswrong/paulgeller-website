import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const client = await context.newCDPSession(page);

const exceptions = [];
client.on("Runtime.exceptionThrown", (params) => {
  const d = params.exceptionDetails;
  exceptions.push({
    text: d.exception?.description || d.text,
    url: d.url,
    line: d.lineNumber,
    col: d.columnNumber,
    stack: d.stackTrace?.callFrames?.slice(0, 5),
  });
});

await page.goto("https://paulgeller-website.vercel.app/", {
  waitUntil: "networkidle",
  timeout: 60000,
});
await page.waitForTimeout(4000);

console.log(JSON.stringify(exceptions, null, 2));
await browser.close();
