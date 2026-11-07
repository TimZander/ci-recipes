#!/usr/bin/env python3
"""Billed GitHub Actions minutes for pull requests.

Usage: ci_minutes.py [--repo OWNER/NAME] <pr-number>...   (needs `gh`, authorised for the repo)

The repository is --repo, else $GITHUB_REPOSITORY, else the `origin` remote of the current
directory. First written for TimZander/AudioClassifier (its #1057, ADR 0522).

For each PR it counts the Actions runs that belong to it (`runs_of_pr`): those on its head branch
while it was open, the close-triggered ones at its final head, and the runs its merge started on
the merge commit (the deploy), but not a scheduled or dispatched run there. A branch reused by
several PRs no longer counts every PR's runs against each. Each run's jobs are fetched with
`filter=all`, so re-run attempts count. A `pull_request_target` run such as sdd-checks also
carries the PR's branch as `head_branch`, so it's included. One line per PR: runs, jobs, billed
minutes, the unrounded minutes, and a split by workflow.

Billed minutes round EACH JOB up to a whole minute, as GitHub bills them (Linux at 1x: every job
is assumed to run on ubuntu-latest, and other runners bill at other rates). Public repositories
are not billed at all; the number is still what the PR would cost on a private one. The per-run
`timing` endpoint would be simpler, but it returned `billable: 0` for AudioClassifier. The
account's own usage endpoints are out of reach of a cloud session, which is scoped to repository
endpoints. So this is a measure of what the PR spent, not a read of the invoice.

The arithmetic is `billed_minutes`, a pure function tested in tests/test_ci_minutes.py.
"""
import json
import math
import os
import re
import subprocess
import sys
from datetime import datetime


def repo_from_remote(url):
    """owner/name from a GitHub remote URL (https or ssh, with or without .git), else None."""
    m = re.search(r"github\.com[:/]+([^/\s]+)/([^/\s]+?)(?:\.git)?/?$", url.strip())
    return f"{m.group(1)}/{m.group(2)}" if m else None


def resolve_repo(argv, env, remote_url):
    """(repo, remaining args): --repo wins, then $GITHUB_REPOSITORY, then the origin remote."""
    args = list(argv)
    if "--repo" in args:
        i = args.index("--repo")
        if i + 1 >= len(args):
            raise SystemExit("--repo needs OWNER/NAME")
        repo = args[i + 1]
        del args[i:i + 2]
    else:
        repo = env.get("GITHUB_REPOSITORY") or (remote_url and repo_from_remote(remote_url))
    if not repo or not re.fullmatch(r"[\w.-]+/[\w.-]+", repo):
        raise SystemExit("cannot tell the repository: pass --repo OWNER/NAME")
    return repo, args


def _t(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def job_seconds(job):
    """Seconds a job ran, or 0 for one that never started or hasn't finished."""
    if not (job.get("started_at") and job.get("completed_at")):
        return 0.0
    return max(0.0, (_t(job["completed_at"]) - _t(job["started_at"])).total_seconds())


def billed_minutes(jobs):
    """Each job rounded up to a whole minute, then summed."""
    return sum(math.ceil(job_seconds(j) / 60) for j in jobs)


def _api(path):
    out = subprocess.run(["gh", "api", "--paginate", path],
                         capture_output=True, text=True, check=True).stdout.strip()
    dec, i, objs = json.JSONDecoder(), 0, []
    while i < len(out):  # --paginate concatenates one JSON object per page
        obj, i = dec.raw_decode(out, i)
        objs.append(obj)
        while i < len(out) and out[i].isspace():
            i += 1
    return objs


def _runs(repo, query):
    return {r["id"]: r for page in _api(f"repos/{repo}/actions/runs?{query}&per_page=100")
            for r in page["workflow_runs"]}


# Events that start a run on the merge commit long after the merge, not because of it.
NOT_THE_MERGES = frozenset({"schedule", "workflow_dispatch", "repository_dispatch"})


def runs_of_pr(pr, branch_runs, merge_runs):
    """The runs that belong to one pull request, in id order.

    A branch can carry several PRs one after another (a cloud agent's work branch does), so
    "every run on the head branch" counts each PR's runs against all of them. A PR owns:
    - runs on its branch created while it was open (from created_at to closed_at);
    - after it closed, only runs at its final head commit: the close-triggered teardown, not
      the next PR's pushes;
    - runs on its merge commit that the merge started (the deploy), and not those a schedule
      or a dispatch started there later (NOT_THE_MERGES): the default branch's tip stays the
      last merged PR's merge commit until the next merge, so a daily deploy or a manual
      re-run lands on it, and is not that PR's cost. A `workflow_run` chained off the merge's
      push is counted (one chained off a schedule would be too: its trigger is not on the run).
    Runs from pushes before the PR was opened are not counted.
    """
    opened = _t(pr["created_at"])
    closed = _t(pr["closed_at"]) if pr.get("closed_at") else None
    head = pr["head"]["sha"]
    picked = {}
    for r in branch_runs:
        at = _t(r["created_at"])
        if at < opened:
            continue
        if closed is None or at <= closed or r["head_sha"] == head:
            picked[r["id"]] = r
    for r in merge_runs:
        if r.get("event") not in NOT_THE_MERGES:
            picked[r["id"]] = r
    return [picked[k] for k in sorted(picked)]


def pr_report(repo, pr):
    p = _api(f"repos/{repo}/pulls/{pr}")[0]
    branch_runs = list(_runs(repo, f"branch={p['head']['ref']}").values())
    merge_runs = []
    if p.get("merged_at") and p.get("merge_commit_sha"):
        merge_runs = list(_runs(repo, f"head_sha={p['merge_commit_sha']}").values())
    runs = {r["id"]: r for r in runs_of_pr(p, branch_runs, merge_runs)}
    by_wf, all_jobs = {}, []
    for rid, run in runs.items():
        jobs = [j for page in _api(f"repos/{repo}/actions/runs/{rid}/jobs?filter=all&per_page=100")
                for j in page["jobs"] if job_seconds(j) > 0]
        all_jobs += jobs
        by_wf[run["name"]] = by_wf.get(run["name"], 0) + billed_minutes(jobs)
    exact = sum(job_seconds(j) for j in all_jobs) / 60
    split = ", ".join(f"{k} {v}" for k, v in sorted(by_wf.items(), key=lambda kv: -kv[1]))
    return (f"#{pr}\truns {len(runs)}\tjobs {len(all_jobs)}\tbilled {billed_minutes(all_jobs)} min"
            f"\t(unrounded {exact:.1f})\t{split}")


def _origin_url():
    r = subprocess.run(["git", "remote", "get-url", "origin"], capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else None


if __name__ == "__main__":
    repo, prs = resolve_repo(sys.argv[1:], os.environ, _origin_url())
    if not prs or not all(p.isdigit() for p in prs):
        sys.exit(__doc__.split("\n\n")[1])
    for n in prs:
        print(pr_report(repo, n))
