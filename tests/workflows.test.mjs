// The reusable workflows and the caller templates: the rules STANDARD.md puts in them. There is
// no YAML parser in the standard library, so each rule is an exact line AND the key path it must
// sit under (read from indentation), so a line moved to the wrong job or step does not pass.
// Every rule has a positive control: the same check, run on a copy with that one thing broken.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(root + p, "utf8");
const PREVIEW = ".github/workflows/pages-preview.yml";
const TEARDOWN = ".github/workflows/pages-teardown.yml";
const BRANCH_PREVIEW = ".github/workflows/pages-branch-preview.yml";

/**
 * The key path of every non-comment line, from indentation: `jobs > preview > concurrency` for
 * the group line. A list item (`- name: x`) counts as one level deeper than its dash.
 * Block scalars (`run: |`) are skipped: their content is not YAML.
 */
export function keyPaths(text) {
  const out = [];
  const stack = []; // [indent, key]
  let blockIndent = -1;
  for (const raw of text.split("\n")) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const lead = raw.length - raw.trimStart().length;
    if (blockIndent >= 0) {
      if (lead > blockIndent) continue;
      blockIndent = -1;
    }
    const item = raw.trimStart().startsWith("- ");
    const body = item ? raw.trimStart().slice(2) : raw.trimStart();
    const indent = item ? lead + 2 : lead;
    while (stack.length && stack[stack.length - 1][0] >= indent) stack.pop();
    out.push({ line: raw.trim(), path: stack.map(([, k]) => k) });
    const m = /^([\w.-]+):(.*)$/.exec(body);
    if (m) {
      stack.push([indent, m[1]]);
      if (/^\s*[|>]-?\s*$/.test(m[2])) blockIndent = indent;
    }
  }
  return out;
}

/** The rules whose exact line does not sit under the expected path. */
function broken(text, rules) {
  const lines = keyPaths(text);
  return rules
    .filter(([, line, path]) => !lines.some((l) => l.line === line && l.path.join(" > ") === path.join(" > ")))
    .map(([name]) => name);
}

const PREVIEW_RULES = [
  ["called, never triggered", "workflow_call:", ["on"]],
  ["skips forks, runs any other event so it can refuse it",
    "if: github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository", ["jobs", "preview"]],
  ["one group per PR", "group: preview-${{ github.event.pull_request.number }}", ["jobs", "preview", "concurrency"]],
  ["a newer push cancels", "cancel-in-progress: true", ["jobs", "preview", "concurrency"]],
  ["builds the PR's head commit", "ref: ${{ github.event.pull_request.head.sha }}", ["jobs", "preview", "steps", "with"]],
  ["checks out ci-recipes at its own commit", "ref: ${{ job.workflow_sha }}", ["jobs", "preview", "steps", "with"]],
  ["setup-node caches what the caller says", "cache: ${{ inputs.node-cache }}", ["jobs", "preview", "steps", "with"]],
  ["runs the pinned commit's action", "- uses: ./.ci-recipes/actions/pages-preview", ["jobs", "preview", "steps"]],
];
const TEARDOWN_RULES = [
  ["called, never triggered", "workflow_call:", ["on"]],
  ["a close joins its PR's preview group, a branch delete its branch's; the sweep its own",
    "group: ${{ github.event_name == 'pull_request' && format('preview-{0}', github.event.pull_request.number) || github.event_name == 'delete' && format('preview-branch-{0}', github.event.ref) || 'preview-teardown-sweep' }}",
    ["jobs", "teardown", "concurrency"]],
  ["a close or a delete cancels a build in progress; the sweep is never cancelled",
    "cancel-in-progress: ${{ github.event_name == 'pull_request' || github.event_name == 'delete' }}", ["jobs", "teardown", "concurrency"]],
  ["close means pr, delete means branch, anything else sweep",
    "mode: ${{ github.event_name == 'pull_request' && 'pr' || github.event_name == 'delete' && 'branch' || 'sweep' }}", ["jobs", "teardown", "steps", "with"]],
  ["checks out ci-recipes at its own commit", "ref: ${{ job.workflow_sha }}", ["jobs", "teardown", "steps", "with"]],
  ["runs the pinned commit's action", "- uses: ./.ci-recipes/actions/pages-teardown", ["jobs", "teardown", "steps"]],
];

const BRANCH_PREVIEW_RULES = [
  ["called, never triggered", "workflow_call:", ["on"]],
  ["one group per branch, the one its delete joins", "group: preview-branch-${{ github.ref_name }}", ["jobs", "preview", "concurrency"]],
  ["a newer push cancels", "cancel-in-progress: true", ["jobs", "preview", "concurrency"]],
  ["reads the repository, writes nothing", "contents: read", ["jobs", "preview", "permissions"]],
  ["builds the pushed commit", "ref: ${{ github.sha }}", ["jobs", "preview", "steps", "with"]],
  ["checks out ci-recipes at its own commit", "ref: ${{ job.workflow_sha }}", ["jobs", "preview", "steps", "with"]],
  ["runs the pinned commit's action", "- uses: ./.ci-recipes/actions/pages-branch-preview", ["jobs", "preview", "steps"]],
];

/** Every third-party `uses:` pinned to a 40-character SHA; local `./` paths must exist. */
function unpinned(text) {
  return text.split("\n").map((l) => l.trim()).filter((l) => /^(- )?uses: /.test(l))
    .map((l) => l.replace(/^(- )?uses: /, "").replace(/\s+#.*$/, ""))
    .filter((u) => (u.startsWith("./") ? !existsSync(root + u.slice(2).replace(/^\.ci-recipes\//, "")) : !/@[0-9a-f]{40}$/.test(u)));
}

/** The PINNED-CHECKOUT block, marker to marker. */
const pinnedBlock = (text) => {
  const a = text.indexOf("# PINNED-CHECKOUT:"), b = text.indexOf("# END PINNED-CHECKOUT");
  return a < 0 || b < 0 ? null : text.slice(a, b);
};

test("pages-preview.yml carries every rule, where it belongs", () => {
  assert.deepEqual(broken(read(PREVIEW), PREVIEW_RULES), []);
});

test("pages-teardown.yml carries every rule, where it belongs", () => {
  assert.deepEqual(broken(read(TEARDOWN), TEARDOWN_RULES), []);
});

test("pages-branch-preview.yml carries every rule, where it belongs", () => {
  assert.deepEqual(broken(read(BRANCH_PREVIEW), BRANCH_PREVIEW_RULES), []);
  // a branch preview never asks to write pull requests: it has none
  assert.doesNotMatch(read(BRANCH_PREVIEW), /pull-requests:/);
});

test("positive control: each rule's line, removed or moved under another key, is reported", () => {
  for (const [file, rules] of [[PREVIEW, PREVIEW_RULES], [TEARDOWN, TEARDOWN_RULES], [BRANCH_PREVIEW, BRANCH_PREVIEW_RULES]]) {
    const text = read(file);
    for (const [name, line] of rules) {
      const removed = text.split("\n").filter((l) => l.trim() !== line).join("\n");
      assert.deepEqual(broken(removed, rules), [name], `${file}: ${name} removed`);
    }
  }
  // moved: the preview's concurrency lines under its permissions instead
  const moved = read(PREVIEW).replace("    concurrency:\n", "    permissions-moved:\n");
  assert.deepEqual(broken(moved, PREVIEW_RULES), ["one group per PR", "a newer push cancels"]);
});

test("the guard block is the same in every workflow, and refuses a non-SHA, another commit or a changed tree", () => {
  const p = pinnedBlock(read(PREVIEW)), t = pinnedBlock(read(TEARDOWN)), b = pinnedBlock(read(BRANCH_PREVIEW));
  assert.ok(p && t && b);
  assert.equal(p, t);
  assert.equal(p, b);
  assert.match(p, /\[\[ "\$WANT" =~ \^\[0-9a-f\]\{40\}\$ \]\] \|\|/);
  assert.match(p, /\[ "\$got" = "\$WANT" \] \|\|/);
  assert.match(p, /status --porcelain --ignored\)" \] \|\|/);
  // positive control: a drifted copy differs
  assert.notEqual(p, p.replace("--ignored", ""));
});

for (const [file, checkout, action] of [
  [BRANCH_PREVIEW, "ref: ${{ github.sha }}", "- uses: ./.ci-recipes/actions/pages-branch-preview"],
]) {
  test(`${file}: ci-recipes is checked out only after the build, right before the action`, () => {
    const p = read(file);
    const at = (s) => { const i = p.indexOf(s); assert.ok(i >= 0, s); return i; };
    const order = [at(checkout), at("- name: Build"), at("# PINNED-CHECKOUT:"), at(action)];
    assert.deepEqual([...order].sort((x, y) => x - y), order, "checkout, build, ci-recipes checkout, action");
    assert.doesNotMatch(p.slice(p.indexOf("# END PINNED-CHECKOUT"), order[3]), /run:|uses:/);
  });
}

test("the branch preview refuses any event but push, any branch but preview/**, and a directory that would publish the checkout", () => {
  const p = read(BRANCH_PREVIEW);
  assert.match(p, /\[ "\$EVENT" = push \] \|\| \{/);
  assert.match(p, /case "\$REF" in refs\/heads\/preview\/\?\*\) ;; \*\)/);
  assert.match(p, /case "\$DIRECTORY" in \.\|\.\/\|""\|\.ci-recipes\*\|\.\/\.ci-recipes\*\)/);
  assert.ok(p.indexOf("Refuse a call this workflow cannot serve") < p.indexOf("- name: Build"));
  // the action refuses the same, so the deploy cannot be reached around the workflow
  const a = read("actions/pages-branch-preview/action.yml");
  assert.match(a, /\[ "\$EVENT" = push \] \|\|/);
  assert.match(a, /case "\$REF" in refs\/heads\/preview\/\?\*\) ;; \*\)/);
  assert.ok(a.indexOf('case "$REF"') < a.indexOf("- id: deploy"), "refused before the deploy");
  assert.match(a, /--branch=\$\{\{ steps\.alias\.outputs\.alias \}\}/);
});

test("the teardown skips the delete of anything but a preview/** branch", () => {
  const t = read(TEARDOWN);
  assert.match(t, /\(github\.event_name != 'delete' \|\| \(github\.event\.ref_type == 'branch' && startsWith\(github\.event\.ref, 'preview\/'\)\)\)/);
});

test("ci-recipes is checked out only after the build, right before the action that gets the token", () => {
  const p = read(PREVIEW);
  const at = (s) => { const i = p.indexOf(s); assert.ok(i >= 0, s); return i; };
  const head = at("ref: ${{ github.event.pull_request.head.sha }}");
  const build = at("- name: Build");
  const pinned = at("# PINNED-CHECKOUT:");
  const action = at("- uses: ./.ci-recipes/actions/pages-preview");
  assert.ok(head < build && build < pinned && pinned < action, "head checkout, build, ci-recipes checkout, action");
  // nothing runs between the guard and the action
  assert.doesNotMatch(p.slice(p.indexOf("# END PINNED-CHECKOUT"), action), /run:|uses:/);
});

test("the preview refuses any event but pull_request, and a directory that would publish the checkout", () => {
  const p = read(PREVIEW);
  assert.match(p, /\[ "\$EVENT" = pull_request \] \|\| \{/);
  assert.match(p, /case "\$DIRECTORY" in \.\|\.\/\|""\|\.ci-recipes\*\|\.\/\.ci-recipes\*\)/);
  assert.ok(p.indexOf("Refuse a call this workflow cannot serve") < p.indexOf("- name: Build"));
});

test("every action used is pinned to a SHA, and every local one exists", () => {
  for (const f of [PREVIEW, TEARDOWN, BRANCH_PREVIEW, "actions/pages-preview/action.yml",
    "actions/pages-branch-preview/action.yml", "actions/pages-teardown/action.yml"]) {
    assert.deepEqual(unpinned(read(f)), [], f);
  }
});

test("positive control: a tag pin and a missing local action are reported", () => {
  assert.deepEqual(unpinned("    - uses: actions/checkout@v4\n    - uses: ./actions/nope\n"),
    ["actions/checkout@v4", "./actions/nope"]);
});

test("keyPaths: list items nest under their key, block scalars are skipped", () => {
  const paths = keyPaths("jobs:\n  a:\n    steps:\n      - name: x\n        run: |\n          k: v\n        with:\n          ref: r\n");
  assert.deepEqual(paths.find((l) => l.line === "ref: r").path, ["jobs", "a", "steps", "with"]);
  assert.equal(paths.find((l) => l.line === "k: v"), undefined);
});

// ---- the caller templates /ci:init writes

const TEMPLATES = ["templates/preview.yml", "templates/preview-teardown.yml", "templates/branch-preview.yml"];

test("templates call the reusable workflows, pinned by placeholder only", () => {
  assert.deepEqual(broken(read(TEMPLATES[0]), [["call", "uses: TimZander/ci-recipes/.github/workflows/pages-preview.yml@__SHA__", ["jobs", "preview"]]]), []);
  assert.deepEqual(broken(read(TEMPLATES[1]), [["call", "uses: TimZander/ci-recipes/.github/workflows/pages-teardown.yml@__SHA__", ["jobs", "teardown"]]]), []);
  assert.deepEqual(broken(read(TEMPLATES[2]), [["call", "uses: TimZander/ci-recipes/.github/workflows/pages-branch-preview.yml@__SHA__", ["jobs", "preview"]]]), []);
});

test("templates' comments hold no placeholder, so substitution cannot garble them", () => {
  for (const f of TEMPLATES) {
    const inComments = read(f).split("\n").filter((l) => l.trim().startsWith("#") && /__[A-Z]+__/.test(l));
    assert.deepEqual(inComments, [], f);
  }
  assert.equal(["# Fill in: __PROJECT__"].filter((l) => /__[A-Z]+__/.test(l)).length, 1); // positive control
});

test("the branch preview template runs on a push to preview/** only, never on a pull request", () => {
  const t = read(TEMPLATES[2]);
  assert.deepEqual(broken(t, [["preview branches", "branches: ['preview/**']", ["on", "push"]]]), []);
  const triggers = keyPaths(t).filter((l) => l.path.join(" > ") === "on").map((l) => l.line);
  assert.deepEqual(triggers, ["push:"]);
  // positive control: a pull_request trigger beside it is seen
  const both = t.replace("on:\n", "on:\n  pull_request:\n");
  assert.deepEqual(keyPaths(both).filter((l) => l.path.join(" > ") === "on").map((l) => l.line), ["pull_request:", "push:"]);
});

test("the teardown template runs on close, on a branch delete, weekly and on demand", () => {
  const t = read(TEMPLATES[1]);
  assert.deepEqual(broken(t, [
    ["close", "types: [closed]", ["on", "pull_request"]],
    ["branch delete", "delete:", ["on"]],
    ["on demand", "workflow_dispatch:", ["on"]],
  ]), []);
  assert.match(t, /- cron: '\d{1,2} \d{1,2} \* \* [0-6]'/);
});

/** A rule a template must not hold: the reusable workflows own them (decision 0005). */
const RULE_KEYS = /^\s*(concurrency|mode|if):/m;
test("templates hold none of the rules the reusable workflows own", () => {
  for (const f of TEMPLATES) assert.doesNotMatch(read(f), RULE_KEYS, f);
  // positive control
  assert.match("jobs:\n  preview:\n    if: github.event.pull_request.head.repo.full_name == github.repository\n", RULE_KEYS);
});

/** Fails a refused comment write quietly: the key as an indented line or a list item's first key. */
const QUIET = /^\s*(- )?continue-on-error:/m;

/** What is wrong with the comment step of an action.yml: it must run after the deploy, on the
 *  same condition, with a run line that passes comment.mjs's exit code through unchanged. */
function commentStepProblems(text) {
  const steps = keyPaths(text).filter((l) => l.path.join(" > ").startsWith("runs > steps"));
  const deploy = steps.findIndex((l) => l.line === "- id: deploy" && l.path.join(" > ") === "runs > steps");
  const run = steps.findIndex((l) => l.line.startsWith("run:") && l.line.includes("comment.mjs"));
  const problems = [];
  if (deploy < 0) problems.push("no deploy step");
  if (run < 0) problems.push("no comment step");
  if (deploy >= 0 && run >= 0 && run < deploy) problems.push("comment before deploy");
  if (run >= 0 && steps[run].line !== 'run: node "$GITHUB_ACTION_PATH/comment.mjs"') problems.push("run line changed");
  if (run >= 0) {
    let start = run;
    while (start > 0 && !steps[start].line.startsWith("- ")) start--;
    const ifs = steps.slice(start, run + 1).filter((l) => /^(- )?if:/.test(l.line));
    if (ifs.length !== 1 || !ifs[0].line.endsWith("if: steps.guard.outputs.skipped == 'false'")) problems.push("condition changed");
  }
  if (QUIET.test(text)) problems.push("continue-on-error");
  return problems;
}

test("the preview comment runs after the deploy, and a refused write fails the job", () => {
  const action = read("actions/pages-preview/action.yml");
  assert.deepEqual(commentStepProblems(action), []);
  assert.doesNotMatch(read(PREVIEW), QUIET);
});

test("positive control: each way of hiding a refused comment write is reported", () => {
  const action = read("actions/pages-preview/action.yml");
  const runLine = 'run: node "$GITHUB_ACTION_PATH/comment.mjs"';
  const guardIf = "- if: steps.guard.outputs.skipped == 'false'\n      shell: bash\n      env:\n        GITHUB_TOKEN";
  assert.ok(action.includes(runLine) && action.includes(guardIf), "the fixtures below still match action.yml");
  const cases = {
    "run line changed": action.replace(runLine, runLine + " || true"),
    "condition changed": action.replace(guardIf, guardIf.replace("- if: steps.guard.outputs.skipped == 'false'", "- if: always()")),
    "continue-on-error": action.replace(guardIf, guardIf.replace("      shell: bash", "      continue-on-error: true\n      shell: bash")),
  };
  for (const [problem, text] of Object.entries(cases)) assert.ok(commentStepProblems(text).includes(problem), problem);
  // the comment step moved above the deploy, with a comment line naming the deploy left on top
  const commentStep = action.slice(action.indexOf(guardIf), action.indexOf(runLine) + runLine.length);
  const moved = action.replace(commentStep, "").replace("    - id: deploy", "    # - id: deploy\n    " + commentStep + "\n\n    - id: deploy");
  assert.ok(commentStepProblems(moved).includes("comment before deploy"));
  assert.match("    - continue-on-error: true", QUIET);
  assert.match("      continue-on-error: true", QUIET);
});

const CODE_FREE = ["- 'openspec/**'", "- 'docs/**'", "- '*.md'"];
test("the preview template skips a pull request that changes no code", () => {
  const rules = CODE_FREE.map((l) => [l, l, ["on", "pull_request", "paths-ignore"]]);
  assert.deepEqual(broken(read(TEMPLATES[0]), rules), []);
  // positive control: the same entries under another key are reported
  const moved = "on:\n  pull_request:\n    paths:\n" + CODE_FREE.map((l) => `      ${l}`).join("\n") + "\n";
  assert.equal(broken(moved, rules).length, CODE_FREE.length);
});

/** The filter keys a trigger carries; GitHub refuses a workflow that sets both on one event. */
const filterKeys = (text, event) =>
  keyPaths(text).filter((l) => l.path.join(" > ") === `on > ${event}` && /^paths(-ignore)?:/.test(l.line))
    .map((l) => l.line.split(":")[0]);
test("the preview template's trigger never sets paths beside paths-ignore", () => {
  assert.deepEqual(filterKeys(read(TEMPLATES[0]), "pull_request"), ["paths-ignore"]);
  // positive control
  const both = read(TEMPLATES[0]).replace("    paths-ignore:", "    paths:\n      - 'src/**'\n    paths-ignore:");
  assert.deepEqual(filterKeys(both, "pull_request"), ["paths", "paths-ignore"]);
});

test("the teardown template has no path filter: a close always tears down", () => {
  const FILTER = /\bpaths(-ignore)?\s*:/;
  assert.doesNotMatch(read(TEMPLATES[1]), FILTER);
  // positive controls: a block key and the flow form
  assert.match("    paths-ignore:", FILTER);
  assert.match("  pull_request: {types: [closed], paths-ignore: ['docs/**']}", FILTER);
});
