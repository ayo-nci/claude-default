import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { DealItem, DealsSnapshot } from "@repo/types";

const ORIGIN = "https://www.dunnesstores.com";
const CATEGORY_PATH = "men/clothing";
const SOURCE_URL = `${ORIGIN}/${CATEGORY_PATH}`;
const API_BASE = `${ORIGIN}/api/catalog_system/pub/products/search/${CATEGORY_PATH}`;
const THRESHOLD = 10;
const CURRENCY = "EUR";
const PAGE_SIZE = 50; // VTEX hard max per request
const PAGE_CAP = 50; // 50 * 50 = 2500 products, well above the category size
const OUTPUT_PATH = resolve(process.cwd(), "../../data/items.json");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

interface VtexImage {
  imageUrl: string;
}

interface VtexCommercialOffer {
  Price: number;
  ListPrice?: number;
  IsAvailable?: boolean;
  AvailableQuantity?: number;
}

interface VtexSeller {
  commertialOffer: VtexCommercialOffer;
}

interface VtexItem {
  itemId?: string;
  images?: VtexImage[];
  sellers?: VtexSeller[];
}

interface VtexProduct {
  productId: string;
  productName: string;
  linkText?: string;
  link?: string;
  items?: VtexItem[];
}

async function fetchPage(from: number, to: number): Promise<VtexProduct[]> {
  const url = `${API_BASE}?_from=${from}&_to=${to}`;
  const res = await fetch(url, {
    headers: {
      "user-agent": UA,
      accept: "application/json",
      "accept-language": "en-IE,en;q=0.9"
    }
  });
  // VTEX returns 206 Partial Content for paginated responses — treat as ok.
  if (!res.ok && res.status !== 206) {
    throw new Error(`VTEX API ${res.status} ${res.statusText} (page ${from}-${to})`);
  }
  const data = (await res.json()) as VtexProduct[];
  return Array.isArray(data) ? data : [];
}

function toDealItem(p: VtexProduct): DealItem | null {
  const item = p.items?.[0];
  if (!item) return null;

  let bestPrice: number | null = null;
  let bestAvailable = false;
  for (const seller of item.sellers ?? []) {
    const offer = seller.commertialOffer;
    if (!offer || typeof offer.Price !== "number" || offer.Price <= 0) continue;
    const available = offer.IsAvailable !== false && (offer.AvailableQuantity ?? 1) > 0;
    if (bestPrice == null || offer.Price < bestPrice) {
      bestPrice = offer.Price;
      bestAvailable = available;
    }
  }
  if (bestPrice == null || !bestAvailable) return null;

  const slug = p.linkText ?? p.link?.split("/").filter(Boolean).pop() ?? p.productId;
  return {
    id: p.productId,
    name: p.productName,
    price: bestPrice,
    currency: CURRENCY,
    url: `${ORIGIN}/${slug}/p`,
    imageUrl: item.images?.[0]?.imageUrl ?? null
  };
}

async function main(): Promise<void> {
  console.log(`Scraping ${SOURCE_URL} via VTEX catalog API`);
  const items: DealItem[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < PAGE_CAP; i++) {
    const from = i * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const page = await fetchPage(from, to);
    if (page.length === 0) break;
    for (const product of page) {
      const deal = toDealItem(product);
      if (!deal || seen.has(deal.id)) continue;
      seen.add(deal.id);
      items.push(deal);
    }
    console.log(`  page ${i + 1}: ${page.length} products (running total ${items.length})`);
    if (page.length < PAGE_SIZE) break;
  }

  const cheap = items
    .filter((i) => i.price > 0 && i.price < THRESHOLD)
    .sort((a, b) => a.price - b.price);

  console.log(`Parsed ${items.length} products, ${cheap.length} under €${THRESHOLD}`);

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
