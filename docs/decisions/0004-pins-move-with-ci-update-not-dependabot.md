---
status: accepted
date: 2026-11-06
decision-makers: the agent; the owner left it open ("IDK"), so this is revisitable
---
# Callers' pins move with `/ci:update`, not Dependabot

## Context and Problem Statement

Callers pin a ci-recipes commit SHA, so they do not pick up a fix until the pin moves. The
pin can be moved automatically by Dependabot (its `github-actions` ecosystem updates SHA
pins), or by hand with a `/ci:update` skill. The owner did not choose.

## Considered Options

- Dependabot on each caller
- `/ci:update`, run when wanted
- Pin a branch (`@main`) and never move anything

## Decision Outcome

Chosen option: **`/ci:update`, run when wanted**. Each Dependabot pull request runs the
caller's whole CI, which spends billed minutes on private repositories, and STANDARD.md
puts minutes first. Pinning `@main` is refused: a merge here would change four repositories'
CI with no commit in any of them.

### Consequences

- Good, because no CI minutes are spent on pin bumps nobody asked for.
- Bad, because a fix here reaches a caller only when someone runs `/ci:update` there.
- Revisit if fixes start sitting unadopted, or if Dependabot's grouping makes one weekly pull
  request per repository cheap enough.
