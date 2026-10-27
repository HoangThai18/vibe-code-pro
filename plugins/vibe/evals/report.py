#!/usr/bin/env python3
"""report.py: terminal report of `claude plugin eval` results, with the skills vs without.

Shows the overall score, how often the skill loaded, the cost, every case sorted by the
difference the skills make, a summary per skill, and what needs a look (cases worse with
the skills, skills that never loaded, graders that never pass). Standard library only,
Python 3.8+.

  python3 report.py                                  latest results/*/aggregate-result.json
  python3 report.py published/1.3.0.json             the published numbers, no eval run needed
  python3 report.py run.json rerun.json              a later file replaces cases with the same name
  python3 report.py run.json --compare published/1.3.0.json
  python3 report.py --brief                          totals and what needs a look
  python3 report.py --case spring-rls-session-set    pass counts per grader
  python3 report.py run.json --save summary.json     a small summary without traces or paths

Input: the JSON of `claude plugin eval --json <file>`, its results/<time>/aggregate-result.json,
or a summary written by --save.
"""
import argparse
import glob
import json
import os
import re
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SUMMARY_FORMAT = "vibe-eval-summary/1"
SAME = 0.005  # scores print with two decimals: a smaller gap shows as +0.00, so it counts as no difference


def summarize_run(data):
    """One `claude plugin eval` result -> summary dict (no traces, prompts or local paths)."""
    plugins = data.get("suite", {}).get("plugins") or [{}]
    plugin = " ".join(str(plugins[0][k]) for k in ("name", "version") if plugins[0].get(k))
    cases = []
    for c in data["cases"]:
        with_runs = c["arms"].get("with", [])
        without_runs = c["arms"].get("without", [])
        # A skill indicator is the with-only "did the skill load" grader; a Skill grader with max: 0 is a scored guard
        flagged = {g["name"] for r in with_runs for g in r.get("graders", []) if g.get("withOnly")}
        skills = {}
        for g in c.get("graders", []):
            cfg = g.get("config", {})
            if g.get("type") != "tool_used" or cfg.get("tool") != "Skill":
                continue
            if g["name"] in flagged or (not without_runs and cfg.get("max") is None):
                skills[g["name"]] = skill_label(cfg.get("input_match", ""), g["name"])
        graders = []
        for g in c.get("graders", []):
            entry = {"name": g["name"], "with": count_passed(with_runs, g["name"])}
            if g["name"] in skills:
                entry["skill"] = skills[g["name"]]
            elif without_runs:
                entry["without"] = count_passed(without_runs, g["name"])
            graders.append(entry)
        agg = c.get("aggregates", {})
        cases.append({
            "name": c["name"],
            "runs": len(with_runs),
            "with": round(agg.get("score", 0.0), 4),
            "without": round(agg["scoreWithout"], 4) if without_runs and "scoreWithout" in agg else None,
            "cost": [mean_cost(with_runs), mean_cost(without_runs)],
            "errors": sum(1 for r in with_runs + without_runs if r.get("error")),
            "graders": graders,
        })
    return {
        "format": SUMMARY_FORMAT,
        "plugin": plugin,
        "claude": data.get("claudeVersion", ""),
        "date": (data.get("startedAt") or "")[:10],
        "costUsd": round(data.get("costUsd") or 0.0, 2),
        "cases": cases,
    }


def skill_label(pattern, fallback):
    """'...vibe-backend"' -> vibe-backend; '...vibe-(?:ship|backend)"' -> vibe-ship/backend."""
    m = re.search(r"vibe-(?:\((?:\?:)?)?([\w|-]+)", pattern)
    return "vibe-" + m.group(1).replace("|", "/") if m else fallback


def count_passed(runs, grader):
    return sum(1 for r in runs for g in r.get("graders", []) if g["name"] == grader and g.get("passed"))


def mean_cost(runs):
    return round(sum(r.get("costUsd") or 0.0 for r in runs) / len(runs), 4) if runs else None


def load(paths):
    """Read result or summary files and merge them; a later file replaces cases with the same name."""
    merged, cases = None, {}
    for path in paths:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        summary = data if data.get("format") == SUMMARY_FORMAT else summarize_run(data)
        if merged is None:
            merged = dict(summary, costUsd=0.0)
        merged["costUsd"] = round(merged["costUsd"] + summary["costUsd"], 2)
        merged["date"] = max(merged["date"], summary["date"])
        merged["claude"] = summary["claude"] or merged["claude"]
        merged["plugin"] = summary["plugin"] or merged["plugin"]
        for c in summary["cases"]:
            cases[c["name"]] = c
    merged["cases"] = [cases[k] for k in sorted(cases)]
    return merged


def latest_results():
    found = sorted(glob.glob(os.path.join(HERE, "results", "*", "aggregate-result.json")))
    return found[-1:] if found else []


def totals(summary):
    cases = summary["cases"]
    paired = [c for c in cases if c["without"] is not None]
    marked = [(c, indicator(c)) for c in cases if indicator(c)]
    runs_with = sum(c["runs"] for c in cases)
    cost_with = sum((c["cost"][0] or 0) * c["runs"] for c in cases)
    cost_without = sum((c["cost"][1] or 0) * c["runs"] for c in paired)
    return {
        "cases": len(cases),
        "runs": max((c["runs"] for c in cases), default=0),
        "with": avg([c["with"] for c in cases]),
        "without": avg([c["without"] for c in paired]) if paired else None,
        "better": sum(1 for c in paired if c["with"] - c["without"] > SAME),
        "worse": sum(1 for c in paired if c["without"] - c["with"] > SAME),
        "loaded": sum(g["with"] for _, g in marked),
        "load_runs": sum(c["runs"] for c, _ in marked),
        "cost_with": cost_with / runs_with if runs_with else 0.0,
        "cost_without": cost_without / sum(c["runs"] for c in paired) if paired else None,
    }


def indicator(case):
    """The case's "did the skill load" grader, or None."""
    return next((g for g in case["graders"] if "skill" in g), None)


def avg(xs):
    return sum(xs) / len(xs) if xs else 0.0


class Out:
    """Terminal output: ANSI colors only on a terminal, ASCII when the terminal can't print block characters."""

    def __init__(self, color, width, unicode):
        self.color, self.width, self.unicode = color, width, unicode
        self.lines = []

    def paint(self, text, code):
        return f"\033[{code}m{text}\033[0m" if self.color else text

    def bar(self, value, width):
        value = max(0.0, min(1.0, value))
        if not self.unicode:
            return ("#" * round(value * width)).ljust(width)
        eighths = round(value * width * 8)
        full, rest = divmod(eighths, 8)
        return ("█" * full + (" ▏▎▍▌▋▊▉"[rest] if rest else "")).ljust(width)

    def sym(self, fancy, plain):
        return fancy if self.unicode else plain

    def add(self, line=""):
        self.lines.append(line)


def delta_text(out, d, width=0):
    text = f"{d:+.2f}".replace("-", out.sym("−", "-")).rjust(width)
    if d > SAME:
        return out.paint(text, "32")
    if d < -SAME:
        return out.paint(text, "31")
    return out.paint(text, "2")


def render(summary, out, top=0, sort="delta", compare=None, brief=False):
    t = totals(summary)
    dot = out.sym(" · ", " | ")
    head = [summary["plugin"] or "plugin", f"Claude Code {summary['claude']}" if summary["claude"] else "",
            summary["date"], f"{t['cases']} cases {out.sym('×', 'x')} {t['runs']} runs", f"spent ${summary['costUsd']:.2f}"]
    out.add(out.paint(dot.join(h for h in head if h), "1"))
    out.add()
    bw = max(10, min(24, (out.width - 40) // 2))
    if t["without"] is None:
        out.add(f"  Score          {t['with']:.2f} {out.bar(t['with'], bw)}  (no baseline arm: run with --ablation with-without)")
    else:
        out.add(f"  {'':13}  {'with skills':<{bw + 5}}  without")
        out.add(f"  Score          {t['with']:.2f} {out.bar(t['with'], bw)}  {t['without']:.2f} {out.bar(t['without'], bw)}  "
                + delta_text(out, t["with"] - t["without"]))
        same = t["cases"] - t["better"] - t["worse"]
        out.add(f"  Cases          better {t['better']}{dot}same {same}{dot}worse {t['worse']}")
    if t["load_runs"]:
        out.add(f"  Skill loaded   {t['loaded']}/{t['load_runs']} runs ({t['loaded'] / t['load_runs']:.0%})")
    if t["cost_without"]:
        out.add(f"  Cost per run   ${t['cost_with']:.2f} vs ${t['cost_without']:.2f} "
                f"({t['cost_with'] / t['cost_without']:.2f}{out.sym('×', 'x')})")
    if compare:
        render_compare(summary, compare, out)
    if not brief:
        render_cases(summary, out, top, sort, bw)
        render_skills(summary, out)
    render_attention(summary, out)
    return out.lines


def render_cases(summary, out, top, sort, bw):
    cases = list(summary["cases"])
    keys = {
        "delta": lambda c: (-(c["with"] - (c["without"] if c["without"] is not None else c["with"])), c["name"]),
        "with": lambda c: (c["with"], c["name"]),
        "name": lambda c: c["name"],
    }
    cases.sort(key=keys[sort])
    shown = cases[:top] if top else cases
    nw = min(36, max(len(c["name"]) for c in cases)) if cases else 10
    cbw = max(4, min(12, (out.width - nw - 30) // 2))
    out.add()
    out.add(out.paint(f"  {'Case':<{nw}}  {'With':<{cbw + 5}}  {'Without':<{cbw + 5}}  {out.sym('Δ', 'd'):>5}  Skill", "1"))
    for c in shown:
        name = c["name"] if len(c["name"]) <= nw else c["name"][:nw - 1] + out.sym("…", "~")
        ind = indicator(c)
        skill = f"{ind['with']}/{c['runs']}" if ind else ""
        if c["without"] is None:
            line = f"  {name:<{nw}}  {c['with']:.2f} {out.bar(c['with'], cbw)}"
        else:
            line = (f"  {name:<{nw}}  {c['with']:.2f} {out.bar(c['with'], cbw)}  {c['without']:.2f} {out.bar(c['without'], cbw)}  "
                    + delta_text(out, c["with"] - c["without"], 5))
        out.add(f"{line}  {skill}")
    if len(shown) < len(cases):
        out.add(out.paint(f"  {out.sym('…', '...')} {len(cases) - len(shown)} more cases (--top 0 shows all)", "2"))


def render_skills(summary, out):
    groups = {}
    for c in summary["cases"]:
        ind = indicator(c)
        groups.setdefault(ind["skill"] if ind else "(no skill check)", []).append((c, ind))
    sw = max(len(k) for k in groups) if groups else 5
    out.add()
    out.add(out.paint(f"  {'Skill':<{sw}} {'Cases':>5}  {'With':>4}  {'Without':>7}  {out.sym('Δ', 'd'):>5}  Loaded", "1"))
    for skill, items in sorted(groups.items(), key=lambda kv: (kv[0].startswith("("), -len(kv[1]), kv[0])):
        cases = [c for c, _ in items]
        paired = [c for c in cases if c["without"] is not None]
        w = avg([c["with"] for c in cases])
        line = f"  {skill:<{sw}} {len(cases):>5}  {w:.2f}"
        if paired:
            wo = avg([c["without"] for c in paired])
            line += f"  {wo:>7.2f}  " + delta_text(out, avg([c["with"] for c in paired]) - wo, 5)
        loads = [(g["with"], c["runs"]) for c, g in items if g]
        if loads:
            line += f"  {sum(a for a, _ in loads)}/{sum(b for _, b in loads)}"
        out.add(line)


def render_attention(summary, out):
    notes = []
    for c in summary["cases"]:
        if c["without"] is not None and c["without"] - c["with"] > SAME:
            notes.append(f"{c['name']}: worse with the skills ({c['with']:.2f} vs {c['without']:.2f})")
    never = [c["name"] for c in summary["cases"] if indicator(c) and indicator(c)["with"] == 0]
    if never:
        notes.append("skill never loaded: " + ", ".join(never))
    for c in summary["cases"]:
        for g in c["graders"]:
            if "skill" not in g and g["with"] == 0 and not g.get("without"):
                notes.append(f"{c['name']} / {g['name']}: never passed, with or without the skills (check the grader or the case)")
    errors = sum(c.get("errors", 0) for c in summary["cases"])
    if errors:
        notes.append(f"{errors} run{'s' if errors != 1 else ''} ended with an error (a timeout or interruption counts as a failed run)")
    out.add()
    out.add(out.paint("  Needs a look" if notes else "  Nothing needs a look", "1"))
    for n in notes:
        out.add(out.paint(f"  {out.sym('•', '-')} {n}", "33"))


def render_compare(summary, base, out):
    mine = {c["name"]: c for c in summary["cases"]}
    theirs = {c["name"]: c for c in base["cases"]}
    common = sorted(set(mine) & set(theirs))
    arrow = out.sym("→", "->")
    out.add()
    out.add(out.paint(f"  Compared with {base['plugin'] or 'the baseline'} ({base['date']}), {len(common)} cases in both", "1"))
    if not common:
        return
    a, b = avg([theirs[n]["with"] for n in common]), avg([mine[n]["with"] for n in common])
    out.add(f"  With skills    {a:.2f} {arrow} {b:.2f}  " + delta_text(out, b - a))
    pw = [n for n in common if mine[n]["without"] is not None and theirs[n]["without"] is not None]
    if pw:
        a, b = avg([theirs[n]["without"] for n in pw]), avg([mine[n]["without"] for n in pw])
        out.add(f"  Without        {a:.2f} {arrow} {b:.2f}  " + delta_text(out, b - a))
    moved = sorted(common, key=lambda n: -abs(mine[n]["with"] - theirs[n]["with"]))
    for n in [n for n in moved if abs(mine[n]["with"] - theirs[n]["with"]) >= 0.1][:5]:
        out.add(f"    {n}: {theirs[n]['with']:.2f} {arrow} {mine[n]['with']:.2f}  " + delta_text(out, mine[n]["with"] - theirs[n]["with"]))
    only_mine, only_base = sorted(set(mine) - set(theirs)), sorted(set(theirs) - set(mine))
    if only_mine:
        out.add(f"  Only in this run: {', '.join(only_mine)}")
    if only_base:
        out.add(f"  Only in the baseline: {', '.join(only_base)}")


def render_case(summary, name, out):
    matches = [c for c in summary["cases"] if c["name"] == name] or [c for c in summary["cases"] if name in c["name"]]
    if len(matches) != 1:
        names = ", ".join(c["name"] for c in matches) or "none"
        out.add(f"--case {name}: {'several cases match' if matches else 'no case matches'} ({names})")
        return False
    c = matches[0]
    head = f"{c['name']}  {c['with']:.2f}"
    if c["without"] is not None:
        head += f" vs {c['without']:.2f} (" + delta_text(out, c["with"] - c["without"]) + ")"
    cost = f"${c['cost'][0]:.3f}" + (f" vs ${c['cost'][1]:.3f}" if c["cost"][1] is not None else "")
    out.add(out.paint(head, "1") + f"  {c['runs']} runs, {cost} per run")
    nw = max(len(g["name"]) for g in c["graders"]) + 16
    out.add(out.paint(f"  {'Grader':<{nw}}  With  Without", "1"))
    for g in c["graders"]:
        label = g["name"] + (f" (loads {g['skill']})" if "skill" in g else "")
        wo = f"{g['without']}/{c['runs']}" if "without" in g else out.sym("–", "-")
        line = f"  {label:<{nw}}  {g['with']}/{c['runs']:<3} {wo}"
        if "without" in g and g["with"] != g["without"]:
            line = out.paint(line, "32" if g["with"] > g["without"] else "31")
        out.add(line)
    return True


def can_print(text):
    try:
        text.encode(getattr(sys.stdout, "encoding", None) or "utf-8")
        return True
    except (UnicodeEncodeError, LookupError):
        return False


def main(argv=None):
    p = argparse.ArgumentParser(description="Terminal report of claude plugin eval results, with vs without the skills.")
    p.add_argument("files", nargs="*", help="eval result JSON files or summaries (default: the latest results/*/aggregate-result.json)")
    p.add_argument("--compare", metavar="FILE", help="another result or summary to compare with, e.g. published/1.3.0.json")
    p.add_argument("--case", metavar="NAME", help="pass counts per grader for one case")
    p.add_argument("--brief", action="store_true", help="only the totals and what needs a look")
    p.add_argument("--top", type=int, default=0, metavar="N", help="show only the first N cases (0: all)")
    p.add_argument("--sort", choices=["delta", "with", "name"], default="delta", help="case order (default: delta)")
    p.add_argument("--save", metavar="FILE", help="write the merged summary (no traces or local paths) to FILE")
    p.add_argument("--width", type=int, default=0, help="output width (default: the terminal's)")
    p.add_argument("--no-color", action="store_true", help="no ANSI colors (also when NO_COLOR is set)")
    args = p.parse_args(argv)

    files = args.files or latest_results()
    if not files:
        print("No eval results found. Run an eval with --json, or view the published numbers:\n"
              "  claude plugin eval ./plugins/vibe --runs 5 --no-publish --trust-plugin --scaffold "
              '--allow-tools "Bash" "Write" "Edit" --json run.json\n'
              f"  python3 {os.path.relpath(__file__)} {os.path.relpath(os.path.join(HERE, 'published', '1.3.0.json'))}",
              file=sys.stderr)
        return 2
    summary = load(files)
    if args.save:
        with open(args.save, "w", encoding="utf-8") as f:
            json.dump(summary, f, ensure_ascii=False, indent=1)
            f.write("\n")

    color = not args.no_color and "NO_COLOR" not in os.environ and sys.stdout.isatty()
    if color and os.name == "nt":
        os.system("")  # turns on ANSI escape handling in the classic Windows console
    width = args.width or shutil.get_terminal_size((100, 24)).columns
    out = Out(color, width, can_print("█▏×Δ→–…•−"))
    if args.case:
        ok = render_case(summary, args.case, out)
        print("\n".join(out.lines))
        return 0 if ok else 1
    render(summary, out, top=args.top, sort=args.sort, compare=load([args.compare]) if args.compare else None, brief=args.brief)
    print("\n".join(out.lines))
    return 0


if __name__ == "__main__":
    sys.exit(main())
