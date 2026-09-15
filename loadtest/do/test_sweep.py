"""Tests for the load-test sweeper.

Run from the repo root:  python -m unittest loadtest.do.test_sweep -v
Stdlib only: no doctl, no network, no DigitalOcean token.
"""
import io
import json
import unittest

from loadtest.do import sweep


class FakeDoctl:
    """Stands in for `doctl`: answers list calls from in-memory records and
    removes a record on delete.

    `linger` keeps a deleted record listed for that many further list calls,
    the way DigitalOcean still lists a cluster that is being torn down.
    `list_output` overrides every list response verbatim.
    """

    def __init__(self, apps=(), databases=(), linger=0, list_output=None):
        self.records = {
            "apps": [{"id": f"app-id-{name}", "spec": {"name": name}} for name in apps],
            "databases": [{"id": f"db-id-{name}", "name": name} for name in databases],
        }
        self.linger = linger
        self.ghosts = {"apps": [], "databases": []}
        self.list_output = list_output
        self.calls = []

    def __call__(self, args):
        self.calls.append(list(args))
        kind, verb = args[0], args[1]
        if verb == "list":
            if self.list_output is not None:
                return self.list_output
            visible = self.records[kind] + [record for record, left in self.ghosts[kind] if left > 0]
            self.ghosts[kind] = [[record, left - 1] for record, left in self.ghosts[kind]]
            return json.dumps(visible)
        if verb == "delete":
            for record in list(self.records[kind]):
                if record["id"] == args[2]:
                    self.records[kind].remove(record)
                    self.ghosts[kind].append([record, self.linger])
            return ""
        raise AssertionError(f"unexpected doctl call: {args}")

    def deletes(self):
        return [call for call in self.calls if call[1] == "delete"]


class FindTests(unittest.TestCase):
    def test_matches_exact_names_among_neighbours(self):
        doctl = FakeDoctl(
            apps=["loadtest-app-old", "iflow-test-backend", "loadtest-app"],
            databases=["loadtest-db2", "loadtest-db", "db-postgresql-fra1"],
        )
        self.assertEqual(sweep.find_app_id(doctl), "app-id-loadtest-app")
        self.assertEqual(sweep.find_db_id(doctl), "db-id-loadtest-db")

    def test_similar_names_are_not_leftovers(self):
        doctl = FakeDoctl(
            apps=["loadtest-app-old", "Loadtest-App", "iflow-test-backend"],
            databases=["loadtest-db-backup", "db-postgresql-fra1"],
        )
        self.assertEqual(sweep.leftovers(doctl), [])

    def test_empty_account_listings(self):
        for output in ("", "\n", "null", "[]"):
            with self.subTest(output=output):
                self.assertEqual(sweep.leftovers(FakeDoctl(list_output=output)), [])


class DeleteTests(unittest.TestCase):
    def test_deletes_only_exact_matches_app_first(self):
        doctl = FakeDoctl(
            apps=["iflow-test-backend", "loadtest-app"],
            databases=["db-postgresql-fra1", "loadtest-db"],
        )
        sweep.delete(doctl)
        self.assertEqual(doctl.deletes(), [
            ["apps", "delete", "app-id-loadtest-app", "--force"],
            ["databases", "delete", "db-id-loadtest-db", "--force"],
        ])

    def test_nothing_to_delete(self):
        doctl = FakeDoctl(apps=["iflow-test-backend"], databases=["db-postgresql-fra1"])
        sweep.delete(doctl)
        self.assertEqual(doctl.deletes(), [])


class WaitTests(unittest.TestCase):
    def test_polls_until_a_lingering_cluster_is_gone(self):
        doctl = FakeDoctl(databases=["loadtest-db"], linger=2)
        sweep.delete(doctl)
        sleeps = []
        remaining = sweep.wait_until_gone(doctl, sleep=sleeps.append, attempts=5, interval=7)
        self.assertEqual(remaining, [])
        self.assertEqual(sleeps, [7, 7])

    def test_gives_up_and_reports_what_remains(self):
        doctl = FakeDoctl(databases=["loadtest-db"])
        sleeps = []
        remaining = sweep.wait_until_gone(doctl, sleep=sleeps.append, attempts=3, interval=1)
        self.assertEqual(remaining, ["database loadtest-db"])
        self.assertEqual(sleeps, [1, 1])


class MainTests(unittest.TestCase):
    def run_main(self, argv, doctl):
        out = io.StringIO()
        code = sweep.main(argv, run=doctl, sleep=lambda _seconds: None, out=out)
        return code, out.getvalue()

    def test_verify_passes_on_a_clean_account(self):
        code, output = self.run_main(["verify"], FakeDoctl(apps=["iflow-test-backend"]))
        self.assertEqual(code, 0)
        self.assertIn("nothing left behind", output)

    def test_verify_fails_and_names_leftovers(self):
        code, output = self.run_main(["verify"], FakeDoctl(apps=["loadtest-app"], databases=["loadtest-db"]))
        self.assertEqual(code, 1)
        self.assertIn("app loadtest-app", output)
        self.assertIn("database loadtest-db", output)

    def test_verify_never_deletes(self):
        doctl = FakeDoctl(apps=["loadtest-app"])
        self.run_main(["verify"], doctl)
        self.assertEqual(doctl.deletes(), [])

    def test_delete_then_reports_clean(self):
        doctl = FakeDoctl(apps=["loadtest-app"], databases=["loadtest-db"], linger=1)
        code, output = self.run_main(["delete"], doctl)
        self.assertEqual(code, 0)
        self.assertEqual(len(doctl.deletes()), 2)
        self.assertIn("nothing left behind", output)

    def test_delete_fails_when_a_resource_never_goes_away(self):
        doctl = FakeDoctl(databases=["loadtest-db"], linger=1000)
        code, output = self.run_main(["delete"], doctl)
        self.assertEqual(code, 1)
        self.assertIn("database loadtest-db", output)

    def test_app_id_prints_the_id_or_nothing(self):
        self.assertEqual(self.run_main(["app-id"], FakeDoctl(apps=["loadtest-app"])), (0, "app-id-loadtest-app\n"))
        self.assertEqual(self.run_main(["app-id"], FakeDoctl()), (0, "\n"))

    def test_unknown_command_is_a_usage_error(self):
        code, output = self.run_main(["destroy-everything"], FakeDoctl(apps=["loadtest-app"]))
        self.assertEqual(code, 2)
        self.assertIn("usage", output)


if __name__ == "__main__":
    unittest.main()
