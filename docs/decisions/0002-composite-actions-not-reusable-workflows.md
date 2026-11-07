---
status: accepted
date: 2026-11-06
decision-makers: the agent, under the owner's plan
---
# Composite actions, not reusable workflows

## Context and Problem Statement

The shared preview has to run after each repository's own build. The four builds differ:
model staging and a build stamp in AudioClassifier, a Vite flag in garmin-map, a Python
build in painting, a drafts flag in timzander.com.

## Considered Options

- Reusable workflows (`on: workflow_call`) that build, deploy and comment
- Reusable workflows that download a build artifact uploaded by the caller
- Composite actions, used as steps after the caller's own build

## Decision Outcome

Chosen option: **composite actions**. They run in the caller's job, after its build, with
no artifact upload and download and no second job to bill. A composite action's files
arrive at the pinned SHA (`$GITHUB_ACTION_PATH`), so its scripts are pinned with it. A
reusable workflow cannot easily check out its own scripts at the ref it was called with.

### Consequences

- Good, because a caller adds one step and keeps its build exactly as it is.
- Bad, because `concurrency`, triggers and permissions stay in the caller's workflow and
  can drift. `templates/` is the reference for them, and `/ci:init` writes them.
