---
status: accepted
date: 2026-11-08
decision-makers: the owner
---
# Previews can cache a caller's downloads, with `cache-path` and `cache-key`

## Context and Problem Statement

A preview's build is one bash command (`build-command`), so it can't use `actions/cache`.
AudioClassifier's preview stages about 49 MB of pinned model and runtime files from Zenodo and
jsdelivr, and its own workflow caches them. On ci-recipes' previews it would download them on
every run: slower, and a preview would fail whenever Zenodo is down. A build that needs
something the inputs can't set up gets a new input in ci-recipes first (STANDARD.md, "What
stays in each repository").

## Considered Options

- Two optional inputs on both previews, `cache-path` (one path per line) and `cache-key`:
  one `actions/cache` step before the build
- No cache: download on every preview
- A caller-provided setup action run before the build

## Decision Outcome

Chosen option: **`cache-path` and `cache-key`** (the owner, 2026-11-08), because it is the
smallest compatible change: both default to empty, and an empty `cache-path` skips the step,
so every existing caller is unchanged. Callers can't pass a step to a reusable workflow, and
a setup action named by an input would run code that no pin covers.

- The step runs after the checkout and before the build, so the build finds the files and
  skips the download. `actions/cache` saves them when the job ends.
- A run restores from its own scope and the default branch's, and saves only into its own (a
  pull request's or a branch's). So a pull request's build can't change what the default
  branch restores, and a cache helps every pull request only if something on the default
  branch, such as the production deploy, saves the same paths under the same key.
- The refuse step fails a call that sets one input without the other.

### Consequences

- Good, because a large pinned download is fetched once per key, not once per push.
- Good, because the cache step is the only new code, and it is a pinned third-party action.
- Bad, because the key is the caller's to change: a key left alone after a pinned file changes
  restores the old file. The caller's build should check what it restores, as AudioClassifier's
  staging scripts check digests.
