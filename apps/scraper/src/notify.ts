import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { DealItem, DealsSnapshot } from "@repo/types";

const ITEMS_PATH = resolve(process.cwd(), "../../data/items.json");
const WATCH_PATH = resolve(process.cwd(), "../../data/watch.json");
const ISSUE_LABEL = "dunnes-alert";

interface Watch {
  name: string;
  include?: string[];
  exclude?: string[];
  ids?: string[];
  maxPrice?: number;
}

interface WatchFile {
  watches: Watch[];
}

function loadPreviousItems(): DealItem[] {
  try {
    const raw = execFileSync("git", ["show", "HEAD:data/items.json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    if (!raw) return [];
    return (JSON.parse(raw) as DealsSnapshot).items ?? [];
  } catch {
    return [];
  }
}

function matchesWatch(item: DealItem, watch: Watch): boolean {
  if (watch.ids && watch.ids.length > 0) {
    if (!watch.ids.includes(item.id)) return false;
  } else {
    const name = item.name.toLowerCase();
    const include = (watch.include ?? []).map((s) => s.toLowerCase());
    if (include.length === 0) return false;
    if (!include.some((kw) => name.includes(kw))) return false;
    const exclude = (watch.exclude ?? []).map((s) => s.toLowerCase());
    if (exclude.some((kw) => name.includes(kw))) return false;
  }
  if (typeof watch.maxPrice === "number" && item.price > watch.maxPrice) return false;
  return true;
}

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
    body: JSON.stringify({ name: ISSUE_LABEL, color: "fbca04", description: "Dunnes monitor match" })
  });
}

async function createIssue(
  ctx: GitHubContext,
  title: string,
  body: string,
  assignees: string[]
): Promise<void> {
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
}

function renderBody(
  groups: Map<string, DealItem[]>,
  fetchedAt: string,
  mention: string
): string {
  const lines: string[] = [];
  lines.push(`Hey @${mention} — new under-€10 matches for your watches:`);
  lines.push("");
  for (const [watchName, items] of groups) {
    lines.push(`### ${watchName} (${items.length})`);
    lines.push("");
    for (const it of items) {
      lines.push(`- **[${it.name}](${it.url})** — €${it.price}`);
      if (it.imageUrl) lines.push(`  <br><img src="${it.imageUrl}" width="160">`);
    }
    lines.push("");
  }
  lines.push(`_Snapshot ${fetchedAt}_`);
  return lines.join("\n");
}

async function main(): Promise<void> {
  const watchFile = JSON.parse(await readFile(WATCH_PATH, "utf8")) as WatchFile;
  const snapshot = JSON.parse(await readFile(ITEMS_PATH, "utf8")) as DealsSnapshot;
  const previousItems = loadPreviousItems();
  const previousIds = new Set(previousItems.map((i) => i.id));

  const newItems = snapshot.items.filter((i) => !previousIds.has(i.id));
  console.log(`${newItems.length} item(s) appeared since last snapshot`);

  // group new matches by watch name; an item can match multiple watches
  const groups = new Map<string, DealItem[]>();
  for (const watch of watchFile.watches) {
    const matched = newItems.filter((i) => matchesWatch(i, watch));
    if (matched.length > 0) groups.set(watch.name, matched);
  }

  const totalMatches = [...groups.values()].reduce((n, list) => n + list.length, 0);
  if (totalMatches === 0) {
    console.log("No watch matches; nothing to notify.");
    return;
  }

  const ctx = ghContext();
  if (!ctx) {
    console.log(`Dry run — would file 1 issue with ${totalMatches} match(es):`);
    for (const [name, items] of groups) {
      console.log(`  ${name}: ${items.map((i) => `${i.name} (€${i.price})`).join(", ")}`);
    }
    return;
  }

  await ensureLabel(ctx);
  const date = new Date(snapshot.fetchedAt).toISOString().replace("T", " ").slice(0, 16);
  const title = `${totalMatches} new under-€10 match${totalMatches === 1 ? "" : "es"} — ${date}`;
  const body = renderBody(groups, snapshot.fetchedAt, ctx.owner);
  await createIssue(ctx, title, body, [ctx.owner]);
  console.log(`Filed issue: ${title}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
