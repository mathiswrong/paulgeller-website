import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../public");
const MIME = {
  ".html": "text/html",
  ".mjs": "application/javascript",
  ".js": "application/javascript",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

const server = createServer(async (req, res) => {
  const path = join(ROOT, req.url === "/" ? "index.html" : req.url.split("?")[0]);
  const data = await readFile(path);
  res.writeHead(200, { "Content-Type": MIME[extname(path)] || "application/octet-stream" });
  res.end(data);
});
await new Promise((r) => server.listen(8892, r));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
page.on("requestfailed", (r) => logs.push(`[fail] ${r.url()} ${r.failure()?.errorText}`));

await page.goto("http://127.0.0.1:8892/", { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(5000);

for (const line of logs) console.log(line);
server.close();
await browser.close();
