---
status: accepted
date: 2026-11-07
decision-makers: the owner
---
# A workflow skips a pull request only when it changes nothing that workflow reads

## Context and Problem Statement

A pull request that changes only specs, docs or root Markdown still deployed a preview and ran
the tests: timzander.com #168, an archive-only pull request, ran both. The first draft of this
record skipped both on one default list (`openspec/**`, `docs/**`, root `*.md`), on the premise
that nothing in such a pull request can change what the tests check. Review found that premise
false: timzander.com's tests validate `openspec/` and read `README.md` and `CLAUDE.md`. The
owner then had the other callers checked:

- **painting** skips its Python job with a classify step, on a list built from what that job
  reads: `docs/` but not `docs/inputs/`, which governs the specs, and `openspec/` and
  `.claude/` but not their Python files, which ruff lints. Its spec job is never skipped.
- **Birdsong ID** (AudioClassifier) gives each workflow a `paths:` list of what it needs. Its
  PWA tests read nothing outside `pwa/`, and its spec checks run in the unfiltered
  `sdd-checks`.

## Considered Options

- One default list for the preview and the tests, as `paths-ignore` on each caller's trigger
  (the first draft)
- A classify job in the reusable preview workflow, which reads the diff and skips the rest
- Each workflow skips only the paths none of its steps read; the preview gets a default list,
  the tests a per-repository one, and spec validation is never skipped
- Leave it: accept what a code-free pull request costs

## Decision Outcome

Chosen option: **each workflow skips only the paths none of its steps read** (the owner,
2026-11-07, after the three callers were compared). It is the rule all three already follow
where they skip anything, and the one default list broke it in timzander.com.

- The preview template carries `paths-ignore` for `openspec/**`, `docs/**` and root `*.md`,
  since none of them is built into a site here; a repository whose site is `docs/` removes it.
- Tests are filtered per repository, after checking what their steps read.
- `paths-ignore` is preferred to `paths:`: it fails safe, where a `paths:` list skips a new
  file the workflow needs until someone adds it (Birdsong ID #416).
- A path filter is preferred to a classify job, since a skipped workflow bills nothing and a
  classify job bills a minute. A repository that needs more than a filter can express, such as
  painting's skip of a follow-up push that leaves the tested tree unchanged, keeps its classify
  step.

### Consequences

- Good, because a code-free pull request deploys no preview and bills nothing for it.
- Good, because no repository loses a check that reads what the pull request changed.
- Bad, because each repository works out its own test list, and the lists can drift. The
  preview list is copied into each caller by `/ci:init`, so a later change to it reaches no
  existing caller.
- Bad, because GitHub's path filters see only the first 300 changed files, so a larger pull
  request may be skipped though it changes code.
- Bad, because a push that makes the pull request code-free again deploys nothing, and the
  last preview stays up until the pull request closes.
- Bad, because a skipped workflow reports no status, so a required check on it never passes.
  A repository that requires one leaves that workflow unfiltered.
- The teardown keeps no filter: a pull request whose code was reverted still closes with a
  preview to delete.
