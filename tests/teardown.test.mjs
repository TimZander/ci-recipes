import { test } from "node:test";
import assert from "node:assert/strict";
import { selectTargets, isDeploymentId, REMOVED_BODY } from "../actions/pages-teardown/teardown.mjs";
import { MARKER } from "../actions/pages-preview/comment.mjs";

let n = 0;
function dep(branch, environment = "preview") {
  n += 1;
  return {
    id: `0000000${n}-aaaa-bbbb-cccc-dddddddddddd`,
    environment,
    deployment_trigger: branch === null ? {} : { metadata: { branch } },
  };
}
const ids = (targets) => targets.map((t) => t.branch);

test("pr mode deletes exactly pr-<n>, every deployment of it", () => {
  const deployments = [dep("pr-7"), dep("pr-7"), dep("pr-70"), dep("pr-8"), dep("main", "production")];
  const t = selectTargets({ deployments, mode: "pr", prNumber: 7, productionBranch: "main" });
  assert.deepEqual(ids(t), ["pr-7", "pr-7"]);
});

test("production is never a target: not by environment, not by branch name", () => {
  // A production deployment on a branch that looks like a PR's.
  const prodLooksLikePr = dep("pr-7", "production");
  // A deployment marked preview on the production branch (renamed from main to trunk).
  const previewOnProdBranch = dep("trunk");
  const deployments = [prodLooksLikePr, previewOnProdBranch];
  assert.deepEqual(selectTargets({ deployments, mode: "pr", prNumber: 7, productionBranch: "trunk" }), []);
  assert.deepEqual(selectTargets({ deployments, mode: "sweep", openPrs: [], productionBranch: "trunk" }), []);
});

test("sweep keeps open PRs' previews under pr-<n> and under their head branch", () => {
  const deployments = [dep("pr-3"), dep("pr-4"), dep("branches/12-old-style"), dep("gone-branch"), dep(null), dep("")];
  const t = selectTargets({
    deployments, mode: "sweep", productionBranch: "main",
    openPrs: [{ number: 3, headRef: "x" }, { number: 9, headRef: "branches/12-old-style" }],
  });
  // positive control: the sweep must actually find the strays
  assert.deepEqual(ids(t), ["pr-4", "gone-branch"]);
});

test("each id is deleted once, in listing order", () => {
  const d = dep("pr-5");
  const t = selectTargets({ deployments: [d, d, dep("pr-5")], mode: "pr", prNumber: 5, productionBranch: "main" });
  assert.equal(t.length, 2);
  assert.equal(t[0].id, d.id);
});

test("an id that does not look like Cloudflare's stops everything before any delete", () => {
  for (const id of ["../../projects", "ABC-not-hex", "", 42, undefined, "0123456"]) {
    assert.equal(isDeploymentId(id), false, String(id));
    const deployments = [dep("pr-1"), { id, environment: "preview", deployment_trigger: { metadata: { branch: "pr-1" } } }];
    assert.throws(() => selectTargets({ deployments, mode: "pr", prNumber: 1, productionBranch: "main" }));
  }
  assert.equal(isDeploymentId("2f3a9c1e-1234-4abc-9def-0123456789ab"), true);
});

test("bad modes and PR numbers are refused", () => {
  const base = { deployments: [dep("pr-1")], productionBranch: "main" };
  assert.throws(() => selectTargets({ ...base, mode: "everything" }));
  for (const prNumber of [undefined, "", "0", "1; rm", -1]) {
    assert.throws(() => selectTargets({ ...base, mode: "pr", prNumber }), String(prNumber));
  }
  assert.throws(() => selectTargets({ ...base, mode: "sweep", productionBranch: "" }));
});

test("the removed comment keeps the marker, so a reopened PR's next preview updates it", () => {
  assert.ok(REMOVED_BODY.startsWith(MARKER + "\n"));
});
