import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import * as cheerio from "cheerio";
import type { RentListing, RentSnapshot } from "@repo/types";

const ORIGIN = "https://www.rent.ie";
const SOURCE_URL = `${ORIGIN}/rooms-to-rent/renting_dublin/room-type_either/`;
const OUTPUT_PATH = resolve(process.cwd(), "../../data/rent/listings.json");
const PAGE_CAP = 10;
const ENSUITE_REGEX = /\b(en[\s-]?suite)\b/i;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "user-agent": UA,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-IE,en;q=0.9"
    }
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

function absoluteUrl(href: string | undefined): string | null {
  if (!href) return null;
  if (href.startsWith("http")) return href;
  if (href.startsWith("//")) return `https:${href}`;
  if (href.startsWith("/")) return `${ORIGIN}${href}`;
  return `${ORIGIN}/${href}`;
}

function extractListingId(url: string): string | null {
  const m = url.match(/\/(\d{4,})(?:\/|$)/);
  return m?.[1] ?? null;
}

interface CardSummary {
  id: string;
  url: string;
  title: string;
  price: string | null;
  area: string | null;
  imageUrl: string | null;
}

function parseListingCards(html: string): CardSummary[] {
  const $ = cheerio.load(html);
  const cards = new Map<string, CardSummary>();

  // Grab every anchor that links to a rooms-to-rent listing detail page.
  $('a[href*="/rooms-to-rent/"]').each((_, el) => {
    const href = $(el).attr("href");
    const url = absoluteUrl(href);
    if (!url) return;
    const id = extractListingId(url);
    if (!id) return;

    // Climb to the surrounding card container to harvest title/price/etc.
    const card = $(el)
      .closest("[class*='search'], [class*='result'], [class*='listing'], li, article, div")
      .first();

    const titleEl = card.find("h2, h3, .title, [class*='title']").first();
    const title = (titleEl.text() || $(el).attr("title") || $(el).text() || "").trim();
    if (!title) return;

    const priceText = card.find("[class*='price'], .price").first().text().trim() || null;
    const area = card.find("[class*='address'], .address, [class*='location']").first().text().trim() || null;
    const img = card.find("img").first();
    const imageUrl = absoluteUrl(img.attr("data-src") || img.attr("src") || undefined);

    if (!cards.has(id)) {
      cards.set(id, { id, url, title, price: priceText, area, imageUrl });
    }
  });

  return [...cards.values()];
}

function isEnsuite(text: string | null | undefined): boolean {
  if (!text) return false;
  return ENSUITE_REGEX.test(text);
}

interface DetailExtras {
  description: string | null;
  agent: string | null;
  agentPhone: string | null;
}

function parseDetailPage(html: string): DetailExtras {
  const $ = cheerio.load(html);

  const description =
    $('[class*="description"], [id*="description"], .property_description').first().text().trim() ||
    $("meta[name='description']").attr("content") ||
    null;

  const agent =
    $('[class*="agent"], [class*="advertiser"], [class*="landlord"]').first().text().trim() || null;

  const phoneMatch = html.match(/(?:tel:|telephone[^0-9+]*|phone[^0-9+]*)\+?(\d[\d\s-]{7,})/i);
  const agentPhone = phoneMatch?.[1] ? phoneMatch[1].replace(/\s+/g, " ").trim() : null;

  return {
    description: description ? description.replace(/\s+/g, " ").trim().slice(0, 1500) : null,
    agent: agent ? agent.replace(/\s+/g, " ").trim().slice(0, 200) : null,
    agentPhone
  };
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
  console.log(`Scraping ${SOURCE_URL}`);
  const previous = await loadPrevious();

  const seen = new Set<string>();
  const ensuiteCandidates: CardSummary[] = [];

  for (let page = 1; page <= PAGE_CAP; page++) {
    const url = page === 1 ? SOURCE_URL : `${SOURCE_URL}?page=${page}`;
    let html: string;
    try {
      html = await fetchHtml(url);
    } catch (err) {
      if (page === 1) throw err;
      console.log(`  page ${page}: ${(err as Error).message} — stopping pagination`);
      break;
    }
    const cards = parseListingCards(html);
    const fresh = cards.filter((c) => !seen.has(c.id));
    for (const c of fresh) seen.add(c.id);
    const ensuiteHere = fresh.filter((c) => isEnsuite(c.title));
    ensuiteCandidates.push(...ensuiteHere);
    console.log(
      `  page ${page}: ${cards.length} cards, ${fresh.length} new, ${ensuiteHere.length} ensuite by title`
    );
    if (fresh.length === 0) break;
  }

  const listings: RentListing[] = [];
  const now = new Date().toISOString();

  for (const card of ensuiteCandidates) {
    const prev = previous.get(card.id);
    if (prev) {
      // already known — keep existing detail, only update mutable fields
      listings.push({ ...prev, title: card.title, price: card.price, area: card.area, imageUrl: card.imageUrl });
      continue;
    }
    // newly-spotted ensuite listing → fetch detail page
    let extras: DetailExtras = { description: null, agent: null, agentPhone: null };
    try {
      const detailHtml = await fetchHtml(card.url);
      extras = parseDetailPage(detailHtml);
      // double-check ensuite is in description too (some titles use the word loosely)
      if (!isEnsuite(card.title) && !isEnsuite(extras.description)) continue;
    } catch (err) {
      console.log(`  detail fetch failed for ${card.id}: ${(err as Error).message}`);
    }
    listings.push({
      id: card.id,
      url: card.url,
      title: card.title,
      price: card.price,
      area: card.area,
      imageUrl: card.imageUrl,
      description: extras.description,
      agent: extras.agent,
      agentPhone: extras.agentPhone,
      firstSeenAt: now
    });
  }

  // Sort newest-first by firstSeenAt
  listings.sort((a, b) => (a.firstSeenAt < b.firstSeenAt ? 1 : -1));

  const snapshot: RentSnapshot = {
    fetchedAt: now,
    source: SOURCE_URL,
    listings
  };

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(snapshot, null, 2) + "\n");
  console.log(`Wrote ${OUTPUT_PATH} (${listings.length} ensuite listings)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
