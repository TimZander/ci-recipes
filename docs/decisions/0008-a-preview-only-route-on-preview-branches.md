---
status: accepted
date: 2026-11-07
decision-makers: the owner
---
# A preview-only route: a push to `preview/**` deploys a preview, with no pull request

## Context and Problem Statement

A throwaway prototype for a phone UAT needs a Pages preview, and the only route to one was a
pull request. That pull request ran the whole test suite on every push, and only its title
stopped it being merged. AudioClassifier's #1119, a do-not-merge draft opened only for a
prototype's preview, billed 45 minutes over 12 runs; the preview was 4 of them, and the only
output anyone used (ci-recipes#4).

## Considered Options

- A push to a `preview/**` branch deploys a preview and runs nothing else
- A `preview-only` label on a draft pull request, which skips the tests and adds a check that
  always fails, to block the merge
- Keep opening a draft pull request

## Decision Outcome

Chosen option: **a push to `preview/**`** (the owner approved ci-recipes#4 as written,
2026-11-07). With no pull request there is nothing to merge and no test is triggered. A label
still starts several small jobs on every push, and its merge block holds only where branch
protection is configured.

The owner's answers to the issue's two questions:

1. **The prefix is `preview/**`.** A prototype isn't a work branch, so it doesn't collide with
   a repository's work-branch naming (AudioClassifier's `branches/…`).
2. **A preview never expires while its branch exists.** It goes when the branch is deleted,
   or at the weekly sweep after that. No age limit.

The details stand as the issue proposed them:

- **The name is `pv-<the first 12 hex digits of the branch name's sha256>`.** It is short,
  where Cloudflare keeps 28 characters of a branch, and it can never be `main` or `pr-<n>`.
  The deploy computes it in bash before the build, so the build cannot change it, and the
  action checks only its shape. The teardown computes the same name in `alias.mjs`, and a test
  checks that the two agree. (A first version computed it in node after the build, one
  module for both; review found that a build could then rename the deploy to `main`.)
- **The URL goes to the step summary**, and to one `preview-url:` line of the job's log for an
  agent.
- **Teardown is on the `delete` event**, unless the branch exists again. The delete of any
  other branch is skipped by the job's `if:`, billing nothing. The sweep keeps the previews of
  preview branches that still exist, and deletes nothing when it can't list them.

### Consequences

- Good, because a prototype round costs about a billed minute a push, and can't be merged.
- Good, because the preview, its name and its teardown follow the same rules as a pull
  request's (STANDARD.md rules 1 to 4), in the same reusable-workflow shape (decision 0005).
- Bad, because a repository whose other workflows run on every push runs them on a preview
  branch too. The route saves their minutes only where they run on `pull_request` and `main`.
- Bad, because a preview branch left undeleted keeps its preview indefinitely, by the owner's
  choice. The sweep can't tell an abandoned prototype from a live one.
- Neutral: the route's guards catch a wrongly wired caller, not someone with push access, who
  can push a `preview/**` branch with any caller workflow, as they can open a pull request
  with one. The Cloudflare token's scope is what limits them, as it does today.
- The callers' side, `/ci:init` writing the new caller and the sdd workshop naming the route,
  is TimZander/claude#259.
