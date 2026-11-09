---
status: accepted
date: 2026-11-09
decision-makers: the owner
---
# Previews can set up Python with uv, with `python-version`

## Context and Problem Statement

The preview workflows set up only Node (`node-version`). painting's site is built by `uv run python -m painting build` on Python 3.13, so it could not adopt the shared preview. A build's toolchain must come from somewhere before `build-command` runs, and STANDARD.md says a preview's build is its `build-command`, never added steps.

## Considered Options

- **A `python-version` input** to `pages-preview.yml` and `pages-branch-preview.yml`, running a SHA-pinned `astral-sh/setup-uv` with that Python before the build, skipped when empty.
- **Install uv inside `build-command`**, as `pip install uv==<version>` on the runner's own Python: no ci-recipes change, but every Python caller repeats it, and the runner's Python is whatever the image carries.

## Decision Outcome

Chosen option: **a `python-version` input**, because the owner chose it (2026-11-09) and it keeps the toolchain in one place, as `node-version` does. It is a new input with an empty default, so no caller's pin changes behaviour. setup-uv's own cache, keyed on `uv.lock`, makes repeat builds cheap. Tests pin that the step runs only when the input is set, gets that Python, and comes before the build.

### Consequences

- Good, because a Python site adopts the preview with one input and its usual `uv run` build.
- Good, because uv is pinned by the action's SHA, like every other `uses:`.
- Bad, because setup-uv's cache is saved from a pull request's scope too; that is only uv's package cache, keyed on the lockfile, which a later run of the same pull request reads.
