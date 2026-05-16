# Findings

Lessons learned building the Dunnes + rent.ie monitors. Future-me/you,
read this before adding a third source — it'll save several iterations.

## Scraping access tiers (cheapest → priciest)

For any new target, try in this order. Don't skip ahead.

1. **Official API.** Many ecommerce sites publish a public JSON API for
   their own storefront (Dunnes is on VTEX → `/api/catalog_system/pub/products/search/...`).
   No bot detection, returns full structured data with canonical URLs,
   paginates predictably. Always check this first by opening DevTools →
   Network on the target page and looking for XHR requests.
2. **Public RSS.** Many listing sites publish RSS feeds (rent.ie does at
   `rss.rent.ie/...`). Feeds usually bypass anti-bot because they're
   intended for aggregators. Far less data than the official API, but
   enough for "did something new appear?" alerts.
3. **HTML scraping.** Only if neither of the above exists. Even then,
   property/real-estate sites are usually behind bot protection that
   plain `fetch` won't beat.
4. **Headless browser (Playwright/Chromium).** Defeats simple JS rendering
   but not modern challenge pages (Cloudflare Turnstile, DataDome, etc.).
   Heavy in CI (~30s install per run, even with cache).
5. **Residential-IP proxy (ScrapingBee, etc.).** When the block is at the
   IP/ASN level (GitHub Actions runs on Azure ranges, often pre-blocked).
   ScrapingBee free tier = 1,000 credits/month — enough for hourly cron
   on a single target with the cheap `render_js=false` mode.

## Diagnosing 403s

The 403 body tells you the layer:

- **Empty body / minimal text:** edge IP block. Switching code won't help.
  Need a different source IP (residential proxy, your laptop, Cloudflare
  Worker).
- **HTML page with "Security Check" / "Verifying you are human":** JS
  challenge. Headless browsers *sometimes* solve these; stealth-patched
  browsers more often; residential proxies always.
- **JSON with "rate limit" / "too many requests":** you're hitting the
  API too hard. Slow the cron or add backoff.

We confirmed rent.ie is JS-challenge protection (body said `Security
Check | Rent`), and even headless Chromium failed it — needed ScrapingBee.

## Cost-aware cron

| Service | Free tier | Hourly cost | Verdict |
|---|---|---|---|
| GitHub Actions | 2,000 min/mo private (unlimited public) | ~30s/run | Free for our cadence |
| ScrapingBee | 1,000 credits/mo | 1 credit per request (no JS render) | Hourly = 730/mo, safe |
| GitHub Pages | Free for public | Per-deploy build | Free |

**Rules of thumb:**
- Half-hourly = 1,440 calls/month → over the ScrapingBee free tier.
- Hourly = ~730 calls/month → safe with retry headroom.
- `render_js=true` costs 10 credits (10× more). Avoid unless required
  for the data you need.
- `premium_proxy=true` costs 25 credits (25×). Only enable if `render_js`
  with basic proxy still 403s.

## Notification patterns

What worked:

- **One issue per scrape run**, not one per item. Spammed mail/notifications
  the first time we shipped per-item alerts.
- **Assign + @mention the owner.** GitHub does NOT email you for issues
  opened by bots in your own repo unless you're explicitly assigned OR
  mentioned. Both is belt-and-braces.
- **Listing/item IDs as HTML comments** in the issue body
  (`<!-- listing-id: X -->`) so the `/send` handler can find them
  without parsing display text.

What didn't:

- Filing 7 socks issues in 90 seconds. Two seconds of staring at the
  notifications panel made the lesson stick.
- Per-watch-list issues (early Dunnes design). Same spam problem.

## `/send` command

For commands like `/send` triggered by issue replies:

- Trigger: `on: issue_comment` with `types: [created]`.
- Filter in the workflow `if:` to label + comment-body prefix to avoid
  running on every comment site-wide.
- Pass `github.event.comment.body` as an env var (`COMMENT_BODY`) to
  the script so you can parse arguments (`/send 6573178`).
- Email-reply quoted text is stripped by GitHub when it converts the
  reply to a comment, so the command can rely on the top of the body
  being the user's input.

We deliberately did NOT auto-submit forms. The bot composes a
copy-pasteable message and links to the listing's form — you finalize.
Auto-submit was rejected for ToS, payment-credential, and brittleness
reasons (see `BACKLOG.md`).

## Parsing gotchas

- **HTML entities in RSS.** Feeds encode `€` as `&euro;`. Decode entities
  before any regex that looks for the symbol or you'll silently
  null-out every price. Same for `&amp;`, `&#39;`, etc.
- **Word-boundary matches on negated phrases.** `/ensuite/i` matches
  `non-ensuite`. Either use a negative lookbehind or strip the negated
  phrase first then check for the positive (the approach we took).
- **VTEX seller availability.** A product can have a price but be
  unavailable. Always check `commertialOffer.IsAvailable` and
  `AvailableQuantity > 0`.
- **JSON-LD `url` fields are sometimes empty strings**, not missing.
  `url.startsWith("http") ? url : ORIGIN + url` becomes `ORIGIN + ""` =
  just the homepage. Guard against empty.

## Build pipeline

- Next.js `output: "export"` works for static GitHub Pages deployment.
  `basePath` must match the repo name when deployed under
  `https://<owner>.github.io/<repo>/`.
- Read data files at *build time* in server components, not at runtime
  (the static export has no server). Add a try/catch fallback so an
  empty/missing data file doesn't break the build (we hit this when
  the user manually cleared `items.json`).
- `pnpm/action-setup@v4` reads `packageManager` from `package.json`.
  Don't also pin `with: version:` — pnpm errors out on the conflict
  with `ERR_PNPM_BAD_PM_VERSION`.

## What's not in scope (yet)

- LLM-composed application messages (rent.ie /send currently uses a
  template). Skipped to avoid an Anthropic API key dep; revisit if
  templates feel too generic.
- Auto-submission of any external form. See `BACKLOG.md`.
- Price-history tracking on Dunnes. Snapshot-only today; git log
  serves as history.
