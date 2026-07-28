# Compact Series — Landing Page

Full-screen product landing page for the Waterloo Biofilter **Compact Series** septic system. The background video scrubs forward as you move through three snap sections (Hero, Technology, Architecture) — there is no traditional scrolling.

## Run it locally

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Deploy to Vercel

This is a static site (no build step). Only these files ship:

- `index.html` / `styles.css` / `script.js`
- `assets/compact-series.mp4`, `hero-poster.jpg`, `waterloo-logo.png`
- `assets/install-1.png`, `install-2.png`, `nozzle.png`, `pump-chamber.png`
- `assets/Compact_Series.pdf`, `assets/fonts/Coolvetica-Rg.otf`
- `vercel.json`

### Option A — GitHub

```bash
git init
git add .
git commit -m "Initial Compact Series landing page"
# create a GitHub repo, then:
git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
git push -u origin main
```

Then in [vercel.com](https://vercel.com) → **Add New Project** → import the repo → Framework: **Other** → Deploy (leave Build / Output empty).

### Option B — Vercel CLI

```bash
npm i -g vercel
vercel          # preview
vercel --prod   # production
```

`.gitignore` and `.vercelignore` exclude source footage, screenshot dumps, and unused design assets so deploys stay smaller (~42MB mainly from the scrub video).

## Files

- `index.html` / `styles.css` / `script.js` — the page
- `assets/compact-series.mp4` — web-optimized video (1440p H.264, keyframe on every frame for smooth scrubbing)
- `assets/hero-poster.jpg` — poster frame shown while the video loads
- `assets/waterloo-logo.png` — logo (recolored to white via CSS filter)
- `assets/Compact_Series.pdf` — brochure linked from “Download the Brochure”
- `vercel.json` — cache headers for assets

## Notes

- Navigate with mouse wheel, trackpad, touch swipe, or arrow / page keys.
- To regenerate the scrub-optimized video from a new source:

```bash
ffmpeg -i SOURCE.mp4 -an -vf "scale=2560:1440" -c:v libx264 -preset slow -crf 21 -g 1 -pix_fmt yuv420p -movflags +faststart assets/compact-series.mp4
ffmpeg -ss 1.5 -i assets/compact-series.mp4 -frames:v 1 -update 1 -q:v 2 assets/hero-poster.jpg
```
