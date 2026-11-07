---
status: accepted
date: 2026-11-07
decision-makers: the owner
---
# Code-free pull requests skip the tests and the preview, by the caller's path filter

## Context and Problem Statement

A pull request that changes only specs, docs or root Markdown still ran the tests and
deployed a preview: timzander.com #168, an archive-only pull request, ran both. Nothing in
it can change what the tests check or what the preview shows, so both runs were spent
minutes. painting already skipped them, with its own classify script.

## Considered Options

- `paths-ignore` on each caller's `pull_request` trigger
- A first job in the reusable preview workflow that reads the diff and skips the rest
- Leave it: accept what a code-free pull request costs

## Decision Outcome

Chosen option: **`paths-ignore` on the caller's trigger** (the owner, 2026-11-07). A
workflow the filter skips never starts, so it bills nothing. A classify job bills a whole
minute itself, about what a preview costs, and could not skip the tests: `test.yml` is each
repository's own workflow. Triggers are already the caller's under decision 0005, so the
filter sits there. The default list (`openspec/**`, `docs/**`, root `*.md`) is in
STANDARD.md rule 6 and the preview template, which `/ci:init` writes.

### Consequences

- Good, because a code-free pull request costs no CI minutes.
- Good, because the filter is on the whole pull request's diff: a later push that touches
  code runs everything again.
- Bad, because the list is copied into each caller, so it can drift. A repository adds
  its own code-free paths, and removes `docs/**` where `docs/` is the site.
- Bad, because a skipped workflow reports no status, so a required check on it never
  passes. A repository that requires one leaves that workflow unfiltered.
- The teardown keeps no filter: a pull request whose code was reverted still closes with a
  preview to delete.
