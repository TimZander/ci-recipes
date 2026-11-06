---
status: accepted
date: 2026-11-06
decision-makers: the owner
---
# Previews are not gated by tests; production is

## Context and Problem Statement

In painting the preview job `needs` an ~11-minute Python suite, and in timzander.com it runs
after `npm test` in the same job. So a red test, or a slow one, delays or blocks the owner's
UAT on a phone, though a preview deploy is fast and changes nothing anyone else sees.

## Considered Options

- Previews in parallel with the tests, ungated; production gated
- Previews gated on the fast checks only (lint, types, spec checks)
- Each repository keeps its current order

## Decision Outcome

Chosen by the owner: **previews in parallel, ungated; production gated**. It costs about one
billed minute per push in a repository whose preview used to be skipped when the tests
failed, and buys UAT that never waits for the suite.

### Consequences

- Good, because UAT can start a minute or two after a push, whatever the tests do.
- Bad, because a preview can show a build whose tests are red. The pull request's checks
  still show that, and the merge waits for them.
- painting's decision 0163 ("fewer billed minutes over a shorter wait") is superseded **for
  the preview only**, in painting's own records when it adopts this.
