# ci-recipes

Shared CI for Tim Zander's repositories: Cloudflare Pages previews, their teardown, and a
CI-minutes counter. **[STANDARD.md](STANDARD.md)** says what every repository's CI does
and why. This repository holds the code that does it.

| Path | What it is |
|---|---|
| `actions/pages-preview` | A composite action: deploy a built directory as preview `pr-<number>` and post or update the pull request's one preview comment. |
| `actions/pages-teardown` | A composite action: delete a closed pull request's previews (`mode: pr`), or every preview no open pull request claims (`mode: sweep`). |
| `templates/` | The caller workflows a repository starts from. `/ci:init` (the `ci` plugin in TimZander/claude) fills them in. |
| `scripts/ci_minutes.py` | A pull request's billed Actions minutes: `scripts/ci_minutes.py --repo OWNER/NAME <pr>...` (needs `gh`). |
| `docs/decisions/` | Why it is built this way. |

## Using it

Pin a commit SHA, never a branch or tag:

```yaml
- uses: TimZander/ci-recipes/actions/pages-preview@<sha>
  with:
    project-name: my-site
    directory: dist
    wrangler-version: '4.142.0'
    api-token: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    account-id: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

Both actions run their scripts on the runner's own Node.js, which has no dependencies to
install. The caller needs the repository secrets `CLOUDFLARE_API_TOKEN` (Pages: Edit) and
`CLOUDFLARE_ACCOUNT_ID`.

## Developing

```bash
node --test 'tests/*.test.mjs'
python3 -m unittest discover -s tests
```

`tests/scripts.e2e.test.mjs` runs both scripts against a local fake of the GitHub and
Cloudflare APIs. A change to either API's real behaviour still needs a real run: the first
caller to adopt a change is its live test.
