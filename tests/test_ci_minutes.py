"""Tests for scripts/ci_minutes.py: how a PR's Actions jobs become billed minutes, and which
repository it measures.

GitHub bills each job rounded UP to a whole minute (Linux at 1x), so a 5-second job costs
1 minute and a 61-second one costs 2.
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import ci_minutes as cm  # noqa: E402


def job(start, end, name="j"):
    return {"name": name, "started_at": start, "completed_at": end}


class BilledMinutes(unittest.TestCase):
    def test_eachJob_roundsUpToAWholeMinute(self):
        jobs = [job("2026-11-06T10:00:00Z", "2026-11-06T10:00:05Z"),   # 5 s  -> 1
                job("2026-11-06T10:00:00Z", "2026-11-06T10:01:01Z"),   # 61 s -> 2
                job("2026-11-06T10:00:00Z", "2026-11-06T10:02:00Z")]   # 120 s -> 2
        self.assertEqual(cm.billed_minutes(jobs), 5)

    def test_roundingIsPerJob_notOnTheSum(self):
        # Three 20 s jobs: summed-then-rounded gives 1, per job gives 3.
        jobs = [job("2026-11-06T10:00:00Z", "2026-11-06T10:00:20Z")] * 3
        self.assertEqual(cm.billed_minutes(jobs), 3)

    def test_aJobThatNeverRanOrIsStillRunning_costsNothing(self):
        jobs = [{"name": "skipped", "started_at": None, "completed_at": None},
                {"name": "running", "started_at": "2026-11-06T10:00:00Z", "completed_at": None},
                job("2026-11-06T10:00:00Z", "2026-11-06T10:00:00Z", "zero")]
        self.assertEqual(cm.billed_minutes(jobs), 0)

    def test_positiveControl_aRealJobIsCounted(self):
        # Guards the skip rule above from swallowing everything.
        self.assertEqual(cm.billed_minutes([job("2026-11-06T10:00:00Z", "2026-11-06T10:14:59Z")]), 15)


class ResolveRepo(unittest.TestCase):
    def test_flagWins_overEnvironmentAndRemote(self):
        repo, rest = cm.resolve_repo(["--repo", "a/b", "12"], {"GITHUB_REPOSITORY": "c/d"},
                                     "https://github.com/e/f")
        self.assertEqual((repo, rest), ("a/b", ["12"]))

    def test_environment_thenRemote(self):
        self.assertEqual(cm.resolve_repo(["1"], {"GITHUB_REPOSITORY": "c/d"}, None)[0], "c/d")
        self.assertEqual(cm.resolve_repo(["1"], {}, "git@github.com:e/f.git\n")[0], "e/f")
        self.assertEqual(cm.resolve_repo(["1"], {}, "https://github.com/TimZander/ci-recipes")[0],
                         "TimZander/ci-recipes")

    def test_noRepository_refuses(self):
        with self.assertRaises(SystemExit):
            cm.resolve_repo(["1"], {}, None)
        with self.assertRaises(SystemExit):
            cm.resolve_repo(["1"], {}, "https://gitlab.com/x/y")
        with self.assertRaises(SystemExit):
            cm.resolve_repo(["--repo"], {}, None)

    def test_aMalformedRepo_isRefused_notPutInAnApiPath(self):
        with self.assertRaises(SystemExit):
            cm.resolve_repo(["--repo", "a/b/../c", "1"], {}, None)


def run(rid, created, sha, branch="b", event="pull_request"):
    return {"id": rid, "created_at": created, "head_sha": sha, "head_branch": branch, "event": event}


def pr(created, closed, head, merge=None):
    return {"created_at": created, "closed_at": closed, "head": {"sha": head, "ref": "b"},
            "merged_at": closed if merge else None, "merge_commit_sha": merge}


class RunsOfAPullRequest(unittest.TestCase):
    """Two PRs on one branch must not claim each other's runs (garmin-map #273-#275 did)."""

    def setUp(self):
        self.first = pr("2026-11-07T00:50:00Z", "2026-11-07T02:51:00Z", "aaa", merge="m1")
        self.second = pr("2026-11-07T02:56:00Z", "2026-11-07T02:58:00Z", "bbb", merge="m2")
        self.branch_runs = [
            run(1, "2026-11-07T00:50:10Z", "a0"),                     # first PR, early push
            run(2, "2026-11-07T02:40:00Z", "aaa"),                    # first PR, last push
            run(3, "2026-11-07T02:51:20Z", "aaa"),                    # first PR's close (teardown)
            run(4, "2026-11-07T02:56:05Z", "bbb"),                    # second PR
            run(5, "2026-11-07T02:58:15Z", "bbb"),                    # second PR's close
            run(6, "2026-11-07T00:40:00Z", "zzz"),                    # before either opened
        ]

    def test_eachPr_getsOnlyItsOwnBranchRuns(self):
        self.assertEqual([r["id"] for r in cm.runs_of_pr(self.first, self.branch_runs, [])], [1, 2, 3])
        self.assertEqual([r["id"] for r in cm.runs_of_pr(self.second, self.branch_runs, [])], [4, 5])

    def test_aRunAfterTheClose_countsOnlyAtThePrsFinalHead(self):
        # the second PR's runs come after the first closed, at another head: not the first's
        ids = [r["id"] for r in cm.runs_of_pr(self.first, self.branch_runs, [])]
        self.assertNotIn(4, ids)
        self.assertNotIn(5, ids)

    def test_mergeCommitRuns_areAdded_once(self):
        deploy = run(9, "2026-11-07T02:51:30Z", "m1", branch="main", event="push")
        got = cm.runs_of_pr(self.first, self.branch_runs, [deploy, deploy])
        self.assertEqual([r["id"] for r in got], [1, 2, 3, 9])

    def test_anOpenPr_hasNoUpperBound(self):
        still_open = pr("2026-11-07T02:56:00Z", None, "bbb")
        self.assertEqual([r["id"] for r in cm.runs_of_pr(still_open, self.branch_runs, [])], [4, 5])

    def test_positiveControl_theOldRuleCountedEverything(self):
        # every branch run, which is what the report did before this change
        self.assertEqual(len(self.branch_runs), 6)
        self.assertLess(len(cm.runs_of_pr(self.first, self.branch_runs, [])), len(self.branch_runs))


if __name__ == "__main__":
    unittest.main()
