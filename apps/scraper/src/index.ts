import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import * as cheerio from "cheerio";
import type { DealItem, DealsSnapshot } from "@repo/types";

const SOURCE_URL = "https://www.dunnesstores.com/men/clothing";
const THRESHOLD = 10;
const CURRENCY = "EUR";
const OUTPUT_PATH = resolve(process.cwd(), "../../data/items.json");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function fetchAllPages(): Promise<string[]> {
  const pages: string[] = [];
  let start = 0;
  const sz = 60;
  for (let i = 0; i < 20; i++) {
    const url = i === 0 ? SOURCE_URL : `${SOURCE_URL}?start=${start}&sz=${sz}`;
    const res = await fetch(url, {
      headers: {
        "user-agent": UA,
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-IE,en;q=0.9"
      }
    });
    if (!res.ok) {
      if (i === 0) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
      break;
    }
    const html = await res.text();
    pages.push(html);
    const $ = cheerio.load(html);
    const tileCount = $("[data-pid], .product-tile, .product").length;
    if (tileCount < sz) break;
    start += sz;
  }
  return pages;
}

function parsePrice(text: string | undefined | null): number | null {
  if (!text) return null;
  const m = text.replace(/,/g, ".").match(/(\d+(?:\.\d{1,2})?)/);
  return m ? Number(m[1]) : null;
}

function extractFromJsonLd($: cheerio.CheerioAPI): DealItem[] {
  const items: DealItem[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      const nodes: unknown[] = Array.isArray(data) ? data : [data];
      for (const node of nodes) walk(node, items);
    } catch {
      /* ignore malformed json-ld */
    }
  });
  return items;
}

function walk(node: unknown, items: DealItem[]): void {
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  const type = obj["@type"];
  if (type === "Product" || (Array.isArray(type) && type.includes("Product"))) {
    const offers = obj.offers as Record<string, unknown> | undefined;
    const offerList = Array.isArray(offers) ? offers : offers ? [offers] : [];
    let price: number | null = null;
    let currency = CURRENCY;
    for (const o of offerList) {
      const oo = o as Record<string, unknown>;
      const p = parsePrice(String(oo.price ?? oo.lowPrice ?? ""));
      if (p != null) {
        price = price == null ? p : Math.min(price, p);
      }
      if (typeof oo.priceCurrency === "string") currency = oo.priceCurrency;
    }
    if (price != null) {
      const sku = String(obj.sku ?? obj.productID ?? obj.mpn ?? obj.url ?? obj.name ?? "");
      const url = typeof obj.url === "string" ? obj.url : "";
      const image = Array.isArray(obj.image)
        ? String(obj.image[0])
        : typeof obj.image === "string"
        ? obj.image
        : null;
      items.push({
        id: sku || url || String(obj.name ?? ""),
        name: String(obj.name ?? ""),
        price,
        currency,
        url: url.startsWith("http") ? url : `https://www.dunnesstores.com${url}`,
        imageUrl: image
      });
    }
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object") walk(v, items);
  }
}

function extractFromTiles($: cheerio.CheerioAPI): DealItem[] {
  const items: DealItem[] = [];
  $("[data-pid], .product-tile, .product").each((_, el) => {
    const $el = $(el);
    const pid =
      $el.attr("data-pid") ||
      $el.find("[data-pid]").first().attr("data-pid") ||
      "";
    const name =
      $el.find(".pdp-link a, .product-name, .link, a.name-link").first().text().trim() ||
      $el.find("a").first().attr("title") ||
      "";
    const priceText =
      $el.find(".sales .value, .price-sales, .sales, .price .value, .price").first().text() || "";
    const price = parsePrice(priceText);
    const href = $el.find("a").first().attr("href") || "";
    const img =
      $el.find("img").first().attr("src") ||
      $el.find("img").first().attr("data-src") ||
      null;
    if (!price || !name) return;
    items.push({
      id: pid || href || name,
      name,
      price,
      currency: CURRENCY,
      url: href.startsWith("http") ? href : `https://www.dunnesstores.com${href}`,
      imageUrl: img
    });
  });
  return items;
}

function dedupe(items: DealItem[]): DealItem[] {
  const seen = new Map<string, DealItem>();
  for (const it of items) {
    const existing = seen.get(it.id);
    if (!existing || it.price < existing.price) seen.set(it.id, it);
  }
  return [...seen.values()];
}

async function main(): Promise<void> {
  console.log(`Scraping ${SOURCE_URL}`);
  const pages = await fetchAllPages();
  console.log(`Fetched ${pages.length} page(s)`);

  const all: DealItem[] = [];
  for (const html of pages) {
    const $ = cheerio.load(html);
    const jsonLd = extractFromJsonLd($);
    const tiles = extractFromTiles($);
    all.push(...jsonLd, ...tiles);
  }
  const unique = dedupe(all);
  const cheap = unique
    .filter((i) => i.price > 0 && i.price < THRESHOLD)
    .sort((a, b) => a.price - b.price);

  console.log(`Parsed ${unique.length} products, ${cheap.length} under €${THRESHOLD}`);

  const snapshot: DealsSnapshot = {
    fetchedAt: new Date().toISOString(),
    source: SOURCE_URL,
    threshold: THRESHOLD,
    currency: CURRENCY,
    items: cheap
  };

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(snapshot, null, 2) + "\n");
  console.log(`Wrote ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
