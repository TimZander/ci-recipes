---
status: accepted
date: 2026-11-06
decision-makers: the owner
---
# Shared CI lives in its own public repository

## Context and Problem Statement

Four repositories (AudioClassifier, garmin-map, painting, timzander.com) each grew their own
Cloudflare Pages preview, comment and teardown. A survey on 2026-11-06 found them inconsistent
in preview names (head branch against `pr-<number>`), comment markers (`cf-preview-deploy`
against `painting-preview`), how the old comment is found (first page only, any author) and
teardown (on close, sweep, or both). The owner wanted one standard that a new repository can
pick up, and asked whether it should be documentation or living, shared YAML.

## Considered Options

- A `ci` plugin inside TimZander/claude, holding both the code and the installer
- A new public repository for the code, with the installer as a plugin in TimZander/claude
- Documentation only, each repository copying from it

## Decision Outcome

Chosen by the owner: **a new public repository**, TimZander/ci-recipes. GitHub Actions can
load code only from a repository named in `uses:`, never from a Claude plugin, so the code has
to live in a repository either way. A separate one keeps the CI code's history, tests and
pinning apart from the plugins'. It is public, so callers need no access setting
(a private repository's actions are usable elsewhere only after its Actions settings share
them), and so the standard can be read, and linked from a blog post, by anyone.

### Consequences

- Good, because a fix lands once, and each caller adopts it by moving a pin.
- Good, because the standard and the code that enforces it are reviewed in the same pull
  request.
- Bad, because there is one more repository to keep current, and its public visibility
  means nothing private may be committed to it.
- Neutral: the installer, `/ci:init`, still lives in TimZander/claude, because plugins are
  how skills reach a session.
