---
status: accepted
date: 2026-11-07
decision-makers: the owner
---
# Callers reference reusable workflows; the rules live in ci-recipes once

Supersedes [0002](0002-composite-actions-not-reusable-workflows.md).

## Context and Problem Statement

0002 chose composite actions, so each repository kept its build in its own job. The cost
showed in the first adoption (garmin-map#273): `/ci:init` copied about 60 lines per workflow
into the repository, holding the concurrency, the fork guard, the teardown mode and the
permissions. The conformance review found a real defect in exactly that copied part (one
shared teardown group drops closes; a close can race a building preview), and garmin-map's
fixed copy had already diverged from the template. The owner asked why the YAML was copied
rather than referenced, so it is maintained in one place.

## Considered Options

- Reusable workflows (`on: workflow_call`) that own every rule; the caller keeps triggers,
  build inputs and secrets
- Only the teardown as a reusable workflow (it has no build)
- Keep composite actions, and have `/ci:update` flag a caller that drifts from the template

## Decision Outcome

Chosen by the owner: **reusable workflows for both.** The build moves into inputs: an
optional `node-version`, a `working-directory`, and a `build-command` run in bash, which a
repository with an unusual build points at its own script. Triggers cannot move: a reusable
workflow cannot say when it is called, so `on:` (and the sweep's cron) stays in the caller.

The workflows run the composite actions at their own commit: they check out ci-recipes at
`job.workflow_sha` (GitHub's context for the commit of the workflow defining the job, added
in 2026; `github.workflow_sha` names the caller's) and refuse to run if that is not a
40-character SHA or the checkout differs. So the caller's one pin covers every script.

### Consequences

- Good, because a fix to a rule lands once and reaches a repository when its pin moves.
- Good, because the templates hold no rules, and `tests/workflows.test.mjs` checks that.
- Bad, because a build must fit the inputs; one that needs another toolchain (painting's
  Python and uv) needs a new input with a default before it can adopt.
- Bad, because `job.workflow_sha` is new: if it is ever empty the workflows fail loudly
  rather than run unpinned code. Not available on GitHub Enterprise Server.
