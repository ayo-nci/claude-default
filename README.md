# Dunnes Men's under €10 — monitor

Static site that lists items under €10 from
https://www.dunnesstores.com/men/clothing. A scheduled GitHub Action
re-scrapes the site, commits an updated `data/items.json`, and the
new commit triggers a Pages redeploy.

## Layout

```
apps/
  web/         Next.js (static export) — renders data/items.json
  scraper/     Node script — fetches the page, writes data/items.json
  api/         (Hono starter — unused by this app, kept as a scaffold)
packages/
  types/       Shared DealItem / DealsSnapshot types
  ui/          Shared React components
  tsconfig/    Shared tsconfig presets
  eslint-config/  Shared ESLint config
data/
  items.json   Latest snapshot; committed by the Scrape workflow
.github/workflows/
  scrape.yml   Cron job (every 30 min) — runs the scraper, commits data
  deploy.yml   On push to main — builds the web app and deploys to Pages
```

## Local

```bash
pnpm install
pnpm --filter @repo/scraper scrape   # writes data/items.json
pnpm --filter @repo/web dev          # http://localhost:3000
```

## Enabling GitHub Pages

In the repo settings:

1. **Settings → Pages → Build and deployment → Source**: GitHub Actions.
2. **Settings → Actions → General → Workflow permissions**: Read and write
   permissions (so the scrape workflow can push data commits).

Push to `main` triggers a build. The cron workflow runs every 30 minutes;
trigger it manually via the **Actions → Scrape → Run workflow** button to
seed the first snapshot.
