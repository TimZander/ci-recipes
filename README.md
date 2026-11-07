# ci-recipes

Shared CI for Tim Zander's repositories: Cloudflare Pages previews, their teardown, and a
CI-minutes counter. **[STANDARD.md](STANDARD.md)** says what every repository's CI does
and why. This repository holds the code that does it.

| Path | What it is |
|---|---|
| `.github/workflows/pages-preview.yml` | **What a repository calls**: a reusable workflow that builds with the caller's command, deploys preview `pr-<number>` and posts its comment. Owns the concurrency and the fork guard. |
| `.github/workflows/pages-teardown.yml` | **What a repository calls**: a reusable workflow that tears down on close (in the PR's preview group) or sweeps. |
| `actions/pages-preview` | A composite action: deploy a built directory as preview `pr-<number>` and post or update the pull request's one preview comment. |
| `actions/pages-teardown` | A composite action: delete a closed pull request's previews (`mode: pr`), or every preview no open pull request claims (`mode: sweep`). |
| `templates/` | The small caller workflows (triggers, build inputs, secrets) a repository starts from. `/ci:init` (the `ci` plugin in TimZander/claude) fills them in. |
| `scripts/ci_minutes.py` | A pull request's billed Actions minutes: `scripts/ci_minutes.py --repo OWNER/NAME <pr>...` (needs `gh`). |
| `docs/decisions/` | Why it is built this way. |

## Using it

Call the reusable workflow, pinned to a commit SHA, never a branch or tag:

```yaml
jobs:
  preview:
    if: github.event.pull_request.head.repo.full_name == github.repository
    permissions: { contents: read, pull-requests: write }
    uses: TimZander/ci-recipes/.github/workflows/pages-preview.yml@<sha>
    with:
      project-name: my-site
      directory: dist
      wrangler-version: '4.142.0'
      node-version: '22'            # optional; node-cache defaults to npm
      build-command: npm ci && npm run build
    secrets:
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

`templates/` has both callers in full. The actions under `actions/` still work as steps on
their own, but a caller that uses them directly takes on the concurrency and guards itself.
Everything runs on the runner's own Node.js, with nothing to install. The caller needs the repository secrets `CLOUDFLARE_API_TOKEN` (Pages: Edit) and
`CLOUDFLARE_ACCOUNT_ID`.

## Developing

```bash
node --test 'tests/*.test.mjs'
python3 -m unittest discover -s tests
```

`tests/workflows.test.mjs` checks the reusable workflows and the templates line by line,
each rule with a positive control. `tests/scripts.e2e.test.mjs` runs both scripts against a local fake of the GitHub and
Cloudflare APIs. A change to either API's real behaviour still needs a real run: the first
caller to adopt a change is its live test.
