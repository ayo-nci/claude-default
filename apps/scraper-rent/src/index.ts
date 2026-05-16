import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { XMLParser } from "fast-xml-parser";
import type { RentListing, RentSnapshot } from "@repo/types";

const RSS_URL = "https://rss.rent.ie/rooms-to-rent/renting_dublin/room-type_either/";
const SOURCE_URL = "https://www.rent.ie/rooms-to-rent/renting_dublin/room-type_either/";
const OUTPUT_PATH = resolve(process.cwd(), "../../data/rent/listings.json");
const ENSUITE_REGEX = /\b(en[\s-]?suite)\b/i;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

interface RssItem {
  title?: string;
  link?: string;
  description?: string;
  pubDate?: string;
  guid?: string | { "#text"?: string };
}

interface RssEnvelope {
  rss?: { channel?: { item?: RssItem | RssItem[] } };
}

async function fetchRss(): Promise<RssItem[]> {
  const res = await fetch(RSS_URL, {
    headers: {
      "user-agent": UA,
      accept: "application/rss+xml, application/xml, text/xml, */*;q=0.8",
      "accept-language": "en-IE,en;q=0.9"
    }
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${RSS_URL}`);
  const xml = await res.text();
  const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });
  const parsed = parser.parse(xml) as RssEnvelope;
  const raw = parsed.rss?.channel?.item;
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function extractListingId(url: string): string | null {
  const m = url.match(/\/(\d{4,})(?:\/|$)/);
  return m?.[1] ?? null;
}

function extractPrice(text: string): string | null {
  const m = text.match(/€\s?[\d,]+(?:\s*(?:per\s+month|per\s+week|monthly|pcm|pw))?/i);
  return m ? m[0].replace(/\s+/g, " ").trim() : null;
}

function extractArea(title: string): string | null {
  // titles look like "Single Bedroom, Glencairn, Sandyford, Dublin 18"
  const parts = title.split(",").map((p) => p.trim()).filter(Boolean);
  return parts.length >= 2 ? parts.slice(1).join(", ") : null;
}

function extractImage(description: string | undefined): string | null {
  if (!description) return null;
  const m = description.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m?.[1] ?? null;
}

function guidString(g: RssItem["guid"]): string | null {
  if (!g) return null;
  if (typeof g === "string") return g;
  return g["#text"] ?? null;
}

async function loadPrevious(): Promise<Map<string, RentListing>> {
  try {
    const raw = (await readFile(OUTPUT_PATH, "utf8")).trim();
    if (!raw) return new Map();
    const prev = JSON.parse(raw) as RentSnapshot;
    return new Map((prev.listings ?? []).map((l) => [l.id, l]));
  } catch {
    return new Map();
  }
}

async function main(): Promise<void> {
  console.log(`Fetching ${RSS_URL}`);
  const items = await fetchRss();
  console.log(`RSS returned ${items.length} item(s)`);

  const previous = await loadPrevious();
  const now = new Date().toISOString();

  const listings: RentListing[] = [];
  let ensuiteCount = 0;

  for (const item of items) {
    const title = item.title?.trim();
    const link = item.link?.trim();
    if (!title || !link) continue;

    const description = item.description ? stripHtml(item.description) : null;
    const combined = `${title} ${description ?? ""}`;
    if (!ENSUITE_REGEX.test(combined)) continue;
    ensuiteCount++;

    const id = extractListingId(link) ?? guidString(item.guid);
    if (!id) continue;

    const prev = previous.get(id);
    listings.push({
      id,
      url: link,
      title,
      price: extractPrice(combined),
      area: extractArea(title),
      imageUrl: extractImage(item.description),
      description: description ? description.slice(0, 1500) : null,
      agent: prev?.agent ?? null,
      agentPhone: prev?.agentPhone ?? null,
      firstSeenAt: prev?.firstSeenAt ?? now
    });
  }

  // Newest-first by firstSeenAt
  listings.sort((a, b) => (a.firstSeenAt < b.firstSeenAt ? 1 : -1));

  console.log(`${ensuiteCount} ensuite match(es) of ${items.length}; keeping ${listings.length}`);

  const snapshot: RentSnapshot = {
    fetchedAt: now,
    source: SOURCE_URL,
    listings
  };

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(snapshot, null, 2) + "\n");
  console.log(`Wrote ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
