#!/usr/bin/env node
/**
 * Mirrors paulgeller.us (Framer export) into public/ for static Vercel deployment.
 * Downloads HTML, images, videos, and fonts locally. Framer JS bundles stay on CDN
 * so scroll animations, parallax, and interactive effects hydrate identically.
 */

import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PUBLIC = join(ROOT, "public");
const ASSETS = join(PUBLIC, "assets");

const ORIGIN = "https://paulgeller.us";
const PAGES = [
  { path: "/", out: "index.html" },
  { path: "/404", out: "404.html" },
];

const CONCURRENCY = 8;

async function fetchText(url, { allow404 = false } = {}) {
  const res = await fetch(url, {
    headers: { "User-Agent": "paulgeller-website-mirror/1.0" },
  });
  if (!res.ok && !(allow404 && res.status === 404)) {
    throw new Error(`GET ${url} → ${res.status}`);
  }
  return res.text();
}

async function fetchBuffer(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "paulgeller-website-mirror/1.0" },
  });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function extractUrls(html) {
  const urls = new Set();
  const patterns = [
    /https:\/\/framerusercontent\.com\/[^"'\s)>]+/g,
    /https:\/\/fonts\.gstatic\.com\/[^"'\s)>]+/g,
  ];
  for (const re of patterns) {
    for (const m of html.matchAll(re)) {
      let url = m[0].replace(/&amp;/g, "&");
      url = url.replace(/[)"'\\]+$/, "");
      // Normalize to base path (drop Framer resize query params)
      const q = url.indexOf("?");
      if (q !== -1) url = url.slice(0, q);
      urls.add(url);
    }
  }
  return [...urls];
}

function assetLocalPath(url) {
  const u = new URL(url);
  const hash = createHash("sha256").update(url).digest("hex").slice(0, 10);
  const base = u.pathname.split("/").pop() || "asset";
  const clean = base.split("?")[0];
  const ext = extname(clean) || ".bin";
  const name = clean.replace(ext, "");
  return `assets/${name}-${hash}${ext}`;
}

function isDownloadableAsset(url) {
  if (url.includes("/sites/") && url.endsWith(".mjs")) return false;
  if (url.includes(".json")) return false;
  return /\.(png|jpe?g|webp|gif|svg|mp4|webm|woff2?|ttf|otf)(\?|$)/i.test(url);
}

async function downloadAsset(url, localRel) {
  const dest = join(PUBLIC, localRel);
  try {
    await access(dest);
    return localRel;
  } catch {
    /* not cached */
  }
  await mkdir(dirname(dest), { recursive: true });
  const buf = await fetchBuffer(url);
  await writeFile(dest, buf);
  return localRel;
}

async function pool(items, fn, limit) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function rewriteHtml(html, urlMap) {
  let out = html;
  const entries = [...urlMap.entries()].sort((a, b) => b[0].length - a[0].length);
  for (const [remote, local] of entries) {
    const localUrl = `/${local}`;
    const escaped = remote.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Replace base URL plus optional Framer CDN query params (?width=…&height=…)
    const re = new RegExp(escaped + "(?:\\?[^\"'\\s)>]*)?", "g");
    out = out.replace(re, localUrl);
  }
  out = out.replace(/https:\/\/paulgeller\.us\//g, "/");
  return out;
}

async function main() {
  console.log("Mirroring paulgeller.us …\n");
  await mkdir(PUBLIC, { recursive: true });
  await mkdir(ASSETS, { recursive: true });

  const allHtml = [];
  for (const page of PAGES) {
    const url = `${ORIGIN}${page.path}`;
    console.log(`  Fetching ${url}`);
    const html = await fetchText(url, { allow404: page.path === "/404" });
    allHtml.push(html);
    await writeFile(join(PUBLIC, `_raw-${page.out}`), html);
  }

  const combined = allHtml.join("\n");
  const allUrls = extractUrls(combined);
  const downloadable = allUrls.filter(isDownloadableAsset);
  console.log(`\n  Found ${allUrls.length} CDN URLs, downloading ${downloadable.length} static assets …\n`);

  const urlMap = new Map();
  let done = 0;
  await pool(
    downloadable,
    async (url) => {
      const local = assetLocalPath(url);
      await downloadAsset(url, local);
      urlMap.set(url, local);
      done++;
      if (done % 10 === 0 || done === downloadable.length) {
        process.stdout.write(`\r  Downloaded ${done}/${downloadable.length} assets`);
      }
    },
    CONCURRENCY
  );
  console.log("\n");

  for (const page of PAGES) {
    const raw = await readFile(join(PUBLIC, `_raw-${page.out}`), "utf8");
    const rewritten = rewriteHtml(raw, urlMap);
    await writeFile(join(PUBLIC, page.out), rewritten);
    console.log(`  Wrote public/${page.out}`);
  }

  // Remove raw snapshots
  for (const page of PAGES) {
    const rawPath = join(PUBLIC, `_raw-${page.out}`);
    try {
      const { unlink } = await import("node:fs/promises");
      await unlink(rawPath);
    } catch {
      /* ignore */
    }
  }

  // Copy favicon
  const faviconSrc = urlMap.has(
    "https://framerusercontent.com/images/9Ay6LCuX4P0qnKq9KYpvtmUQ4.png"
  )
    ? join(PUBLIC, urlMap.get("https://framerusercontent.com/images/9Ay6LCuX4P0qnKq9KYpvtmUQ4.png"))
    : null;
  if (faviconSrc) {
    const favicon = await readFile(faviconSrc);
    await writeFile(join(PUBLIC, "favicon.png"), favicon);
  }

  console.log("\nDone. Framer JS bundles remain on CDN for full interactivity.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
