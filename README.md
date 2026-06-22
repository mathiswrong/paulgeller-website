# paulgeller.us

Pixel-perfect static mirror of [paulgeller.us](https://paulgeller.us), built from the live Framer export. Scroll animations, parallax, video hero, hamburger menu, and contact links all hydrate via Framer's runtime.

## Stack

- **Source:** Framer (published export from paulgeller.us)
- **Hosting:** Vercel static (`public/` output)
- **Assets:** Images, videos, fonts, and JS bundles all stored locally (~32 MB)
- **Runtime:** Self-contained — no dependency on Framer CDN, editor bar, or analytics

## Quick start

```bash
# Re-sync from live site
npm run mirror

# Preview locally
npm run dev
# → http://localhost:3000
```

## Deploy to Vercel

1. Push this repo to GitHub.
2. Import the repo in [Vercel](https://vercel.com/new).
3. Vercel auto-detects settings from `vercel.json`:
   - **Build command:** `npm run build`
   - **Output directory:** `public`
4. Deploy. No environment variables required.

Or via CLI:

```bash
npx vercel --prod
```

## Pages

| Route | File |
|-------|------|
| `/` | `public/index.html` |
| `/404` | `public/404.html` |

Sections use hash anchors: `#home`, `#philosophy`, `#works`, `#contact-footer`.

## Contact

The site uses `mailto:` links (not a form POST). Links open the user's email client — same behavior as the live Framer site.

## Re-syncing

`npm run mirror` fetches a fresh copy from the live Framer site. Run this **before** closing your Framer account if you need to pull updates. Vercel deploys the committed `public/` folder directly — no network fetch at build time.

## License

Personal site content © Paul Geller. Framer runtime © Framer B.V.
