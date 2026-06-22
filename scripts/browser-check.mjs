import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../public");
const MIME = { ".html": "text/html", ".mjs": "application/javascript", ".js": "application/javascript", ".mp4": "video/mp4", ".png": "image/png", ".woff2": "font/woff2", ".jpg": "image/jpeg" };

const server = createServer(async (req, res) => {
  const path = join(ROOT, req.url === "/" ? "index.html" : req.url.split("?")[0]);
  try {
    const data = await readFile(path);
    res.writeHead(200, { "Content-Type": MIME[extname(path)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(8891, r));
const base = "http://127.0.0.1:8891/";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (err) => errors.push(err.stack || String(err)));

await page.goto(base, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(5000);
await page.evaluate(() => window.scrollBy(0, 1200));
await page.waitForTimeout(3000);

const state = await page.evaluate(() => ({
  title: document.title,
  main: !!document.getElementById("main"),
  videoCount: document.querySelectorAll("video").length,
  videos: [...document.querySelectorAll("video")].map((v) => ({
    src: v.currentSrc || v.src,
    paused: v.paused,
    readyState: v.readyState,
  })),
  paulTransform: document.querySelector('[data-framer-name="PAUL"]')?.style.transform,
}));

console.log("ERRORS", errors);
console.log("STATE", JSON.stringify(state, null, 2));

server.close();
await browser.close();
