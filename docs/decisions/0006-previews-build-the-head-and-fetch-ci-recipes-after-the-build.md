---
status: accepted
date: 2026-11-07
decision-makers: the owner ("fix all of them", the review of #2)
---
# Previews build the PR head, and fetch ci-recipes only after the build

## Context and Problem Statement

The review of #2 found that `pages-preview.yml` checked ci-recipes out into the workspace and
verified it **before** running the caller's build. The build (the pull request's code and its
dependencies' install scripts) could then rewrite `.ci-recipes/actions/pages-preview` before
that action ran with the Cloudflare token: the guard ran before the code that could defeat it.
It also found the comment naming the head commit while the default checkout built
`refs/pull/N/merge`, and a caller on the wrong event skipping silently.

## Considered Options

- Check ci-recipes out after the build, verify it (commit and a clean tree), and run the
  action straight after; build the head commit; refuse other events and a `.` directory
- Keep the order and verify twice, before and after the build
- Run the build in a separate job and pass the output as an artifact, so the token's job never
  runs the pull request's code

## Decision Outcome

Chosen option: **check out after the build, build the head, refuse what it cannot serve.** It
closes the gap with no extra job (the artifact split would add a billed job per push, against
STANDARD.md's minutes rule). What remains is written into STANDARD.md: a process the build
leaves running could still interfere, and the job that holds the token runs the pull
request's code, which is acceptable because only same-repository pull requests get a preview.

Building the head rather than the merge also makes the preview match the commit its comment
names, which is what a caller's spec says (garmin-map's "a preview of that commit").

### Consequences

- Good, because the guard now runs after everything that could tamper with what it checks.
- Good, because a misconfigured caller fails with a reason instead of skipping green.
- Bad, because a preview no longer shows the pull request merged with a newer base; the
  pull request's checks still run on the merge.
- Neutral: the preview template no longer has its own fork guard; the job has it.
