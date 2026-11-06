// Runs comment.mjs and teardown.mjs as the actions run them (a child `node` process, env
// only) against one local fake of the GitHub and Cloudflare APIs. Covers the I/O the unit
// tests cannot: pagination, the PATCH-vs-POST choice, list-all-before-delete, exit codes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { MARKER, BOT } from "../actions/pages-preview/comment.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const REPO = "o/r";
const ACCOUNT = "acct";
const PROJECT = "proj";

/** A fake API. `state` is mutated by requests; `log` records method + path. */
function fakeApi(state) {
  const log = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const url = new URL(req.url, "http://x");
      const path = url.pathname;
      const page = Number(url.searchParams.get("page") || 1);
      log.push(`${req.method} ${path}${url.search}`);
      const send = (status, body) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      const per = 100;
      const paged = (arr) => arr.slice((page - 1) * per, page * per);
      // GitHub
      if (req.method === "GET" && path === `/repos/${REPO}/issues/7/comments`) return send(200, paged(state.comments));
      if (req.method === "POST" && path === `/repos/${REPO}/issues/7/comments`) {
        const c = { id: 9000 + state.comments.length, user: { login: BOT }, body: JSON.parse(raw).body };
        state.comments.push(c);
        return send(201, c);
      }
      const m = path.match(new RegExp(`^/repos/${REPO}/issues/comments/(\\d+)$`));
      if (req.method === "PATCH" && m) {
        const c = state.comments.find((x) => x.id === Number(m[1]));
        c.body = JSON.parse(raw).body;
        return send(200, c);
      }
      if (req.method === "GET" && path === `/repos/${REPO}/pulls/7`) return send(200, { state: state.prState });
      if (req.method === "GET" && path === `/repos/${REPO}/pulls`) return send(200, paged(state.openPrs));
      // Cloudflare: pages of 25, like the real API; an empty page ends the list
      const cf = `/accounts/${ACCOUNT}/pages/projects/${PROJECT}`;
      if (req.method === "GET" && path === cf) return send(200, { success: true, result: { production_branch: "main" } });
      if (req.method === "GET" && path === `${cf}/deployments`) {
        return send(200, { success: true, result: state.deployments.slice((page - 1) * 25, page * 25) });
      }
      const d = path.match(new RegExp(`^${cf}/deployments/([^/]+)$`));
      if (req.method === "DELETE" && d) {
        if (state.failDelete === d[1]) return send(500, { success: false, errors: [{ message: "boom" }] });
        state.deployments = state.deployments.filter((x) => x.id !== d[1]);
        return send(200, { success: true });
      }
      send(404, { message: "not found" });
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    const base = `http://127.0.0.1:${server.address().port}`;
    resolve({ base, log, close: () => new Promise((r) => server.close(r)) });
  }));
}

function run(script, env) {
  return new Promise((resolve) => {
    execFile(process.execPath, [script], { cwd: root, env: { PATH: process.env.PATH, ...env } },
      (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
  });
}

const comment = (env) => run("actions/pages-preview/comment.mjs", {
  GITHUB_TOKEN: "t", GITHUB_REPOSITORY: REPO, PR_NUMBER: "7", HEAD_SHA: "abcdef0123",
  DEPLOYMENT_URL: "https://abc.proj.pages.dev", ALIAS_URL: "https://pr-7.proj.pages.dev", ...env,
});

test("comment: creates one comment, then updates it on later pushes", async () => {
  const state = { comments: [] };
  const api = await fakeApi(state);
  try {
    assert.equal((await comment({ GITHUB_API_URL: api.base })).code, 0);
    assert.equal((await comment({ GITHUB_API_URL: api.base, DEPLOYMENT_URL: "https://def.proj.pages.dev" })).code, 0);
    assert.equal(state.comments.length, 1);
    assert.match(state.comments[0].body, /https:\/\/def\.proj/);
  } finally { await api.close(); }
});

test("comment: finds ours past the first page of comments", async () => {
  const noise = Array.from({ length: 150 }, (_, i) => ({ id: i + 1, user: { login: "someone" }, body: "hi" }));
  const ours = { id: 500, user: { login: BOT }, body: `${MARKER}\nold` };
  const state = { comments: [...noise, ours] };
  const api = await fakeApi(state);
  try {
    assert.equal((await comment({ GITHUB_API_URL: api.base })).code, 0);
    assert.equal(state.comments.length, 151, "no second comment");
    assert.match(ours.body, /Preview ready/);
  } finally { await api.close(); }
});

test("comment: missing inputs exit non-zero", async () => {
  const r = await comment({ GITHUB_API_URL: "http://127.0.0.1:9", DEPLOYMENT_URL: "" });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /DEPLOYMENT_URL/);
});

let k = 0;
const dep = (branch, environment = "preview") =>
  ({ id: `${String(++k).padStart(8, "0")}-aaaa-bbbb-cccc-dddddddddddd`, environment, deployment_trigger: { metadata: { branch } } });

const teardown = (api, env) => run("actions/pages-teardown/teardown.mjs", {
  GITHUB_TOKEN: "t", GITHUB_REPOSITORY: REPO, GITHUB_API_URL: api.base, CLOUDFLARE_API_URL: api.base,
  CLOUDFLARE_API_TOKEN: "c", CLOUDFLARE_ACCOUNT_ID: ACCOUNT, PROJECT_NAME: PROJECT, ...env,
});

test("teardown pr: lists every page first, deletes pr-7 only, marks the comment", async () => {
  // 60 deployments over three pages, pr-7's on the last, so deleting while paging would miss them.
  const others = Array.from({ length: 58 }, (_, i) => dep(i % 2 ? `pr-${100 + i}` : "main", i % 2 ? "preview" : "production"));
  const state = {
    prState: "closed",
    deployments: [...others, dep("pr-7"), dep("pr-7")],
    comments: [{ id: 1, user: { login: BOT }, body: `${MARKER}\nPreview ready` }],
  };
  const api = await fakeApi(state);
  try {
    const r = await teardown(api, { MODE: "pr", PR_NUMBER: "7" });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(state.deployments.filter((d) => d.deployment_trigger.metadata.branch === "pr-7").length, 0);
    assert.equal(state.deployments.length, 58);
    const firstDelete = api.log.findIndex((l) => l.startsWith("DELETE"));
    const lastList = api.log.findLastIndex((l) => l.includes("/deployments?"));
    assert.ok(lastList < firstDelete, "every page listed before the first delete");
    assert.match(state.comments[0].body, /Preview removed/);
  } finally { await api.close(); }
});

test("teardown pr: a reopened PR keeps its preview", async () => {
  const state = { prState: "open", deployments: [dep("pr-7")], comments: [] };
  const api = await fakeApi(state);
  try {
    assert.equal((await teardown(api, { MODE: "pr", PR_NUMBER: "7" })).code, 0);
    assert.equal(state.deployments.length, 1);
  } finally { await api.close(); }
});

test("teardown sweep: removes unclaimed previews, keeps open PRs and production", async () => {
  const state = {
    deployments: [dep("pr-1"), dep("pr-2"), dep("old-head"), dep("stray"), dep("main", "production")],
    openPrs: [{ number: 1, head: { ref: "x" } }, { number: 5, head: { ref: "old-head" } }],
    comments: [],
  };
  const api = await fakeApi(state);
  try {
    const r = await teardown(api, { MODE: "sweep" });
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(state.deployments.map((d) => d.deployment_trigger.metadata.branch).sort(), ["main", "old-head", "pr-1"]);
  } finally { await api.close(); }
});

test("teardown: a failed delete exits non-zero and leaves the comment alone", async () => {
  const target = dep("pr-7");
  const state = { prState: "closed", deployments: [target], failDelete: target.id,
    comments: [{ id: 1, user: { login: BOT }, body: `${MARKER}\nPreview ready` }] };
  const api = await fakeApi(state);
  try {
    const r = await teardown(api, { MODE: "pr", PR_NUMBER: "7" });
    assert.notEqual(r.code, 0);
    assert.match(state.comments[0].body, /Preview ready/);
  } finally { await api.close(); }
});
