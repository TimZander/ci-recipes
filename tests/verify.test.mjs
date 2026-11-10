import { test } from "node:test";
import assert from "node:assert/strict";
import { stageVerdict, pagesAlias, isDeploymentId } from "../actions/pages-preview/verify.mjs";

test("live only when the deploy stage itself succeeded", () => {
  assert.equal(stageVerdict({ name: "deploy", status: "success" }), "live");
  for (const stage of [
    { name: "queued", status: "active" },
    { name: "initialize", status: "success" },
    { name: "build", status: "success" },
    { name: "deploy", status: "active" },
    { name: "deploy", status: "idle" },
    {},
    null,
    undefined,
  ]) {
    assert.equal(stageVerdict(stage), "pending", JSON.stringify(stage));
  }
});

test("a failed or canceled stage is final, whichever stage it is", () => {
  for (const name of ["queued", "initialize", "build", "deploy"]) {
    assert.equal(stageVerdict({ name, status: "failure" }), "failed", name);
    assert.equal(stageVerdict({ name, status: "canceled" }), "failed", name);
  }
});

test("pagesAlias picks the pages.dev alias, or nothing", () => {
  assert.equal(pagesAlias(["https://pr-7.proj.pages.dev"]), "https://pr-7.proj.pages.dev");
  assert.equal(pagesAlias(["https://custom.example.com", "https://pr-7.proj.pages.dev/"]), "https://pr-7.proj.pages.dev/");
  for (const aliases of [undefined, null, [], ["https://custom.example.com"], ["http://pr-7.proj.pages.dev"],
    ["https://pr-7.proj.pages.dev.evil.com"], ["https://pr-7.proj.pages.dev/path"], [7]]) {
    assert.equal(pagesAlias(aliases), "", JSON.stringify(aliases));
  }
});

test("a deployment id must look like Cloudflare's before it goes in a URL", () => {
  assert.ok(isDeploymentId("0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"));
  for (const id of ["", undefined, "../x", "8859a84f/../../", "ABC12345", "8859"]) assert.ok(!isDeploymentId(id), String(id));
});
