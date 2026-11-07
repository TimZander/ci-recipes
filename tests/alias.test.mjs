// The branch preview's one name (STANDARD.md rule 2): pv-<12 hex of the branch's sha256>.
import { test } from "node:test";
import assert from "node:assert/strict";
import { previewAlias, isPreviewBranch, PREVIEW_PREFIX } from "../actions/pages-branch-preview/alias.mjs";

test("a preview branch gets pv- and 12 hex digits, the same every time", () => {
  const a = previewAlias("preview/1064-prototype");
  assert.match(a, /^pv-[0-9a-f]{12}$/);
  assert.equal(previewAlias("preview/1064-prototype"), a);
  // sha256("preview/1064-prototype"), first 12 hex digits: fixed, so the teardown and the
  // deploy can never disagree after a refactor
  assert.equal(a, "pv-e8878ef69ad3");
});

test("two long branches that share 28 characters get different names (garmin-map #164)", () => {
  const long = "preview/a-very-long-prototype-name-";
  assert.notEqual(previewAlias(long + "one"), previewAlias(long + "two"));
  assert.ok(previewAlias(long + "one").length <= 28);
});

test("only a preview/ branch has a name: main, a bare prefix and non-strings are refused", () => {
  for (const b of ["main", "preview/", "preview", "branches/4-x", "xpreview/a", "", undefined, 7, "preview/a b"]) {
    assert.equal(isPreviewBranch(b), false, String(b));
    assert.throws(() => previewAlias(b), String(b));
  }
  assert.equal(PREVIEW_PREFIX, "preview/");
  assert.equal(isPreviewBranch("preview/x"), true); // positive control
});

test("the name can never be a pull request's or the production branch's", () => {
  const a = previewAlias("preview/main");
  assert.doesNotMatch(a, /^pr-/);
  assert.notEqual(a, "main");
});
