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
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create issue: ${res.status} ${text}`);
  }
  const data = (await res.json()) as { number: number };
  return data.number;
}

function renderBody(listing: RentListing, mention: string): string {
  const lines: string[] = [];
  lines.push(`Hey @${mention} — new ensuite listing on rent.ie:`);
  lines.push("");
  lines.push(`**${listing.title}**`);
  if (listing.area) lines.push(`📍 ${listing.area}`);
  if (listing.price) lines.push(`💶 ${listing.price}`);
  if (listing.agent) lines.push(`👤 ${listing.agent}`);
  if (listing.agentPhone) lines.push(`☎️ ${listing.agentPhone}`);
  lines.push("");
  lines.push(`🔗 ${listing.url}`);
  if (listing.imageUrl) lines.push(`\n![](${listing.imageUrl})`);
  if (listing.description) {
    lines.push("");
    lines.push(`> ${listing.description.slice(0, 800)}${listing.description.length > 800 ? "…" : ""}`);
  }
  lines.push("");
  lines.push(`<sub>Reply \`/send\` to generate a templated application message you can copy into the listing's enquiry form.</sub>`);
  lines.push("");
  lines.push(`<!-- listing-id: ${listing.id} -->`);
  return lines.join("\n");
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
    console.log("Dry run — would file these issues:");
    for (const l of newListings) console.log(`  ${l.id} — ${l.title}`);
    return;
  }

  await ensureLabel(ctx);
  for (const listing of newListings) {
    const title = `[rent] ${listing.title}${listing.price ? ` — ${listing.price}` : ""}`;
    const body = renderBody(listing, ctx.owner);
    const num = await createIssue(ctx, title, body, [ctx.owner]);
    console.log(`  filed #${num}: ${title}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
