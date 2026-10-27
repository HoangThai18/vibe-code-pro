"""Tests for plugins/vibe/evals/report.py: summary, merge, report sections, the README sample."""
import contextlib
import io
import json
import os
import re
import shlex
import sys
import tempfile
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "plugins", "vibe", "evals"))
import report  # noqa: E402

SKILL = {"name": "skill-backend", "type": "tool_used", "weight": 1,
         "config": {"tool": "Skill", "input_match": '"skill"\\s*:\\s*"(?:[\\w-]+:)?vibe-backend"'}}
GUARD = {"name": "05-no-process-skills", "type": "tool_used", "weight": 1,
         "config": {"tool": "Skill", "input_match": "vibe-(plan|build)", "max": 0}}


def run(score, passed, cost=0.2, error=None, indicator=None):
    graders = [{"name": n, "passed": p, "withOnly": False} for n, p in passed.items()]
    if indicator is not None:
        graders.append({"name": "skill-backend", "passed": indicator, "withOnly": True})
    return {"score": score, "costUsd": cost, "error": error, "tracePath": "/tmp/x/trace.jsonl", "graders": graders}


def case(name, score, without, graders, with_runs, without_runs):
    return {"name": name, "graders": graders, "arms": {"with": with_runs, "without": without_runs},
            "aggregates": {"score": score, "scoreWithout": without}}


def result(cases, cost=1.5, started="2026-10-27T09:00:00Z"):
    return {"schemaVersion": 1, "claudeVersion": "2.1.311", "startedAt": started, "costUsd": cost,
            "suite": {"root": "/home/me/secret", "plugins": [{"name": "vibe", "version": "9.9.9"}]}, "cases": cases}


def sample():
    a = case("spring", 0.75, 0.25, [{"name": "01-fix", "type": "llm"}, {"name": "02-never", "type": "llm"}, SKILL],
             [run(1.0, {"01-fix": True, "02-never": False}, indicator=True), run(0.5, {"01-fix": True, "02-never": False}, indicator=False)],
             [run(0.5, {"01-fix": True, "02-never": False}, cost=0.1), run(0.0, {"01-fix": False, "02-never": False}, cost=0.1)])
    b = case("small", 0.5, 1.0, [{"name": "01-ok", "type": "regex"}, GUARD],
             [run(0.5, {"01-ok": False, "05-no-process-skills": True}), run(0.5, {"01-ok": True, "05-no-process-skills": False}, error="timeout")],
             [run(1.0, {"01-ok": True, "05-no-process-skills": True}, cost=0.1), run(1.0, {"01-ok": True, "05-no-process-skills": True}, cost=0.1)])
    return result([a, b])


def write(tmp, name, data):
    path = os.path.join(tmp, name)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f)
    return path


def text(summary, **kw):
    out = report.Out(color=False, width=100, unicode=True)
    report.render(summary, out, **kw)
    return "\n".join(out.lines)


class Summary(unittest.TestCase):
    def test_counts_and_indicator(self):
        s = report.summarize_run(sample())
        spring = s["cases"][0]
        self.assertEqual((spring["with"], spring["without"], spring["runs"]), (0.75, 0.25, 2))
        self.assertEqual(spring["graders"][0], {"name": "01-fix", "with": 2, "without": 1})
        self.assertEqual(spring["graders"][2], {"name": "skill-backend", "with": 1, "skill": "vibe-backend"})
        self.assertEqual(spring["cost"], [0.2, 0.1])

    def test_skill_guard_is_scored_not_an_indicator(self):
        small = report.summarize_run(sample())["cases"][1]
        self.assertEqual(small["graders"][1], {"name": "05-no-process-skills", "with": 1, "without": 2})
        self.assertEqual(small["errors"], 1)

    def test_no_local_paths_or_traces(self):
        dumped = json.dumps(report.summarize_run(sample()))
        self.assertNotIn("/tmp/x", dumped)
        self.assertNotIn("/home/me", dumped)

    def test_skill_label(self):
        self.assertEqual(report.skill_label('"(?:[\\w-]+:)?vibe-(?:ship|backend)"', "x"), "vibe-ship/backend")
        self.assertEqual(report.skill_label("nothing", "skill-x"), "skill-x")

    def test_later_file_replaces_case_and_costs_add_up(self):
        with tempfile.TemporaryDirectory() as tmp:
            first = write(tmp, "a.json", sample())
            rerun = sample()
            rerun["cases"] = [dict(rerun["cases"][0], aggregates={"score": 1.0, "scoreWithout": 0.25})]
            rerun["startedAt"] = "2026-10-28T09:00:00Z"
            merged = report.load([first, write(tmp, "b.json", rerun)])
        self.assertEqual([c["name"] for c in merged["cases"]], ["small", "spring"])
        self.assertEqual(merged["cases"][1]["with"], 1.0)
        self.assertEqual((merged["costUsd"], merged["date"]), (3.0, "2026-10-28"))

    def test_saved_summary_loads_back(self):
        with tempfile.TemporaryDirectory() as tmp:
            src = write(tmp, "run.json", sample())
            saved = os.path.join(tmp, "summary.json")
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(report.main([src, "--save", saved, "--no-color"]), 0)
            self.assertEqual(report.load([saved]), report.load([src]))


class Render(unittest.TestCase):
    def test_overview(self):
        t = text(report.summarize_run(sample()))
        self.assertIn("vibe 9.9.9 · Claude Code 2.1.311 · 2026-10-27 · 2 cases × 2 runs · spent $1.50", t)
        self.assertRegex(t, r"Score\s+0\.62 .*0\.62 .*\+0\.00")
        self.assertIn("better 1 · same 0 · worse 1", t)
        self.assertIn("Skill loaded   1/2 runs (50%)", t)
        self.assertIn("Cost per run   $0.20 vs $0.10 (2.00×)", t)

    def test_needs_a_look(self):
        t = text(report.summarize_run(sample()))
        self.assertIn("small: worse with the skills (0.50 vs 1.00)", t)
        self.assertIn("spring / 02-never: never passed", t)
        self.assertIn("1 run ended with an error", t)
        self.assertNotIn("01-fix: never passed", t)

    def test_cases_sorted_by_delta_and_top(self):
        t = text(report.summarize_run(sample()), top=1)
        self.assertRegex(t, r"spring\s+0\.75")
        self.assertNotRegex(t, r"\n  small\s+0\.50")
        self.assertIn("1 more cases", t)

    def test_brief_has_no_tables(self):
        t = text(report.summarize_run(sample()), brief=True)
        self.assertNotIn("Case ", t)
        self.assertIn("Needs a look", t)

    def test_ascii_when_the_terminal_cannot_print_blocks(self):
        out = report.Out(color=False, width=100, unicode=False)
        report.render(report.summarize_run(sample()), out)
        self.assertTrue(all(ord(ch) < 128 for line in out.lines for ch in line))

    def test_colors_only_when_asked(self):
        out = report.Out(color=True, width=100, unicode=True)
        report.render(report.summarize_run(sample()), out)
        self.assertIn("\033[32m", "\n".join(out.lines))
        self.assertNotIn("\033[", text(report.summarize_run(sample())))

    def test_case_view(self):
        out = report.Out(color=False, width=100, unicode=True)
        self.assertTrue(report.render_case(report.summarize_run(sample()), "spri", out))
        t = "\n".join(out.lines)
        self.assertRegex(t, r"01-fix\s+2/2\s+1/2")
        self.assertRegex(t, r"skill-backend \(loads vibe-backend\)\s+1/2\s+–")
        self.assertFalse(report.render_case(report.summarize_run(sample()), "nope", report.Out(False, 100, True)))

    def test_compare(self):
        base = report.summarize_run(sample())
        mine = json.loads(json.dumps(base))
        mine["cases"][0]["with"] = 1.0
        mine["cases"].append(dict(mine["cases"][0], name="new-case"))
        t = text(mine, compare=base)
        self.assertIn("Compared with vibe 9.9.9 (2026-10-27), 2 cases in both", t)
        self.assertIn("spring: 0.75 → 1.00  +0.25", t)
        self.assertIn("Only in this run: new-case", t)

    def test_no_results_found(self):
        with tempfile.TemporaryDirectory() as tmp:
            old, report.HERE = report.HERE, tmp
            try:
                with contextlib.redirect_stderr(io.StringIO()) as err:
                    self.assertEqual(report.main([]), 2)
            finally:
                report.HERE = old
        self.assertIn("No eval results found", err.getvalue())


class Published(unittest.TestCase):
    PATH = os.path.join(ROOT, "plugins", "vibe", "evals", "published", "1.3.0.json")

    def test_matches_the_readme_numbers(self):
        t = report.totals(report.load([self.PATH]))
        self.assertEqual((t["cases"], t["runs"]), (41, 5))
        self.assertEqual((round(t["with"], 2), round(t["without"], 2)), (0.97, 0.78))
        self.assertEqual((t["loaded"], t["load_runs"]), (155, 185))
        self.assertEqual(round(t["cost_with"] / t["cost_without"], 2), 1.40)

    def test_readme_samples_are_real_output(self):
        for name in ("README.md", "README.vi.md"):
            with open(os.path.join(ROOT, name), encoding="utf-8") as f:
                doc = f.read()
            blocks = re.findall(r"<!-- report-sample: (.+?) -->\n```text\n(.*?)\n```\n<!-- /report-sample -->", doc, re.S)
            self.assertTrue(blocks, f"{name}: no report sample")
            for cmd, shown in blocks:
                args = shlex.split(cmd)[2:]
                cwd = os.getcwd()
                os.chdir(ROOT)
                try:
                    with contextlib.redirect_stdout(io.StringIO()) as got:
                        report.main(args)
                finally:
                    os.chdir(cwd)
                self.assertEqual(got.getvalue().rstrip("\n"), shown, f"{name}: rerun `{cmd}` and paste its output")


if __name__ == "__main__":
    unittest.main()
