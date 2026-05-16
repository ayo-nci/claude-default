import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { RentListing, RentSnapshot } from "@repo/types";

const LISTINGS_PATH = resolve(process.cwd(), "../../data/rent/listings.json");
const ISSUE_LABEL = "rent-alert";

interface GitHubContext {
  token: string;
  owner: string;
  repo: string;
}

function ghContext(): GitHubContext | null {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const slug = process.env.GITHUB_REPOSITORY;
  if (!token || !slug) return null;
  const [owner, repo] = slug.split("/");
  if (!owner || !repo) return null;
  return { token, owner, repo };
}

function loadPreviousIds(): Set<string> {
  try {
    const raw = execFileSync("git", ["show", "HEAD:data/rent/listings.json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    if (!raw) return new Set();
    return new Set((JSON.parse(raw) as RentSnapshot).listings?.map((l) => l.id) ?? []);
  } catch {
    return new Set();
  }
}

async function ensureLabel(ctx: GitHubContext): Promise<void> {
  const res = await fetch(
    `https://api.github.com/repos/${ctx.owner}/${ctx.repo}/labels/${ISSUE_LABEL}`,
    { headers: { authorization: `Bearer ${ctx.token}`, accept: "application/vnd.github+json" } }
  );
  if (res.status === 200) return;
  await fetch(`https://api.github.com/repos/${ctx.owner}/${ctx.repo}/labels`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${ctx.token}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json"
    },
    body: JSON.stringify({ name: ISSUE_LABEL, color: "0e8a16", description: "rent.ie ensuite alert" })
  });
}

async function createIssue(
  ctx: GitHubContext,
  title: string,
  body: string,
  assignees: string[]
): Promise<number> {
  const res = await fetch(`https://api.github.com/repos/${ctx.owner}/${ctx.repo}/issues`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${ctx.token}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json"
    },
    body: JSON.stringify({ title, body, labels: [ISSUE_LABEL], assignees })
  });
  if (!res.ok) throw new Error(`Failed to create issue: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { number: number };
  return data.number;
}

function renderListing(listing: RentListing, index: number): string {
  const lines: string[] = [];
  lines.push(`### ${index}. ${listing.title}`);
  if (listing.area) lines.push(`📍 ${listing.area}`);
  if (listing.price) lines.push(`💶 ${listing.price}`);
  lines.push(`🔗 ${listing.url}`);
  if (listing.imageUrl) lines.push(`\n<img src="${listing.imageUrl}" width="320">\n`);
  if (listing.description) {
    lines.push("");
    lines.push(`> ${listing.description.slice(0, 600)}${listing.description.length > 600 ? "…" : ""}`);
  }
  lines.push("");
  lines.push(`💬 Reply \`/send ${listing.id}\` to draft an application for this one.`);
  lines.push(`<!-- listing-id: ${listing.id} -->`);
  return lines.join("\n");
}

function renderBody(listings: RentListing[], mention: string): string {
  const blocks = listings.map((l, i) => renderListing(l, i + 1)).join("\n\n---\n\n");
  return [
    `Hey @${mention} — ${listings.length} new ensuite listing${listings.length === 1 ? "" : "s"} on rent.ie:`,
    "",
    blocks,
    "",
    "---",
    "",
    listings.length === 1
      ? "Reply `/send` (or `/send " + listings[0]!.id + "`) to draft an application."
      : "Reply `/send <listing-id>` (e.g. `/send " + listings[0]!.id + "`) to draft an application for a specific listing."
  ].join("\n");
}

async function main(): Promise<void> {
  const snapshot = JSON.parse(await readFile(LISTINGS_PATH, "utf8")) as RentSnapshot;
  const previousIds = loadPreviousIds();
  const newListings = snapshot.listings.filter((l) => !previousIds.has(l.id));
  console.log(`${newListings.length} new ensuite listing(s)`);

  if (newListings.length === 0) {
    console.log("Nothing to notify.");
    return;
  }

  const ctx = ghContext();
  if (!ctx) {
    console.log(`Dry run — would file 1 issue with ${newListings.length} listing(s):`);
    for (const l of newListings) console.log(`  ${l.id} — ${l.title}`);
    return;
  }

  await ensureLabel(ctx);
  const date = new Date(snapshot.fetchedAt).toISOString().replace("T", " ").slice(0, 16);
  const title = `${newListings.length} new ensuite room${newListings.length === 1 ? "" : "s"} — ${date}`;
  const body = renderBody(newListings, ctx.owner);
  const num = await createIssue(ctx, title, body, [ctx.owner]);
  console.log(`Filed issue #${num}: ${title}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
