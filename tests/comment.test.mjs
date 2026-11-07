import { test } from "node:test";
import assert from "node:assert/strict";
import { previewBody, findOwnComment, MARKER, BOT } from "../actions/pages-preview/comment.mjs";

const URL1 = "https://abc123.proj.pages.dev";
const ALIAS = "https://pr-7.proj.pages.dev";

test("the body starts with the marker, so teardown and re-runs can find it", () => {
  assert.ok(previewBody({ deploymentUrl: URL1 }).startsWith(MARKER + "\n"));
});

test("both links are shown when Cloudflare returns an alias", () => {
  const b = previewBody({ deploymentUrl: URL1, aliasUrl: ALIAS, sha: "0123456789abcdef" });
  assert.match(b, /Stable link .*https:\/\/pr-7\.proj\.pages\.dev/);
  assert.match(b, /This commit: https:\/\/abc123/);
  assert.match(b, /for 0123456\./);
});

test("no alias: no stable link, never the per-commit URL labelled stable", () => {
  for (const aliasUrl of [undefined, "", URL1]) {
    const b = previewBody({ deploymentUrl: URL1, aliasUrl });
    assert.doesNotMatch(b, /Stable link/);
    assert.match(b, /This commit:/);
  }
});

test("the note is optional and shown when given", () => {
  assert.doesNotMatch(previewBody({ deploymentUrl: URL1, note: "  " }), /_/);
  assert.match(previewBody({ deploymentUrl: URL1, note: "public maps only" }), /_public maps only_/);
});

test("a missing deployment URL is an error, not an empty comment", () => {
  assert.throws(() => previewBody({ deploymentUrl: "" }));
});

test("findOwnComment matches only the bot's comment that starts with the marker", () => {
  const quoted = { id: 1, user: { login: "TimZander" }, body: MARKER + " quoted in a review" };
  const botQuoting = { id: 2, user: { login: BOT }, body: `see ${MARKER}` };
  const ours = { id: 3, user: { login: BOT }, body: MARKER + "\nPreview ready" };
  const otherBot = { id: 4, user: { login: "dependabot[bot]" }, body: MARKER };
  assert.equal(findOwnComment([quoted, botQuoting, otherBot, ours])?.id, 3);
  assert.equal(findOwnComment([quoted, botQuoting, otherBot]), undefined);
  assert.equal(findOwnComment([{ id: 5, user: null, body: null }]), undefined);
});
