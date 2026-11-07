# The CI standard

How every repository here runs CI, and why. A repository calls the reusable workflows in
`.github/workflows/` (`pages-preview.yml`, `pages-teardown.yml`), pinned to one commit, and
keeps only its triggers, its build and its secrets; the rules below live in those workflows
and the `actions/` they run, once. `templates/` holds the small callers a repository starts
from. Each rule
names the incident it came from, so a rule that has stopped earning its place can be
recognised and cut. Decisions behind these rules are in `docs/decisions/`.

## 1. The preview runs before the tests, never after them

A pull request's preview deploys in its own job, in parallel with the tests, and does not
wait for them. **Production deploys only after the tests pass.**

- A red test must not block UAT. In painting the preview waited for an ~11-minute suite,
  and in timzander.com it ran after `npm test` in the same job, so a failing test meant no
  preview at all.
- A preview is cheap (about a billed minute) and changes nothing anyone else sees.
- The preview workflow therefore holds the build and nothing else. It is not a gate: the
  tests are.

- **A preview is built from the pull request's head commit**, the one its comment names, not
  from GitHub's default merge with the base, which changes whenever the base moves.
- **The build runs the pull request's own code, in the job that then deploys with the
  Cloudflare token.** Only a same-repository pull request gets a preview, so its author can
  already change the workflows; what the shared job guards against is the build's own
  dependencies. Nothing of ci-recipes is on disk while the build runs: it is checked out
  afterwards, verified against the pinned commit, and run straight away. A process the build
  leaves running in the background could still interfere; keep the token's scope to Pages: Edit.

## 2. One name for a preview: `pr-<number>`

Deploy a preview with `--branch=pr-<number>`, never the head branch name.

- Cloudflare keeps 28 characters of a branch in the alias hostname, so two long branch names
  can share one preview (garmin-map #164).
- A head branch named `main` would deploy to production.
- The teardown matches on this exact value. It is written in one place,
  `actions/pages-preview`, so the two cannot drift.

## 3. One preview comment

The comment starts with `<!-- cf-preview-deploy -->` and is updated in place on every push.

- It is found by **author and prefix**: the Actions bot's comment that *starts with* the
  marker. A comment that merely quotes the marker, such as a spec diff, is never
  overwritten (timzander.com).
- **Every page of comments is read.** Reading only the first page posts a second comment on
  a long thread.
- It shows the **stable link** (the `pr-<number>` alias, for a phone bookmark) only when
  Cloudflare returned one, and always the **per-commit link**. A per-commit URL labelled
  "stable" goes stale on the next push (garmin-map).
- An optional note line carries anything repository-specific ("public maps only").
- The same text goes into the job's step summary.
- When the pull request closes, the teardown edits it to say the preview is gone.

## 4. Teardown on close, plus a sweep

- **On close:** delete that pull request's `pr-<number>` previews, unless it has been
  reopened. The close runs in that pull request's own preview concurrency group, so it cancels
  a preview still building (which would otherwise deploy after it), and closes never queue
  behind each other, where GitHub keeps one pending run per group and drops the rest
  (garmin-map's conformance review).
- **Weekly sweep:** delete every preview no open pull request claims, either as
  `pr-<number>` or as its head branch. The sweep is what catches a failed teardown, a fork's
  pull request, and previews from before a repository adopted `pr-<number>`. AudioClassifier
  had 82 stale previews before its teardown was found never to have worked.
- Production is never deleted. Two guards hold this independently: the environment must be
  `preview`, and the branch must not be the project's production branch, read from
  Cloudflare rather than assumed to be `main`.
- Every page of deployments is listed before anything is deleted, because deleting while
  paging shifts pages and skips deployments. No `per_page` is sent, because the API rejects
  values over 25.

## 5. Pins

- Every `uses:` is pinned to a **commit SHA**, with the tag in a comment.
- **wrangler is an exact version**, never a range, so a deploy cannot change without a
  commit (AudioClassifier #527).
- A repository pins **one ci-recipes commit** for both its preview and its teardown. The
  reusable workflows check out ci-recipes at `job.workflow_sha`, the commit they were called
  at, and refuse to run any other, so that one pin covers every script they run.
- **Pins move forward with `/ci:update`, run when wanted**, not with Dependabot. Every
  Dependabot pull request spends CI minutes (decision 0004, revisitable).
- The cloud agents' git proxy refuses tag writes, so a release tag is made in the GitHub web
  UI or not at all. Callers pin SHAs, so nothing depends on a tag.

## 6. Cost: measure minutes

- Report a pull request's billed Actions minutes, alongside the agent's model spend, when
  it merges: `scripts/ci_minutes.py [--repo OWNER/NAME] <pr>...`. It rounds each job up to a
  whole minute, as GitHub bills them, and counts re-runs and the merge's deploy, but not
  the runs a schedule or a dispatch starts on the merge commit later: a daily deploy on the
  default branch's tip was charged to the last merged pull request (timzander.com #164, 23
  minutes).
- **Prefer fewer billed minutes over a shorter wait**, as painting decided (its decision
  0163), with one exception: the preview, where time to UAT wins (rule 1).
- A `pull_request` path filter matches the whole pull request's diff and re-fires on every
  later push. A filter added "so the guard can run" can cost more than the guard saves
  (AudioClassifier #568).
- **A pull request that changes no code runs no tests and no preview.** The preview and the
  test workflows' `pull_request` triggers carry `paths-ignore` for the code-free paths:
  `openspec/**`, `docs/**` and root `*.md`, plus any the repository adds. A skipped workflow
  bills nothing, where a job that reads the diff bills a minute itself. timzander.com #168, an
  archive-only pull request, ran both (decision 0007).
  - The filter is on the whole pull request's diff, so a later push that touches code runs
    everything again.
  - The teardown never has a path filter: a pull request whose code was reverted still closes
    with a preview to delete.
  - A skipped workflow reports no status, so a required check on it never passes. A repository
    that requires one leaves that workflow unfiltered.

## 7. Small things every workflow does

- `concurrency` is keyed on the pull request number for previews and cancels superseded
  runs. Production deploys are serialised and never cancelled.
- Every job has a `timeout-minutes`.
- `actions/checkout` uses `persist-credentials: false` unless the job pushes.
- Scheduled runs use an off-the-hour minute, because GitHub drops `:00` runs under load.
- A fork's pull request gets no preview: it has no secrets. The job is skipped by `if:`, so
  it bills nothing.
- Keep `working-directory` on the folder that holds a Pages `functions/` directory, if there
  is one: wrangler picks up Functions from where it runs (garmin-map's CalTopo relay).

## What stays in each repository

Each repository keeps its own build steps, test jobs, smoke tests and deploy checks; those
differ too much to share. A repository's CLAUDE.md points here, and its adoption is
recorded in its own decision record.
