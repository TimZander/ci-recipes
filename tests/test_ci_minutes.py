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


if __name__ == "__main__":
    unittest.main()
