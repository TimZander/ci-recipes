// Posts or updates the one preview comment on a pull request.
//
// Pure parts (previewBody, findOwnComment) are exported for tests/; main() runs only when
// this file is executed. Node stdlib only: the action runs it with the runner's own node.
//
// Reads: GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_API_URL, PR_NUMBER, HEAD_SHA,
//        DEPLOYMENT_URL, ALIAS_URL, NOTE, GITHUB_STEP_SUMMARY, and STATUS ("unconfirmed" posts
//        unconfirmedBody instead, after a failed verify).
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const MARKER = "<!-- cf-preview-deploy -->";
export const BOT = "github-actions[bot]";

/** The comment body. The stable link is shown only when Cloudflare returned one: a
 *  per-commit URL labelled "stable" goes stale on the next push (garmin-map learned this). */
export function previewBody({ deploymentUrl, aliasUrl, sha, note }) {
  if (!deploymentUrl) throw new Error("previewBody: deploymentUrl is required");
  const lines = [MARKER, `**Preview ready** for ${sha ? sha.slice(0, 7) : "this commit"}.`, ""];
  if (aliasUrl && aliasUrl !== deploymentUrl) {
    lines.push(`Stable link (always this PR's latest build; bookmark it): ${aliasUrl}`, "");
  }
  lines.push(`This commit: ${deploymentUrl}`);
  if (note && note.trim()) lines.push("", `_${note.trim()}_`);
  return lines.join("\n") + "\n";
}

/** The comment when this commit's deployment wasn't confirmed live (decision 0011). It
 *  replaces an earlier push's "Preview ready", which would otherwise still read as current;
 *  it links nothing, since nothing for this commit is known to load. */
export function unconfirmedBody({ sha }) {
  const at = sha ? sha.slice(0, 7) : "this commit";
  return [MARKER, `**Preview not confirmed** for ${at}: Cloudflare didn't report its deployment live.`,
    "", "Re-run the preview job; until it passes, no preview link here is for this commit."].join("\n") + "\n";
}

/** Our own comment only: written by the Actions bot AND starting with the marker. A comment
 *  that merely quotes the marker (a spec diff, a review) must never be overwritten. */
export function findOwnComment(comments) {
  return comments.find(
    (c) => c?.user?.login === BOT && typeof c.body === "string" && c.body.startsWith(MARKER),
  );
}

async function gh(method, path, body) {
  const base = process.env.GITHUB_API_URL || "https://api.github.com";
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

/** Every page of a PR's comments: a long review thread pushes ours past page one. */
async function allComments(repo, pr) {
  const out = [];
  for (let page = 1; page <= 50; page++) {
    const batch = await gh("GET", `/repos/${repo}/issues/${pr}/comments?per_page=100&page=${page}`);
    out.push(...batch);
    if (batch.length < 100) return out;
  }
  throw new Error("more than 5000 comments; refusing to guess which one is ours");
}

async function main() {
  const e = process.env;
  const unconfirmed = e.STATUS === "unconfirmed";
  for (const k of ["GITHUB_TOKEN", "GITHUB_REPOSITORY", "PR_NUMBER", ...(unconfirmed ? [] : ["DEPLOYMENT_URL"])]) {
    if (!e[k]) throw new Error(`${k} is empty or unset`);
  }
  const body = unconfirmed ? unconfirmedBody({ sha: e.HEAD_SHA }) : previewBody({
    deploymentUrl: e.DEPLOYMENT_URL, aliasUrl: e.ALIAS_URL, sha: e.HEAD_SHA, note: e.NOTE,
  });
  if (e.GITHUB_STEP_SUMMARY) appendFileSync(e.GITHUB_STEP_SUMMARY, body.replace(MARKER + "\n", ""));
  const existing = findOwnComment(await allComments(e.GITHUB_REPOSITORY, e.PR_NUMBER));
  if (existing) {
    await gh("PATCH", `/repos/${e.GITHUB_REPOSITORY}/issues/comments/${existing.id}`, { body });
    console.log(`updated comment ${existing.id}`);
  } else {
    const made = await gh("POST", `/repos/${e.GITHUB_REPOSITORY}/issues/${e.PR_NUMBER}/comments`, { body });
    console.log(`created comment ${made.id}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`pages-preview comment: ${err.message}`);
    process.exit(1);
  });
}
