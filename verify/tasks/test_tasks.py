"""Unit tests for plugins/vibe/skills/vibe-tasks/scripts/tasks.py (standard library only, Python 3.8+).

    python3 -m unittest discover -s verify/tasks -v
"""

import contextlib
import importlib.util
import io
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SKILL = ROOT / "plugins" / "vibe" / "skills" / "vibe-tasks"
SCRIPT = SKILL / "scripts" / "tasks.py"
MINI_CRM = SKILL / "examples" / "mini-crm"

sys.dont_write_bytecode = True  # keep __pycache__ out of the skill folder
spec = importlib.util.spec_from_file_location("tasks", str(SCRIPT))
tasks = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tasks)


def card_text(task_id, status="todo", deps=(), touches=("src/x.ts",), lane="BE", phase=None, title="Do it"):
    phase = phase or task_id.split("-")[0]
    return textwrap.dedent(f"""\
        ---
        id: {task_id}
        title: {title}
        phase: {phase}
        lane: {lane}
        status: {status}
        deps: [{", ".join(deps)}]
        touches: [{", ".join(touches)}]
        size: M
        ---

        ## Goal
        Something.
        """)


class Project:
    """A temporary project with docs/tasks (and optionally docs/plan/PHASES.md)."""

    def __init__(self, test):
        tmp = tempfile.TemporaryDirectory()
        test.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.dir = self.root / "docs" / "tasks"
        self.dir.mkdir(parents=True)

    def card(self, task_id, **fields):
        self.write(f"{task_id}-task.md", card_text(task_id, **fields))
        return self

    def write(self, name, text):
        (self.dir / name).write_text(text, encoding="utf-8")
        return self

    def phases(self, text):
        plan = self.root / "docs" / "plan"
        plan.mkdir(parents=True, exist_ok=True)
        (plan / "PHASES.md").write_text(textwrap.dedent(text), encoding="utf-8")
        return self

    def run(self, *args):
        return run(*args, "--dir", str(self.dir))


def run(*args):
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = tasks.main(list(args))
    return code, out.getvalue()


def task_from(text, name="P1-T01-x.md"):
    meta, issues = tasks.read_frontmatter(text)
    return tasks.Task(Path(name), meta, issues)


class ParserTest(unittest.TestCase):
    def test_inline_lists_comments_and_quotes(self):
        meta = tasks.parse_frontmatter(textwrap.dedent("""\
            ---
            id: P1-T03   # comment
            title: "Fix #12: login"
            deps: [P1-T01, 'P1-T02']   # after the list
            touches: []
            ---
            """))
        self.assertEqual(meta["id"], "P1-T03")
        self.assertEqual(meta["title"], "Fix #12: login")
        self.assertEqual(meta["deps"], ["P1-T01", "P1-T02"])
        self.assertEqual(meta["touches"], [])

    def test_unquoted_hash_starts_a_comment(self):
        meta = tasks.parse_frontmatter("---\nid: P1-T01\ntitle: Fix #12 login\n---\n")
        self.assertEqual(meta["title"], "Fix")

    def test_block_list(self):
        meta = tasks.parse_frontmatter("---\nid: P1-T01\ntouches:\n  - apps/api/**\n  - 'apps/web/x.ts'\n---\n")
        self.assertEqual(meta["touches"], ["apps/api/**", "apps/web/x.ts"])

    def test_multiline_list_with_dynamic_segments_keeps_every_item(self):
        meta = tasks.parse_frontmatter(textwrap.dedent("""\
            ---
            id: P1-T01
            touches: [
              apps/web/app/[locale]/dashboard/[id]
              , apps/web/src/routes.tsx
            ]
            size: S
            ---
            """))
        self.assertEqual(meta["touches"], ["apps/web/app/[locale]/dashboard/[id]", "apps/web/src/routes.tsx"])
        self.assertEqual(meta["size"], "S")

    def test_multiline_list_with_brace_globs(self):
        meta = tasks.parse_frontmatter("---\nid: P1-T01\ntouches: [a/{b,c}/**,\n  d.ts]\n---\n")
        self.assertEqual(meta["touches"], ["a/{b,c}/**", "d.ts"])

    def test_unclosed_list_is_reported(self):
        t = task_from("---\nid: P1-T01\ntouches: [a.ts,\n  b.ts\n---\n")
        self.assertEqual(t.touches, ["a.ts", "b.ts"])
        self.assertTrue(any("not closed" in issue for issue in t.issues))

    def test_bracketed_text_is_a_scalar(self):
        meta = tasks.parse_frontmatter("---\nid: P1-T01\ntitle: [WIP] Login\nstatus: doing\n---\n")
        self.assertEqual(meta["title"], "[WIP] Login")
        self.assertEqual(meta["status"], "doing")

    def test_apostrophe_inside_an_item(self):
        meta = tasks.parse_frontmatter("---\nid: P1-T01\ntouches: [docs/it's.md, b.ts]\n---\n")
        self.assertEqual(meta["touches"], ["docs/it's.md", "b.ts"])

    def test_bom_and_crlf(self):
        meta = tasks.parse_frontmatter("\ufeff---\r\nid: P1-T01\r\ndeps: [P0-T01]\r\n---\r\n")
        self.assertEqual(meta["deps"], ["P0-T01"])

    def test_not_a_card(self):
        self.assertIsNone(tasks.parse_frontmatter("# Notes\n"))
        meta, issues = tasks.read_frontmatter("---\nid: P1-T01\n")
        self.assertIsNone(meta)
        self.assertIn("not closed", issues[0])

    def test_status_alias_and_default_phase(self):
        t = task_from("---\nid: P2-T01\nstatus: In Progress\n---\n")
        self.assertEqual(t.status, "doing")
        self.assertEqual(t.phase, "P2")


class ConflictTest(unittest.TestCase):
    def overlap(self, a, b):
        return tasks.overlaps(a, b) and tasks.overlaps(b, a)

    def test_dynamic_files_are_literal(self):
        self.assertFalse(self.overlap("pages/customers/[id].tsx", "pages/customers/index.tsx"))
        self.assertTrue(self.overlap("pages/customers/[id].tsx", "pages/customers/[id].tsx"))
        self.assertFalse(self.overlap("app/[[...slug]]/page.tsx", "app/[[...slug]]/layout.tsx"))
        self.assertTrue(self.overlap("apps/web/app/[locale]/**", "apps/web/app/[locale]/page.tsx"))

    def test_globs(self):
        self.assertTrue(self.overlap("apps/api/**", "apps/api/src/x.ts"))
        self.assertTrue(self.overlap("apps/api/src/*.ts", "apps/api/src/x.ts"))
        self.assertFalse(self.overlap("apps/a*", "apps/b/x.ts"))
        self.assertFalse(self.overlap("apps/web/features/list/**", "apps/web/features/form/**"))
        self.assertTrue(self.overlap("apps/web/src/routes.tsx", "apps/web/src/routes.tsx"))

    def make(self, task_id, lane, touches):
        return task_from(card_text(task_id, lane=lane, touches=touches), f"{task_id}.md")

    def test_two_db_tasks_conflict_even_with_different_files(self):
        a = self.make("P1-T01", "DB", ["db/migrations/0005_x.sql"])
        b = self.make("P1-T02", "DB", ["db/migrations/0006_y.sql"])
        self.assertIn("DB schema", tasks.conflict(a, b))

    def test_migrations_folder_counts_in_any_lane(self):
        a = self.make("P1-T01", "BE", ["prisma/migrations/20260101_x/migration.sql", "apps/api/a.ts"])
        b = self.make("P1-T02", "DB", ["db/schema/b.ts"])
        self.assertIn("DB schema", tasks.conflict(a, b))

    def test_disjoint_tasks_are_safe(self):
        a = self.make("P1-T01", "BE", ["apps/api/**"])
        b = self.make("P1-T02", "FE", ["apps/web/**"])
        self.assertIsNone(tasks.conflict(a, b))

    def test_two_migrations_never_share_a_batch(self):
        p = Project(self)
        p.card("P1-T01", lane="DB", touches=["db/migrations/0005_x.sql"])
        p.card("P1-T02", lane="DB", touches=["db/migrations/0006_y.sql"])
        code, out = p.run("waves", "--max-parallel", "3")
        self.assertNotIn("(parallel)", out)
        self.assertIn("both change the DB schema", out)


class CheckTest(unittest.TestCase):
    def test_example_is_valid(self):
        code, out = run("check", "--dir", str(MINI_CRM))
        self.assertEqual(code, 0, out)
        self.assertIn("9 task cards valid", out)

    def test_zero_cards_is_an_error(self):
        code, out = Project(self).run("check")
        self.assertEqual(code, 1)
        self.assertIn("no task cards found", out)

    def test_files_that_are_not_cards_are_errors(self):
        p = Project(self).card("P1-T01")
        p.write("P1-T02-notes.md", "# Just notes\n")
        p.write("P1-T03-open.md", "---\nid: P1-T03\nstatus: todo\n")
        p.write("P1-T04-noid.md", "---\ntitle: x\n---\n")
        p.write("README.md", "# Task cards\n")
        p.write("_draft.md", "draft\n")
        code, out = p.run("check")
        self.assertEqual(code, 1)
        self.assertIn("P1-T02-notes.md: no frontmatter", out)
        self.assertIn("P1-T03-open.md: frontmatter is not closed", out)
        self.assertIn("P1-T04-noid.md: frontmatter has no id", out)
        self.assertNotIn("tasks/README.md", out)
        self.assertNotIn("_draft.md", out)

    def test_reference_errors(self):
        p = Project(self)
        p.card("P1-T01", deps=["P1-T09"])
        p.card("P1-T02", deps=["P1-T02"])
        p.card("P1-T03", deps=["P1-T04"])
        p.card("P1-T04", deps=["P1-T03"])
        p.card("P1-T05", status="started")
        code, out = p.run("check")
        self.assertEqual(code, 1)
        self.assertIn("P1-T01: deps 'P1-T09' does not exist", out)
        self.assertIn("P1-T02: depends on itself", out)
        self.assertIn("dependency cycle: P1-T03 → P1-T04 → P1-T03", out)
        self.assertIn("P1-T05: invalid status 'started'", out)

    def test_duplicate_ids(self):
        p = Project(self).card("P1-T01")
        p.write("P1-T01-copy.md", card_text("P1-T01"))
        code, out = p.run("check")
        self.assertEqual(code, 1)
        self.assertIn("id P1-T01 is duplicated in 2 files", out)

    def test_phase_must_match_the_id(self):
        p = Project(self).card("P1-T05", phase="P2")
        p.write("T-01-other.md", card_text("T-01", phase="P1"))
        code, out = p.run("check")
        self.assertEqual(code, 1)
        self.assertIn("P1-T05: phase P2 does not match the id (phase P1)", out)
        self.assertNotIn("T-01: phase", out)

    def test_unclosed_list_is_an_error(self):
        p = Project(self).write("P1-T01-x.md", "---\nid: P1-T01\ntouches: [a.ts,\n  b.ts\n---\n")
        code, out = p.run("check")
        self.assertEqual(code, 1)
        self.assertIn("P1-T01: list 'touches' is not closed", out)

    def test_missing_touches_is_a_warning(self):
        p = Project(self).card("P1-T01", touches=())
        code, out = p.run("check")
        self.assertEqual(code, 0, out)
        self.assertIn("P1-T01: no touches declared", out)

    def test_db_tasks_without_a_dependency_chain(self):
        p = Project(self)
        p.card("P1-T01", lane="DB", touches=["db/migrations/**"])
        p.card("P1-T02", lane="DB", touches=["db/migrations/**"])
        p.card("P1-T03", lane="BE", touches=["db/migrations/0009.sql"], deps=["P1-T01"])
        code, out = p.run("check")
        self.assertEqual(code, 0, out)
        self.assertIn("P1-T01 and P1-T02 both change the DB schema but neither depends on the other", out)
        self.assertIn("P1-T02 and P1-T03 both change the DB schema", out)
        self.assertNotIn("P1-T01 and P1-T03", out)

    def test_db_chain_ok(self):
        p = Project(self)
        p.card("P1-T01", lane="DB", touches=["db/migrations/**"])
        p.card("P1-T02", lane="BE", touches=["apps/api/**"], deps=["P1-T01"])
        p.card("P1-T03", lane="DB", touches=["db/migrations/**"], deps=["P1-T02"])
        code, out = p.run("check")
        self.assertNotIn("DB schema", out)

    def test_missing_folder(self):
        with self.assertRaises(SystemExit) as raised:
            run("check", "--dir", str(Path(tempfile.gettempdir()) / "no-such-vibe-dir"))
        self.assertIn("not found", str(raised.exception.code))


class NextTest(unittest.TestCase):
    def test_empty_folder(self):
        code, out = Project(self).run("next")
        self.assertEqual(code, 1)
        self.assertIn("No task cards found in", out)
        self.assertNotIn("All tasks done", out)

    def test_only_files_that_are_not_cards(self):
        p = Project(self).write("a.md", "# a\n").write("b.md", "---\nid: P1-T01\n")
        code, out = p.run("next")
        self.assertEqual(code, 1)
        self.assertIn("(2 files skipped", out)

    def test_unknown_phase(self):
        code, out = run("next", "--phase", "P3", "--dir", str(MINI_CRM))
        self.assertEqual(code, 1)
        self.assertIn("No tasks for phase P3", out)

    def test_example(self):
        code, out = run("next", "--dir", str(MINI_CRM))
        self.assertEqual(code, 0)
        self.assertIn("Phase P1", out)
        self.assertIn("Continue first: P1-T02", out)
        self.assertIn("P1-T04 [FE] Customer list screen  (finish the running task first)", out)

    def test_lowest_unfinished_phase_first(self):
        p = Project(self)
        p.card("P0-T01", status="done")
        p.card("P1-T01", deps=["P0-T01"], touches=["a.ts"])
        p.card("P2-T01", deps=["P0-T01"], touches=["b.ts"])
        for i in range(2, 5):  # P2-T01 unblocks more tasks than P1-T01
            p.card(f"P2-T0{i}", deps=["P2-T01"], touches=[f"c{i}.ts"])
        code, out = p.run("next")
        self.assertEqual(code, 0)
        self.assertIn("Phase P1", out)
        self.assertIn("Start now:\n  - P1-T01", out)
        self.assertNotIn("P2-T01", out.split("Start now:")[1])
        code, out = p.run("next", "--phase", "P2")
        self.assertIn("Start now:\n  - P2-T01", out)

    def test_within_a_phase_prefer_what_unblocks_most(self):
        p = Project(self)
        p.card("P1-T01", touches=["a.ts"])
        p.card("P1-T02", touches=["b.ts"])
        p.card("P1-T03", deps=["P1-T02"], touches=["c.ts"])
        code, out = p.run("next")
        self.assertIn("Start now:\n  - P1-T02", out)

    def test_review_first_when_working_alone(self):
        p = Project(self)
        p.card("P1-T01", status="review", touches=["a.ts"])
        p.card("P1-T02", touches=["b.ts"])
        code, out = p.run("next")
        self.assertEqual(code, 0)
        self.assertIn("Review first: P1-T01 (/vibe-check P1-T01)", out)
        self.assertNotIn("Start now", out)

    def test_parallel_mode_starts_other_work_during_review(self):
        p = Project(self)
        p.card("P1-T01", status="review", touches=["a.ts"])
        p.card("P1-T02", touches=["a.ts"])
        p.card("P1-T03", touches=["b.ts"])
        code, out = p.run("next", "--max-parallel", "2")
        self.assertIn("Start now:\n  - P1-T03", out)
        self.assertIn("conflicts with P1-T01 (review, not merged)", out)

    def test_blocked_tasks_are_listed(self):
        p = Project(self).card("P1-T01", status="blocked")
        code, out = p.run("next")
        self.assertIn("Blocked (the user must decide", out)
        self.assertIn("No task is ready in P1", out)

    def test_phase_done_points_to_the_next_phase(self):
        p = Project(self)
        p.card("P0-T01", status="done")
        p.card("P1-T01", status="done")
        p.phases("""\
            # Phases: Spa CRM
            | Phase | Goal | Status |
            |---|---|---|
            | P0 | Foundation | done |
            | P1 | Customers | doing |
            | P2 | Booking | todo |

            ## P0: Foundation
            ## P1: Customers
            ## P2: Booking
            """)
        code, out = p.run("next")
        self.assertEqual(code, 0)
        self.assertIn("All 1 task of P1 done.", out)
        self.assertIn("/vibe-check phase P1", out)
        self.assertIn("phase/P1 → main", out)
        self.assertIn("split the next phase, P2 Booking, into task cards (vibe-tasks skill, Job A)", out)
        self.assertNotIn("All tasks done", out)

    def test_phase_done_without_a_plan(self):
        p = Project(self).card("P1-T01", status="done")
        code, out = p.run("next")
        self.assertIn("split the next phase in docs/plan/PHASES.md", out)

    def test_last_phase_done(self):
        p = Project(self).card("P1-T01", status="done").phases("## P1: Customers\n")
        code, out = p.run("next")
        self.assertIn("PHASES.md lists no phase after P1", out)

    def test_done_phase_with_next_phase_split(self):
        p = Project(self).card("P1-T01", status="done").card("P2-T01", deps=["P1-T01"])
        p.phases("## P1: A\n## P2: B\n")
        code, out = p.run("next", "--phase", "P1")
        self.assertIn("Then continue with P2", out)

    def test_cycle_and_unknown_dep_banner(self):
        p = Project(self)
        p.card("P1-T01", touches=["a.ts"])
        p.card("P1-T02", deps=["P1-T03"], touches=["b.ts"])
        p.card("P1-T03", deps=["P1-T02"], touches=["c.ts"])
        p.card("P1-T04", deps=["P1-T99"], touches=["d.ts"])
        code, out = p.run("next")
        self.assertEqual(code, 1)
        self.assertTrue(out.startswith("✖ 3 card errors, run `check`"), out)
        self.assertIn("dependency cycle", out)
        self.assertIn("deps 'P1-T99' does not exist", out)
        self.assertIn("Start now:\n  - P1-T01", out)

    def test_duplicate_banner(self):
        p = Project(self).card("P1-T01")
        p.write("P1-T01-copy.md", card_text("P1-T01"))
        code, out = p.run("next")
        self.assertEqual(code, 1)
        self.assertIn("duplicated", out)


class StatusAndWavesTest(unittest.TestCase):
    def test_status_example(self):
        code, out = run("status", "--dir", str(MINI_CRM))
        self.assertEqual(code, 0)
        self.assertIn("Progress: 4/9 tasks done (44%)", out)
        self.assertIn("P1-T03 waits for P1-T02", out)

    def test_status_empty_and_unknown_phase(self):
        code, out = Project(self).run("status")
        self.assertEqual(code, 1)
        self.assertIn("No task cards found", out)
        code, out = run("status", "--phase", "P3", "--dir", str(MINI_CRM))
        self.assertEqual(code, 1)
        self.assertIn("No tasks for phase P3", out)

    def test_status_banner(self):
        p = Project(self).card("P1-T01", deps=["P1-T02"]).card("P1-T02", deps=["P1-T01"])
        code, out = p.run("status")
        self.assertEqual(code, 1)
        self.assertIn("card errors", out)

    def test_waves_example(self):
        code, out = run("waves", "--phase", "P1", "--max-parallel", "3", "--dir", str(MINI_CRM))
        self.assertEqual(code, 0)
        self.assertIn("P1-T04 and P1-T05 both touch apps/web/src/routes.tsx", out)
        self.assertIn("Batch 2.1 (parallel):", out)

    def test_waves_unknown_phase(self):
        code, out = run("waves", "--phase", "P9", "--dir", str(MINI_CRM))
        self.assertEqual(code, 1)


class CliTest(unittest.TestCase):
    def test_runs_as_a_script(self):
        result = subprocess.run([sys.executable, str(SCRIPT), "next", "--dir", str(MINI_CRM)],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("P1-T02", result.stdout.decode("utf-8"))
        empty = tempfile.TemporaryDirectory()
        self.addCleanup(empty.cleanup)
        result = subprocess.run([sys.executable, str(SCRIPT), "next", "--dir", empty.name],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.assertEqual(result.returncode, 1)


if __name__ == "__main__":
    unittest.main()
