#!/usr/bin/env node
/**
 * Fully self-contained mirror of paulgeller.us for Vercel.
 * Downloads HTML, media, fonts, and ALL Framer JS bundles locally.
 * Strips editor bar, analytics, and external Framer dependencies.
 */

import { mkdir, writeFile, readFile, access, readdir, unlink } from "node:fs/promises";
import { dirname, join, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PUBLIC = join(ROOT, "public");
const ASSETS = join(PUBLIC, "assets");
const JS_DIR = join(PUBLIC, "js");

const ORIGIN = "https://paulgeller.us";
const FRAMER_SITE = "https://framerusercontent.com/sites/4jYyIqRzhS5kgptQHFTjbP";
const PAGES = [
  { path: "/", out: "index.html" },
  { path: "/404", out: "404.html" },
];

const CONCURRENCY = 10;

async function fetchText(url, { allow404 = false } = {}) {
  const res = await fetch(url, {
    headers: { "User-Agent": "paulgeller-website-mirror/2.0" },
  });
  if (!res.ok && !(allow404 && res.status === 404)) {
    throw new Error(`GET ${url} → ${res.status}`);
  }
  return res.text();
}

async function fetchBuffer(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "paulgeller-website-mirror/2.0" },
  });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function extractUrlsFromText(text) {
  const urls = new Set();
  const patterns = [
    /https:\/\/framerusercontent\.com\/[^"'\s`)>]+/g,
    /https:\/\/fonts\.gstatic\.com\/[^"'\s`)>]+/g,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      let url = m[0].replace(/&amp;/g, "&");
      url = url.replace(/[)"'\\]+$/, "");
      const q = url.indexOf("?");
      if (q !== -1) url = url.slice(0, q);
      urls.add(url);
    }
  }
  return urls;
}

function extractJsImports(text) {
  const imports = new Set();
  for (const m of text.matchAll(/import\(`\.\/([^`]+\.mjs)`\)/g)) imports.add(m[1]);
  for (const m of text.matchAll(/from"\.\/([^"]+\.mjs)"/g)) imports.add(m[1]);
  for (const m of text.matchAll(/import\("\.\/([^"]+\.mjs)"\)/g)) imports.add(m[1]);
  for (const m of text.matchAll(/https:\/\/framerusercontent\.com\/sites\/[^/]+\/([^"'\s`]+\.mjs)/g)) {
    imports.add(m[1]);
  }
  return imports;
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

function jsLocalPath(filename) {
  return `js/${basename(filename)}`;
}

function moduleLocalPath(url) {
  const u = new URL(url);
  const hash = createHash("sha256").update(url).digest("hex").slice(0, 10);
  const name = u.pathname.split("/").pop() || "module";
  return `js/modules/${name.replace(/\.[^.]+$/, "")}-${hash}${extname(name) || ".js"}`;
}

async function downloadTo(url, destRel) {
  const dest = join(PUBLIC, destRel);
  try {
    await access(dest);
    return destRel;
  } catch {
    /* download */
  }
  await mkdir(dirname(dest), { recursive: true });
  const buf = await fetchBuffer(url);
  await writeFile(dest, buf);
  return destRel;
}

async function pool(items, fn, limit) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        await fn(items[idx], idx);
      }
    })
  );
}

function rewriteUrls(text, urlMap) {
  let out = text;
  const entries = [...urlMap.entries()].sort((a, b) => b[0].length - a[0].length);
  for (const [remote, local] of entries) {
    const localUrl = local.startsWith("/") ? local : `/${local}`;
    const escaped = remote.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(escaped + "(?:\\?[^\"'\\s)>]*)?", "g");
    out = out.replace(re, localUrl);
  }
  return out;
}

function stripFramerServices(html) {
  let out = html;

  // Editor bar preload
  out = out.replace(
    /<script>try\{if\(localStorage\.get\("__framer_force_showing_editorbar_since"\)\)[^<]*<\/script>\s*/g,
    ""
  );

  // Analytics
  out = out.replace(
    /<script async src="https:\/\/events\.framer\.com\/script[^"]*"[^>]*><\/script>\s*/g,
    ""
  );

  // Search index meta (not needed for static site)
  out = out.replace(/\s*<meta name="framer-search-index[^>]*>/g, "");
  out = out.replace(/\s*<meta name="framer-html-plugin"[^>]*>/g, "");

  // Framer generator comment is fine to keep or remove
  out = out.replace(/<!-- Made in Framer[^>]*-->\s*/g, "");

  // Point JS bundles to local /js/
  out = out.replace(
    /https:\/\/framerusercontent\.com\/sites\/4jYyIqRzhS5kgptQHFTjbP\//g,
    "/js/"
  );

  out = out.replace(/https:\/\/paulgeller\.us\//g, "/");

  return out;
}

async function downloadAllJsBundles(initialHtml, urlMap) {
  const seedImports = new Set();
  for (const m of initialHtml.matchAll(/\/sites\/4jYyIqRzhS5kgptQHFTjbP\/([^"'\s]+\.mjs)/g)) {
    seedImports.add(m[1]);
  }
  for (const m of initialHtml.matchAll(/sites\/4jYyIqRzhS5kgptQHFTjbP\/([^"'\s]+\.mjs)/g)) {
    seedImports.add(m[1]);
  }

  const queue = [...seedImports];
  const seen = new Set();

  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);

    const url = `${FRAMER_SITE}/${file}`;
    const local = jsLocalPath(file);
    await downloadTo(url, local);
    urlMap.set(url, local);

    const content = await readFile(join(PUBLIC, local), "utf8");
    for (const imp of extractJsImports(content)) {
      if (!seen.has(imp)) queue.push(imp);
    }

    // Download module URLs referenced in JS
    for (const modUrl of extractUrlsFromText(content)) {
      if (modUrl.includes("/modules/") && modUrl.endsWith(".js")) {
        const localMod = moduleLocalPath(modUrl);
        await downloadTo(modUrl, localMod);
        urlMap.set(modUrl, localMod);
      }
    }
  }

  console.log(`  Downloaded ${seen.size} JS bundles`);
  return seen;
}

async function rewriteJsFiles(urlMap) {
  // Stub for disabled editor bar
  await writeFile(
    join(JS_DIR, "noop-editor.mjs"),
    `export function createEditorBar(){return function EditorBar(){return null}}\n`
  );

  const files = await readdir(JS_DIR, { recursive: true });
  for (const rel of files) {
    if (!rel.endsWith(".mjs") && !rel.endsWith(".js")) continue;
    const path = join(JS_DIR, rel);
    let content = await readFile(path, "utf8");

    content = content.replaceAll(
      "https://framer.com/edit/init.mjs",
      "/js/noop-editor.mjs"
    );
    content = content.replace(/EditorBar:[^,]+,/, "EditorBar:void 0,");

    content = rewriteUrls(content, urlMap);
    await writeFile(path, content);
  }
}

async function main() {
  console.log("Mirroring paulgeller.us (fully self-contained) …\n");
  await mkdir(PUBLIC, { recursive: true });
  await mkdir(ASSETS, { recursive: true });
  await mkdir(JS_DIR, { recursive: true });

  const rawPages = new Map();
  const allHtml = [];

  for (const page of PAGES) {
    const url = `${ORIGIN}${page.path}`;
    console.log(`  Fetching ${url}`);
    const html = await fetchText(url, { allow404: page.path === "/404" });
    rawPages.set(page.out, html);
    allHtml.push(html);
  }

  const combined = allHtml.join("\n");
  const urlMap = new Map();

  // 1. Download JS bundles (recursive)
  console.log("\n  Downloading Framer JS runtime …");
  await downloadAllJsBundles(combined, urlMap);

  // 2. Collect all asset URLs from HTML + JS
  const assetUrls = new Set(extractUrlsFromText(combined));
  for (const file of await readdir(JS_DIR, { recursive: true })) {
    if (!file.endsWith(".mjs") && !file.endsWith(".js")) continue;
    const text = await readFile(join(JS_DIR, file), "utf8");
    for (const u of extractUrlsFromText(text)) assetUrls.add(u);
  }

  // Skip JS bundles already handled, skip framer.com, skip invalid URLs
  const downloadable = [...assetUrls].filter((u) => {
    if (u.includes("framer.com") || u.includes("/sites/") || u.endsWith(".mjs")) return false;
    if (!u.includes("framerusercontent.com") && !u.includes("fonts.gstatic.com")) return false;
    const path = new URL(u).pathname;
    const ext = extname(path);
    return ext.length > 1 && !path.endsWith("/");
  });

  console.log(`  Downloading ${downloadable.length} media/font assets …`);
  let done = 0;
  await pool(
    downloadable,
    async (url) => {
      const local = assetLocalPath(url);
      await downloadTo(url, local);
      urlMap.set(url, local);
      done++;
      if (done % 20 === 0 || done === downloadable.length) {
        process.stdout.write(`\r  Downloaded ${done}/${downloadable.length} assets`);
      }
    },
    CONCURRENCY
  );
  console.log("\n");

  // 3. Rewrite JS files with local asset paths
  console.log("  Rewriting JS bundles to use local assets …");
  await rewriteJsFiles(urlMap);

  // 4. Write HTML pages
  for (const page of PAGES) {
    let html = rawPages.get(page.out);
    html = rewriteUrls(html, urlMap);
    html = stripFramerServices(html);
    await writeFile(join(PUBLIC, page.out), html);
    console.log(`  Wrote public/${page.out}`);
  }

  // Favicon
  const faviconKey = [...urlMap.keys()].find((k) => k.includes("9Ay6LCuX4P0qnKq9KYpvtmUQ4"));
  if (faviconKey) {
    const favicon = await readFile(join(PUBLIC, urlMap.get(faviconKey)));
    await writeFile(join(PUBLIC, "favicon.png"), favicon);
  }

  // Verify no remaining Framer dependencies
  const index = await readFile(join(PUBLIC, "index.html"), "utf8");
  const remaining = [
    ...index.matchAll(/https:\/\/(?:framer\.com|events\.framer\.com|framerusercontent\.com)[^"'\s)>]*/g),
  ].map((m) => m[0]);

  if (remaining.length) {
    console.warn("\n  Warning: remaining external Framer URLs in index.html:");
    for (const u of [...new Set(remaining)]) console.warn(`    ${u}`);
  } else {
    console.log("\n  ✓ No external Framer URLs remain in index.html");
  }

  console.log("\nDone. Site is fully self-contained.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
