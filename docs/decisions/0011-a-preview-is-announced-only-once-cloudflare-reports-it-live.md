---
status: accepted
date: 2026-11-10
decision-makers: the owner
---
# A preview is announced only once Cloudflare reports it live

## Context and Problem Statement

On 2026-11-09 a garmin-map pull request's preview ran three times:

1. wrangler failed with "Failed to publish your Function. Unknown internal error" and exited 1.
   The job was red, which was right.
2. wrangler printed "Deployment complete! However, we couldn't ascertain the final status of
   your deployment", exited 0 and returned no alias. `pages-preview` posted **Preview ready**
   with the per-commit link, and that link didn't load for the owner.
3. A normal deploy, with both links.

wrangler 3.114.17's `pages deploy` asks for the deployment's status five times, waiting 1, 2, 4,
8 and 16 s. If Cloudflare hasn't answered success or failure by then, it logs that line and
exits 0. Both preview actions trusted that exit code, so a deployment nobody had seen go live
was announced as ready.

## Considered Options

- **Ask Cloudflare's API** for the deployment wrangler made (`pages-deployment-id`), until its
  deploy stage succeeds or fails, and fail the job on failure or timeout
- Load the deployment's URL from the runner until it answers
- Fail when wrangler returns no alias
- Move to wrangler 4

## Decision Outcome

Chosen option: **ask Cloudflare's API** (the owner, 2026-11-10, "go ahead and start this
work"), because it is the authoritative answer and gives the reason when a deploy fails.

- `actions/pages-preview/verify.mjs` runs as a step of both preview actions, after the deploy
  and before the comment (`pages-preview`) or the summary (`pages-branch-preview`). It asks
  every 5 s for up to 180 s.
- **Live** means the `deploy` stage reports `success`. Its `*.pages.dev` alias is passed to the
  comment, filling the stable link when wrangler returned none.
- **Failed** (any stage `failure`, `canceled` or `skipped`): the job fails with Cloudflare's
  last log line, escaped so it can't start a workflow command.
- **No confirmation in 180 s**, a missing deployment id, or one that doesn't look like
  Cloudflare's: the job fails, and the error says to re-run.
- On a pull request, a failed verify replaces the comment with **Preview not confirmed** for
  that commit, with no link. Otherwise an earlier push's "Preview ready" would still read as
  current.
- The step runs after the caller's build, which can write to `$GITHUB_ENV`. So verify reads
  no setting from the environment beyond the token, account, project and id the step passes:
  the API URL and timings used by tests come only as command-line arguments. An environment
  variable could send the token to another host.
- It is a step, not a job: no extra billed minute. It usually costs a few seconds, since
  wrangler has already waited.
- No input or output changed, so callers move to it by moving their pin.

The other options lost:

- Loading the URL can succeed before the deploy has settled, and can't say why one failed.
- An alias can be present while the deploy is still in progress, and a missing one is not a
  status.
- wrangler 4 does the same: 4.159.0 still asks five times and still exits 0 with "couldn't
  ascertain". garmin-map also pins 3.114.17 on purpose.

The timeout (180 s) and failing rather than warning on timeout were proposed on 2026-11-09 and
went ahead with the owner's go; either can change without a new input.

### Consequences

- Good, because "Preview ready" now means Cloudflare said the deployment is live.
- Good, because a slow Cloudflare gets 3 minutes rather than wrangler's 31 s.
- Bad, because a deployment that would have gone live after 180 s fails the job: re-run it.
- Neutral: a caller's production deploy that calls wrangler directly has the same gap; it can
  run `verify.mjs` the same way, as a change in that repository.
