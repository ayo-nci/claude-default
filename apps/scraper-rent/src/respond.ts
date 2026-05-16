import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { RentListing, RentSnapshot } from "@repo/types";

const LISTINGS_PATH = resolve(process.cwd(), "../../data/rent/listings.json");

interface GitHubContext {
  token: string;
  owner: string;
  repo: string;
}

function ghContext(): GitHubContext {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const slug = process.env.GITHUB_REPOSITORY;
  if (!token) throw new Error("GH_TOKEN / GITHUB_TOKEN missing");
  if (!slug) throw new Error("GITHUB_REPOSITORY missing");
  const [owner, repo] = slug.split("/");
  if (!owner || !repo) throw new Error("GITHUB_REPOSITORY malformed");
  return { token, owner, repo };
}

interface IssueRef {
  number: number;
  body: string;
  title: string;
}

async function getIssue(ctx: GitHubContext, number: number): Promise<IssueRef> {
  const res = await fetch(
    `https://api.github.com/repos/${ctx.owner}/${ctx.repo}/issues/${number}`,
    { headers: { authorization: `Bearer ${ctx.token}`, accept: "application/vnd.github+json" } }
  );
  if (!res.ok) throw new Error(`Fetch issue #${number}: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { number: number; body: string | null; title: string };
  return { number: data.number, body: data.body ?? "", title: data.title };
}

async function comment(ctx: GitHubContext, number: number, body: string): Promise<void> {
  const res = await fetch(
    `https://api.github.com/repos/${ctx.owner}/${ctx.repo}/issues/${number}/comments`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${ctx.token}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json"
      },
      body: JSON.stringify({ body })
    }
  );
  if (!res.ok) throw new Error(`Comment failed: ${res.status} ${await res.text()}`);
}

function extractListingIds(text: string): string[] {
  const ids = new Set<string>();
  for (const m of text.matchAll(/<!--\s*listing-id:\s*(\d+)\s*-->/g)) {
    if (m[1]) ids.add(m[1]);
  }
  if (ids.size === 0) {
    for (const m of text.matchAll(/\/rooms-to-rent\/[^/]+\/(\d{4,})/g)) {
      if (m[1]) ids.add(m[1]);
    }
  }
  return [...ids];
}

function parseSendCommand(body: string): string | null {
  const m = body.trim().match(/^\/send(?:\s+(\d+))?/i);
  if (!m) return null;
  return m[1] ?? "";
}

function buildMessage(listing: RentListing): string {
  const name = process.env.APPLICANT_NAME?.trim() || "[your name]";
  const email = process.env.APPLICANT_EMAIL?.trim() || "[your email]";
  const phone = process.env.APPLICANT_PHONE?.trim() || "[your phone]";
  const bio = process.env.APPLICANT_BIO?.trim() || "[short bio]";

  const greeting = listing.agent ? `Hi ${listing.agent.split(/[\s,]/)[0]},` : "Hi,";
  const where = listing.area ? ` at ${listing.area}` : "";

  return [
    greeting,
    "",
    `I'd like to apply for the ensuite room${where} (${listing.url}).`,
    "",
    bio,
    "",
    `Best contact: ${email}${phone ? ` / ${phone}` : ""}.`,
    "",
    "Happy to view at your convenience — let me know what works.",
    "",
    "Thanks,",
    name
  ].join("\n");
}

async function main(): Promise<void> {
  const issueNumberStr = process.env.ISSUE_NUMBER;
  const commentBody = process.env.COMMENT_BODY ?? "";
  if (!issueNumberStr) throw new Error("ISSUE_NUMBER env var required");
  const issueNumber = Number(issueNumberStr);

  const ctx = ghContext();
  const issue = await getIssue(ctx, issueNumber);

  const issueIds = extractListingIds(`${issue.body}\n${issue.title}`);
  if (issueIds.length === 0) {
    await comment(ctx, issueNumber, "⚠️ Couldn't find any listing IDs in this issue.");
    return;
  }

  const cmdArg = parseSendCommand(commentBody);
  let listingId: string;
  if (cmdArg && cmdArg.length > 0) {
    if (!issueIds.includes(cmdArg)) {
      await comment(
        ctx,
        issueNumber,
        `⚠️ Listing \`${cmdArg}\` isn't in this issue. Pick one of: ${issueIds.map((id) => `\`${id}\``).join(", ")}.`
      );
      return;
    }
    listingId = cmdArg;
  } else if (issueIds.length === 1) {
    listingId = issueIds[0]!;
  } else {
    await comment(
      ctx,
      issueNumber,
      `⚠️ This issue has ${issueIds.length} listings — reply \`/send <listing-id>\`. Options: ${issueIds.map((id) => `\`${id}\``).join(", ")}.`
    );
    return;
  }

  const snapshot = JSON.parse(await readFile(LISTINGS_PATH, "utf8")) as RentSnapshot;
  const listing = snapshot.listings.find((l) => l.id === listingId);
  if (!listing) {
    await comment(
      ctx,
      issueNumber,
      `⚠️ Listing \`${listingId}\` no longer in the snapshot — it may have been removed.`
    );
    return;
  }

  const message = buildMessage(listing);
  const body = [
    `📝 **Application draft for ${listing.title}**`,
    "",
    "Copy the message below into the listing's enquiry form:",
    "",
    "```text",
    message,
    "```",
    "",
    `👉 [Open the listing & enquiry form](${listing.url})`,
    listing.agentPhone ? `📞 Or call directly: ${listing.agentPhone}` : ""
  ]
    .filter(Boolean)
    .join("\n");

  await comment(ctx, issueNumber, body);
  console.log(`Posted application draft for listing ${listingId} on issue #${issueNumber}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
