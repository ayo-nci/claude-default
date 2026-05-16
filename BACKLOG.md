# Backlog

Future enhancements. Each entry is a short design sketch, not a spec.

## `/send` — generated product summary + tap-to-buy

When you reply `/send` to a `dunnes-alert` issue (either via email or
directly on GitHub), a workflow generates a comment on the issue that
contains a concise summary of the product and a deep link you can tap
to complete the purchase in your browser.

### Flow

1. Notification email arrives for a new under-€10 match.
2. You reply `/send` to that email (GitHub posts your reply as an
   issue comment).
3. The `comment-action` workflow fires on `issue_comment.created`,
   filters for `dunnes-alert`-labelled issues whose body starts with
   `/send`.
4. The workflow:
   - Looks up the product in the latest `data/items.json` using the
     product ID stored in the issue body.
   - Generates a short summary (name, price, key attributes, image).
   - Posts a follow-up comment on the issue with the summary plus a
     prominent tap-to-buy URL (the product `/p` page; later, a deep
     link that pre-selects size if we can encode it).

### What's explicitly **not** in scope

- No autonomous checkout. No stored payment credentials.
- No interaction with Dunnes' cart API (ToS-grey and brittle).
- The bot's job ends when you have a one-tap path to buy.

### Open questions

- Where do summaries come from? Cheapest: scraper already has `name`,
  `price`, `imageUrl`. Richer: hit the product detail API
  (`/api/catalog_system/pub/products/search?fq=productId:<id>`) to
  pull description / attributes / variants.
- How do we encode the chosen size in the buy URL? VTEX uses
  `?skuId=<id>` query params on some storefronts — needs probing.
- Multiple `/send` replies on the same issue → re-summarize, or
  ignore?

### Dependencies

- Adds a `.github/workflows/comment-action.yml` triggered on
  `issue_comment`.
- Permissions: `issues: write` (already granted).
- No new secrets.
