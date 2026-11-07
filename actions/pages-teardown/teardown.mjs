// Deletes Cloudflare Pages preview deployments that no open pull request claims.
//
//   MODE=pr PR_NUMBER=<n>  a closed pull request's pr-<n> previews, then marks its comment
//   MODE=branch BRANCH=<b> a deleted preview/** branch's pv-<hash> previews
//   MODE=sweep             every preview no open pull request and no preview/** branch claims
//
// Ported from painting's scripts/preview-teardown.sh, the most careful of the four copies:
// every page is listed before anything is deleted (deleting while paging shifts pages and
// skips deployments), no per_page is sent (the API rejects values over 25), ids must look
// like Cloudflare's before they go in a URL, and only environment "preview" is ever
// deleted, never the production branch, whatever it is named.
//
// Pure parts are exported for tests/; main() runs only when this file is executed.
// Reads: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, PROJECT_NAME, MODE, PR_NUMBER, BRANCH,
//        GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_API_URL, and CLOUDFLARE_API_URL (tests only).
import { pathToFileURL } from "node:url";
import { MARKER, findOwnComment } from "../pages-preview/comment.mjs";
import { previewAlias, isPreviewBranch, PREVIEW_PREFIX } from "../pages-branch-preview/alias.mjs";

const ID = /^[0-9a-f][0-9a-f-]{7,63}$/;
const MAX_PAGES = 100;

export function isDeploymentId(id) {
  return typeof id === "string" && ID.test(id);
}

export function branchOf(d) {
  const b = d?.deployment_trigger?.metadata?.branch;
  return typeof b === "string" ? b : "";
}

/**
 * Which deployments to delete, each id once, in listing order.
 *  - Only environment "preview", and never the production branch: two guards, so renaming
 *    the production branch cannot make production a target.
 *  - pr mode: exactly pr-<n>.
 *  - branch mode: exactly the deleted preview branch's pv-<hash>.
 *  - sweep: any preview whose branch is not claimed by an open PR, either as pr-<n> or as
 *    that PR's head branch (repos that deployed under head branches before adopting pr-<n>
 *    keep their open PRs' previews), nor by a preview/** branch that still exists, as its
 *    pv-<hash>. A missing branch is kept: deleting on missing metadata would be guessing.
 */
export function selectTargets({ deployments, mode, prNumber, branch, openPrs = [], previewBranches = [], productionBranch }) {
  if (!productionBranch) throw new Error("selectTargets: productionBranch is required");
  for (const d of deployments) {
    if (!isDeploymentId(d?.id)) throw new Error(`unexpected deployment id: ${JSON.stringify(d?.id)}`);
  }
  let keep;
  if (mode === "pr") {
    if (!/^[1-9][0-9]*$/.test(String(prNumber))) throw new Error("pr mode needs a PR number");
    const mine = `pr-${prNumber}`;
    keep = (b) => b !== mine;
  } else if (mode === "branch") {
    const mine = previewAlias(branch);
    keep = (b) => b !== mine;
  } else if (mode === "sweep") {
    const claimed = new Set(openPrs.flatMap((p) => [`pr-${p.number}`, p.headRef].filter(Boolean)));
    for (const b of previewBranches) if (isPreviewBranch(b)) claimed.add(previewAlias(b));
    keep = (b) => b === "" || claimed.has(b);
  } else {
    throw new Error(`unknown mode: ${mode}`);
  }
  const seen = new Set();
  const out = [];
  for (const d of deployments) {
    const b = branchOf(d);
    if (d.environment !== "preview" || b === productionBranch || keep(b) || seen.has(d.id)) continue;
    seen.add(d.id);
    out.push({ id: d.id, branch: b });
  }
  return out;
}

export const REMOVED_BODY = `${MARKER}\nPreview removed: this pull request was closed.\n`;

// ---------------------------------------------------------------- I/O below

async function http(url, { method = "GET", token, body } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* reported below */ }
  return { status: res.status, ok: res.ok, json, text };
}

async function main() {
  const e = process.env;
  for (const k of ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "PROJECT_NAME", "MODE",
    "GITHUB_TOKEN", "GITHUB_REPOSITORY"]) {
    if (!e[k]) throw new Error(`${k} is empty or unset`);
  }
  const cfApi = e.CLOUDFLARE_API_URL || "https://api.cloudflare.com/client/v4";
  const cf = `${cfApi}/accounts/${e.CLOUDFLARE_ACCOUNT_ID}/pages/projects/${encodeURIComponent(e.PROJECT_NAME)}`;
  const ghBase = (e.GITHUB_API_URL || "https://api.github.com") + `/repos/${e.GITHUB_REPOSITORY}`;
  const cfGet = (u) => http(u, { token: e.CLOUDFLARE_API_TOKEN });
  const ghCall = (path, opts = {}) => http(ghBase + path, { token: e.GITHUB_TOKEN, ...opts });

  const project = await cfGet(cf);
  const productionBranch = project.json?.result?.production_branch;
  if (!project.json?.success || !productionBranch) {
    throw new Error(`reading project ${e.PROJECT_NAME} failed: ${project.text.slice(0, 500)}`);
  }

  const deployments = [];
  let complete = false;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = await cfGet(`${cf}/deployments?page=${page}`);
    if (!r.json?.success || !Array.isArray(r.json.result)) {
      throw new Error(`listing page ${page} failed: ${JSON.stringify(r.json?.errors ?? r.text.slice(0, 500))}`);
    }
    if (r.json.result.length === 0) { complete = true; break; }
    deployments.push(...r.json.result);
  }
  if (!complete) throw new Error(`no empty page after ${MAX_PAGES} pages; deployments may remain`);

  let openPrs = [];
  const previewBranches = [];
  if (e.MODE === "branch") {
    // GitHub's startsWith() ignores case, so the job's if: lets Preview/x through: not ours.
    if (!e.BRANCH) throw new Error("branch mode needs BRANCH");
    if (!isPreviewBranch(e.BRANCH)) { console.log(`${e.BRANCH} is not a preview branch: nothing to delete`); return; }
    // A branch pushed again since its delete keeps its preview.
    const ref = e.BRANCH.split("/").map(encodeURIComponent).join("/");
    const r = await ghCall(`/git/ref/heads/${ref}`);
    if (r.ok) { console.log(`${e.BRANCH} exists again: nothing deleted`); return; }
    if (r.status !== 404) throw new Error(`reading branch ${e.BRANCH} failed: HTTP ${r.status}`);
  } else if (e.MODE === "pr") {
    // A pull request reopened since its close keeps its preview.
    const pr = await ghCall(`/pulls/${e.PR_NUMBER}`);
    if (!pr.ok) throw new Error(`reading pull request ${e.PR_NUMBER} failed: HTTP ${pr.status}`);
    if (pr.json.state === "open") { console.log(`pull request ${e.PR_NUMBER} is open again: nothing deleted`); return; }
    if (pr.json.state !== "closed") throw new Error(`unexpected pull request state: ${pr.json.state}`);
  } else {
    // Listed after the deployments, so a deployment in the list belongs to a PR that was
    // already open; if it is no longer open, it has closed.
    for (let page = 1; page <= 50; page++) {
      const r = await ghCall(`/pulls?state=open&per_page=100&page=${page}`);
      if (!r.ok) throw new Error(`listing open pull requests failed: HTTP ${r.status}`);
      openPrs.push(...r.json.map((p) => ({ number: p.number, headRef: p.head?.ref })));
      if (r.json.length < 100) break;
    }
    // The preview branches that still exist keep their previews. No match is an empty list;
    // anything but a list stops the sweep before a delete, since treating it as empty would
    // delete every live branch preview. The endpoint may ignore paging and answer the whole
    // list each time, so a page that adds nothing new ends it.
    const seenRefs = new Set();
    for (let page = 1; page <= 50; page++) {
      const r = await ghCall(`/git/matching-refs/heads/${PREVIEW_PREFIX}?per_page=100&page=${page}`);
      if (!r.ok || !Array.isArray(r.json)) throw new Error(`listing preview branches failed: HTTP ${r.status}`);
      const before = seenRefs.size;
      for (const x of r.json) seenRefs.add(String(x.ref).replace(/^refs\/heads\//, ""));
      if (r.json.length < 100 || seenRefs.size === before) break;
    }
    previewBranches.push(...seenRefs);
  }

  const targets = selectTargets({
    deployments, mode: e.MODE, prNumber: e.PR_NUMBER, branch: e.BRANCH, openPrs, previewBranches, productionBranch,
  });
  let deleted = 0, failed = 0;
  for (const t of targets) {
    const r = await http(`${cf}/deployments/${t.id}?force=true`, { method: "DELETE", token: e.CLOUDFLARE_API_TOKEN })
      .catch((err) => ({ status: 0, json: null, text: String(err) }));
    // 404: another teardown or the sweep got there first; it is gone all the same.
    if (r.status === 404 || r.json?.success === true) {
      console.log(`deleted ${t.id} (${t.branch})`); deleted++;
    } else {
      console.error(`failed ${t.id} (${t.branch}): HTTP ${r.status} ${JSON.stringify(r.json?.errors ?? r.text.slice(0, 300))}`);
      failed++;
    }
  }
  console.log(`deleted ${deleted}, failed ${failed}, listed ${deployments.length}`);
  if (failed > 0) process.exit(1);

  // Only after every delete succeeded: the preview comment says the preview is gone.
  if (e.MODE === "pr") {
    const comments = [];
    for (let page = 1; page <= 50; page++) {
      const r = await ghCall(`/issues/${e.PR_NUMBER}/comments?per_page=100&page=${page}`);
      if (!r.ok) throw new Error(`listing comments failed: HTTP ${r.status}`);
      comments.push(...r.json);
      if (r.json.length < 100) break;
    }
    const mine = findOwnComment(comments);
    if (mine) {
      const r = await ghCall(`/issues/comments/${mine.id}`, { method: "PATCH", body: { body: REMOVED_BODY } });
      if (!r.ok) throw new Error(`editing comment ${mine.id} failed: HTTP ${r.status}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`pages-teardown: ${err.message}`);
    process.exit(1);
  });
}
