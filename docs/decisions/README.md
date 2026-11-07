# Decision records

MADR records, one per file, numbered in order. Copy `template.md`. A record that replaces
an earlier one marks the old one superseded rather than editing it.

| # | Decision | Status |
|---|---|---|
| [0001](0001-shared-ci-lives-in-its-own-public-repository.md) | Shared CI lives in its own public repository | accepted |
| [0002](0002-composite-actions-not-reusable-workflows.md) | Composite actions, not reusable workflows | superseded by 0005 |
| [0003](0003-previews-are-not-gated-by-tests.md) | Previews are not gated by tests; production is | accepted |
| [0004](0004-pins-move-with-ci-update-not-dependabot.md) | Callers' pins move with `/ci:update`, not Dependabot | accepted |
| [0005](0005-reusable-workflows-own-the-rules.md) | Callers reference reusable workflows; the rules live in ci-recipes once | accepted |
| [0006](0006-previews-build-the-head-and-fetch-ci-recipes-after-the-build.md) | Previews build the PR head, and fetch ci-recipes only after the build | accepted |
| [0007](0007-a-workflow-skips-only-paths-it-never-reads.md) | A workflow skips a pull request only when it changes nothing that workflow reads | accepted |
