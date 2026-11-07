// The reusable workflows and the caller templates: the rules STANDARD.md puts in them, checked
// on their text (no YAML parser in the standard library, so each rule is an exact line). Each
// rule has a positive control: the same check run on a copy with that one line broken.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(root + p, "utf8");
const PREVIEW = ".github/workflows/pages-preview.yml";
const TEARDOWN = ".github/workflows/pages-teardown.yml";

const has = (text, line) => text.split("\n").some((l) => l.trim() === line);

/** Every rule, as [name, exact line]; a missing line is a broken rule. */
const PREVIEW_RULES = [
  ["called, never triggered", "workflow_call:"],
  ["skips forks", "if: github.event.pull_request.head.repo.full_name == github.repository"],
  ["one group per PR", "group: preview-${{ github.event.pull_request.number }}"],
  ["a newer push cancels", "cancel-in-progress: true"],
  ["checks out ci-recipes at its own commit", "ref: ${{ job.workflow_sha }}"],
  ["runs the pinned commit's action", "- uses: ./.ci-recipes/actions/pages-preview"],
];
const TEARDOWN_RULES = [
  ["called, never triggered", "workflow_call:"],
  ["a close joins its PR's preview group; the sweep its own",
    "group: ${{ github.event_name == 'pull_request' && format('preview-{0}', github.event.pull_request.number) || 'preview-teardown-sweep' }}"],
  ["a close cancels a build in progress; the sweep is never cancelled", "cancel-in-progress: ${{ github.event_name == 'pull_request' }}"],
  ["close means pr, anything else sweep", "mode: ${{ github.event_name == 'pull_request' && 'pr' || 'sweep' }}"],
  ["checks out ci-recipes at its own commit", "ref: ${{ job.workflow_sha }}"],
  ["runs the pinned commit's action", "- uses: ./.ci-recipes/actions/pages-teardown"],
];

function broken(text, rules) {
  return rules.filter(([, line]) => !has(text, line)).map(([name]) => name);
}

/** Every third-party `uses:` pinned to a 40-character SHA; local `./` paths must exist. */
function unpinned(text) {
  return text.split("\n").map((l) => l.trim()).filter((l) => /^(- )?uses: /.test(l))
    .map((l) => l.replace(/^(- )?uses: /, "").replace(/\s+#.*$/, ""))
    .filter((u) => (u.startsWith("./") ? !existsSync(root + u.slice(2).replace(/^\.ci-recipes\//, "")) : !/@[0-9a-f]{40}$/.test(u)));
}

test("pages-preview.yml carries every rule", () => {
  assert.deepEqual(broken(read(PREVIEW), PREVIEW_RULES), []);
});

test("pages-teardown.yml carries every rule", () => {
  assert.deepEqual(broken(read(TEARDOWN), TEARDOWN_RULES), []);
});

test("both refuse to run anything but the commit they were called at", () => {
  for (const f of [PREVIEW, TEARDOWN]) {
    const t = read(f);
    assert.match(t, /WANT: \$\{\{ job\.workflow_sha \}\}/, f);
    assert.match(t, /\[ "\$got" = "\$WANT" \] \|\| \{/, f);
  }
  // The preview checks out the caller first: a later checkout into the workspace root would
  // wipe .ci-recipes. (The teardown checks out nothing of the caller's.)
  const p = read(PREVIEW);
  const callerCheckout = p.indexOf("- uses: actions/checkout@");
  assert.ok(callerCheckout >= 0 && callerCheckout < p.indexOf("path: .ci-recipes"));
  assert.doesNotMatch(read(TEARDOWN).split("path: .ci-recipes")[1], /uses: actions\/checkout@/);
});

test("every action used is pinned to a SHA, and every local one exists", () => {
  for (const f of [PREVIEW, TEARDOWN]) assert.deepEqual(unpinned(read(f)), [], f);
});

test("positive control: each rule's line, removed, is reported", () => {
  for (const [file, rules] of [[PREVIEW, PREVIEW_RULES], [TEARDOWN, TEARDOWN_RULES]]) {
    const text = read(file);
    for (const [name, line] of rules) {
      const without = text.split("\n").filter((l) => l.trim() !== line).join("\n");
      assert.deepEqual(broken(without, rules), [name], `${file}: ${name}`);
    }
  }
});

test("positive control: a tag pin and a missing local action are reported", () => {
  assert.deepEqual(unpinned("    - uses: actions/checkout@v4\n    - uses: ./actions/nope\n"),
    ["actions/checkout@v4", "./actions/nope"]);
});

// ---- the caller templates /ci:init writes

const TEMPLATES = ["templates/preview.yml", "templates/preview-teardown.yml"];

test("templates call the reusable workflows, pinned by placeholder only", () => {
  assert.ok(has(read(TEMPLATES[0]), "uses: TimZander/ci-recipes/.github/workflows/pages-preview.yml@__SHA__"));
  assert.ok(has(read(TEMPLATES[1]), "uses: TimZander/ci-recipes/.github/workflows/pages-teardown.yml@__SHA__"));
});

test("templates' comments hold no placeholder, so substitution cannot garble them", () => {
  for (const f of TEMPLATES) {
    const inComments = read(f).split("\n").filter((l) => l.trim().startsWith("#") && /__[A-Z]+__/.test(l));
    assert.deepEqual(inComments, [], f);
  }
  // positive control
  assert.equal(["# Fill in: __PROJECT__"].filter((l) => /__[A-Z]+__/.test(l)).length, 1);
});

test("the teardown template runs on close, weekly and on demand", () => {
  const t = read(TEMPLATES[1]);
  assert.ok(has(t, "types: [closed]"));
  assert.match(t, /- cron: '\d{1,2} \d{1,2} \* \* [0-6]'/);
  assert.ok(has(t, "workflow_dispatch:"));
});

test("templates hold none of the rules the reusable workflows own", () => {
  for (const f of TEMPLATES) {
    const t = read(f);
    assert.doesNotMatch(t, /^\s*concurrency:/m, f);
    assert.doesNotMatch(t, /^\s*mode:/m, f);
  }
});
