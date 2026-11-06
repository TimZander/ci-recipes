#!/usr/bin/env python3
"""Billed GitHub Actions minutes for pull requests.

Usage: ci_minutes.py [--repo OWNER/NAME] <pr-number>...   (needs `gh`, authorised for the repo)

The repository is --repo, else $GITHUB_REPOSITORY, else the `origin` remote of the current
directory. First written for TimZander/AudioClassifier (its #1057, ADR 0522).

For each PR it counts every Actions run on the PR's head branch, plus the runs on its merge commit
(the deploy). Each run's jobs are fetched with `filter=all`, so re-run attempts count. A
`pull_request_target` run such as sdd-checks also carries the PR's branch as `head_branch`, so it's
included. One line per PR: runs, jobs, billed minutes, the unrounded minutes, and a split by
workflow.

Billed minutes round EACH JOB up to a whole minute, as GitHub bills them (Linux at 1x: every job
is assumed to run on ubuntu-latest, and other runners bill at other rates). Public repositories
are not billed at all; the number is still what the PR would cost on a private one. The per-run
`timing` endpoint would be simpler, but it returned `billable: 0` for AudioClassifier. The account's own usage endpoints are out of reach of a cloud
session, which is scoped to repository endpoints. So this is a measure of what the PR spent, not
a read of the invoice.

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


def pr_report(repo, pr):
    p = _api(f"repos/{repo}/pulls/{pr}")[0]
    runs = _runs(repo, f"branch={p['head']['ref']}")
    if p.get("merged_at") and p.get("merge_commit_sha"):
        runs.update(_runs(repo, f"head_sha={p['merge_commit_sha']}"))
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
