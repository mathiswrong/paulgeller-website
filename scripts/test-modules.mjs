import { chromium } from "playwright";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const JS_DIR = join(import.meta.dirname, "../public/js");
const files = (await readdir(JS_DIR)).filter((f) => f.endsWith(".mjs"));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

for (const file of files) {
  const url = `http://127.0.0.1:8877/js/${file}`;
  try {
    await page.goto("about:blank");
    const err = await page.evaluate(async (moduleUrl) => {
      try {
        await import(moduleUrl);
        return null;
      } catch (e) {
        return String(e);
      }
    }, url);
    console.log(err ? `FAIL ${file}: ${err}` : `OK   ${file}`);
  } catch (e) {
    console.log(`ERR  ${file}: ${e.message}`);
  }
}

await browser.close();
