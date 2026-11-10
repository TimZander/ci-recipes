import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stageVerdict, pagesAlias, isDeploymentId, pollSettings, canWaitAgain, escapeCommand, CLOUDFLARE_API, TIMEOUT_SECONDS, INTERVAL_MS } from "../actions/pages-preview/verify.mjs";

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

test("a failed, canceled or skipped stage is final, whichever stage it is", () => {
  for (const name of ["queued", "initialize", "build", "deploy"]) {
    for (const status of ["failure", "canceled", "skipped"]) assert.equal(stageVerdict({ name, status }), "failed", `${name} ${status}`);
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

test("pollSettings keeps the defaults for anything but a positive number", () => {
  const dflt = { apiUrl: CLOUDFLARE_API, timeoutMs: TIMEOUT_SECONDS * 1000, intervalMs: INTERVAL_MS };
  assert.deepEqual(pollSettings(), dflt);
  for (const v of ["", "abc", "0", "-5", "NaN", "Infinity"]) {
    assert.deepEqual(pollSettings([`--timeout-seconds=${v}`, `--interval-ms=${v}`]), dflt, v);
  }
  assert.deepEqual(pollSettings(["--timeout-seconds=2", "--interval-ms=50", "--api-url=http://x"]),
    { apiUrl: "http://x", timeoutMs: 2000, intervalMs: 50 });
});

test("pollSettings never reads the environment", () => {
  const src = readFileSync(new URL("../actions/pages-preview/verify.mjs", import.meta.url), "utf8");
  const code = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.doesNotMatch(code, /CLOUDFLARE_API_URL|VERIFY_TIMEOUT|VERIFY_INTERVAL/);
});

test("canWaitAgain stops once another wait would pass the deadline", () => {
  assert.ok(canWaitAgain(0, 100, 100));
  assert.ok(!canWaitAgain(1, 100, 100));
  assert.ok(!canWaitAgain(0, NaN, 100), "a NaN deadline stops rather than polls forever");
});

test("escapeCommand keeps a message on one workflow-command line", () => {
  assert.equal(escapeCommand("a%b\r\n::x"), "a%25b%0D%0A::x");
});
