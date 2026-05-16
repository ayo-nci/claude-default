# Monitors

Two scheduled monitors, both built on the same pattern: GitHub Actions
cron → scraper writes a JSON snapshot → diff vs previous commit → file
a single consolidated GitHub Issue per scrape for any new matches. A
static Next.js site renders the current snapshots.

## Monitors

| Source | Match | Schedule | Data | Web route |
|---|---|---|---|---|
| `dunnesstores.com/men/clothing` | items under €10 + your watch list | every 30 min | `data/items.json` | `/` |
| `rent.ie/rooms-to-rent/renting_dublin` | ensuite rooms | hourly | `data/rent/listings.json` | `/rent` |

## Layout

```
apps/
  scraper/        Dunnes scraper (VTEX catalog API)
  scraper-rent/   rent.ie scraper (RSS via ScrapingBee) + /send responder
  web/            Static Next.js export rendering both snapshots
packages/
  types/          Shared DealItem / RentListing types
  tsconfig/       Shared tsconfig presets
  eslint-config/  Shared ESLint config
  ui/             Shared React components
data/
  items.json      Current Dunnes snapshot
  watch.json      Dunnes watch list (edit to subscribe to keywords/IDs)
  rent/listings.json   Current rent.ie snapshot
.github/workflows/
  scrape.yml         Dunnes cron + notifier
  scrape-rent.yml    rent.ie cron + notifier
  rent-respond.yml   /send <listing-id> reply handler
  deploy.yml         Build + publish to GitHub Pages
```

## Required repo secrets

| Secret | Used by | What for |
|---|---|---|
| `SCRAPINGBEE_API_KEY` | rent.ie scraper | residential-IP proxy (free tier) |
| `APPLICANT_NAME` | rent.ie `/send` | your name in the application draft |
| `APPLICANT_EMAIL` | rent.ie `/send` | contact email |
| `APPLICANT_PHONE` | rent.ie `/send` | contact phone |
| `APPLICANT_BIO` | rent.ie `/send` | one-paragraph self-intro |

`GITHUB_TOKEN` is provided automatically.

## Local

```bash
pnpm install
pnpm --filter @repo/scraper scrape         # Dunnes → data/items.json
SCRAPINGBEE_API_KEY=... pnpm --filter @repo/scraper-rent scrape   # rent.ie
pnpm --filter @repo/web dev                # http://localhost:3000
```

## Patterns and gotchas

See [`FINDINGS.md`](./FINDINGS.md) for what we learned — the access-tier
hierarchy (official API > RSS > scraping > headless > paid proxy), the
ScrapingBee credit budget, the notification mistakes we made, and the
parsing gotchas worth knowing before adding a third source.

See [`BACKLOG.md`](./BACKLOG.md) for the planned Dunnes `/send`
generator.
