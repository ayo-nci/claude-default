import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { DealItem, DealsSnapshot } from "@repo/types";

const ITEMS_PATH = resolve(process.cwd(), "../../data/items.json");
const WATCH_PATH = resolve(process.cwd(), "../../data/watch.json");
const MAX_ISSUES_PER_RUN = 10;
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
    });
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
  repo: string;
}

function ghContext(): GitHubContext | null {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) return null;
  return { token, repo };
}

async function ensureLabel(ctx: GitHubContext): Promise<void> {
  const res = await fetch(
    `https://api.github.com/repos/${ctx.repo}/labels/${ISSUE_LABEL}`,
    { headers: { authorization: `Bearer ${ctx.token}`, accept: "application/vnd.github+json" } }
  );
  if (res.status === 200) return;
  await fetch(`https://api.github.com/repos/${ctx.repo}/labels`, {
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
  body: string
): Promise<void> {
  const res = await fetch(`https://api.github.com/repos/${ctx.repo}/issues`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${ctx.token}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json"
    },
    body: JSON.stringify({ title, body, labels: [ISSUE_LABEL] })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create issue: ${res.status} ${text}`);
  }
}

function issueBody(item: DealItem, watch: Watch, fetchedAt: string): string {
  return [
    `Matched watch: **${watch.name}**`,
    "",
    `**${item.name}** — €${item.price}`,
    `[View product](${item.url})`,
    item.imageUrl ? `\n![](${item.imageUrl})` : "",
    "",
    `_Snapshot ${fetchedAt}_`
  ].join("\n");
}

async function main(): Promise<void> {
  const watchFile = JSON.parse(await readFile(WATCH_PATH, "utf8")) as WatchFile;
  const snapshot = JSON.parse(await readFile(ITEMS_PATH, "utf8")) as DealsSnapshot;
  const previousItems = loadPreviousItems();
  const previousIds = new Set(previousItems.map((i) => i.id));

  const newItems = snapshot.items.filter((i) => !previousIds.has(i.id));
  console.log(`${newItems.length} item(s) appeared since last snapshot`);

  const alerts: Array<{ watch: Watch; item: DealItem }> = [];
  for (const watch of watchFile.watches) {
    for (const item of newItems) {
      if (matchesWatch(item, watch)) alerts.push({ watch, item });
    }
  }

  if (alerts.length === 0) {
    console.log("No watch matches; nothing to notify.");
    return;
  }

  const capped = alerts.slice(0, MAX_ISSUES_PER_RUN);
  console.log(`${alerts.length} match(es); creating ${capped.length} issue(s).`);

  const ctx = ghContext();
  if (!ctx) {
    console.log("No GitHub token / repo context — dry run, would create:");
    for (const a of capped) console.log(`  [${a.watch.name}] ${a.item.name} (€${a.item.price})`);
    return;
  }

  await ensureLabel(ctx);
  for (const { watch, item } of capped) {
    const title = `[${watch.name}] ${item.name} — €${item.price}`;
    await createIssue(ctx, title, issueBody(item, watch, snapshot.fetchedAt));
    console.log(`  filed: ${title}`);
  }
  if (alerts.length > capped.length) {
    console.log(`(suppressed ${alerts.length - capped.length} additional match(es) to avoid spam)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
