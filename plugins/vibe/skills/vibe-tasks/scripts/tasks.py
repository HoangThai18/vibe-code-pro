#!/usr/bin/env python3
"""tasks.py: helper for vibe task cards.

Reads Markdown task cards (default: docs/tasks/) and runs:
  check   find errors: files that aren't cards, duplicate ids, unknown deps, cycles, phase/id mismatch...
  waves   order unfinished tasks into waves; split each wave into parallel batches
          so no two tasks in one batch edit the same file/folder or both change the DB schema
  status  progress by phase
  next    what to do now: review first, then the running task, then a ready task of the
          lowest unfinished phase (--max-parallel N suggests a parallel batch)

next, status and waves print card errors first and exit 1 when there are any, or when
there is nothing to show (no cards, unknown phase). Standard library only, Python 3.8+.

  python3 tasks.py check  --dir docs/tasks
  python3 tasks.py waves  --phase P1
  python3 tasks.py waves  --phase P1 --max-parallel 3   # which tasks can run in parallel
  python3 tasks.py status
  python3 tasks.py next

Task card frontmatter:
  ---
  id: P1-T03
  title: Customer CRUD API
  phase: P1
  lane: BE            # DB | BE | FE | MOBILE | DESKTOP | INFRA | QA | DOC
  status: todo        # todo | doing | review | done | blocked
  deps: [P1-T01, P1-T02]
  touches: [apps/api/src/modules/customers/**, apps/api/src/routes.ts]
  size: M             # S | M | L (split L)
  ---
"""

import argparse
import os
import re
import sys
from collections import Counter
from pathlib import Path

STATUSES = ("todo", "doing", "review", "done", "blocked")
# doing = an agent is on it; review = code done but NOT merged. Both still hold their files.
BUSY = ("doing", "review")
STATUS_ALIASES = {
    "pending": "todo", "open": "todo", "backlog": "todo",
    "in-progress": "doing", "in_progress": "doing", "inprogress": "doing", "wip": "doing",
    "in-review": "review", "in_review": "review",
    "complete": "done", "completed": "done", "xong": "done",
    "to-do": "todo", "in progress": "doing", "in review": "review",
}
LANES = ("DB", "BE", "FE", "MOBILE", "DESKTOP", "INFRA", "QA", "DOC")
SIZES = ("S", "M", "L")
SKIP_FILES = {"readme.md", "index.md"}
# Folders holding schema migrations (Rails uses db/migrate).
MIGRATION_DIRS = {"migrations", "migrate"}
# Next.js/SvelteKit dynamic names ([id], [...slug], [[...slug]], [id].tsx) are literal, not globs.
DYNAMIC_PART = re.compile(r"\[\[?(?:\.\.\.)?[\w=-]+\]\]?")
PHASE_ID = re.compile(r"^(P\d+)-", re.IGNORECASE)
MAX_BANNER_ERRORS = 5


def plural(n, word):
    return f"{n} {word}" + ("" if n == 1 else "s")


def natural_key(text):
    return [int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", text)]


# ---------- frontmatter: the YAML subset task cards need ----------

def opens_quote(text, i):
    """A quote starts a quoted value only at the start of a value or list item (so it's/don't stay text)."""
    before = text[:i].rstrip()
    return not before or before[-1] in "[{,"


def strip_comment(value):
    quote = None
    for i, ch in enumerate(value):
        if quote:
            if ch == quote:
                quote = None
        elif ch in "'\"" and opens_quote(value, i):
            quote = ch
        elif ch == "#" and (i == 0 or value[i - 1].isspace()):
            return value[:i].rstrip()
    return value


def unquote(value):
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
        return value[1:-1]
    return value


def bracket_end(text):
    """Index just past the ] that closes the [ at text[0], or None if it is not closed yet."""
    depth, quote = 0, None
    for i, ch in enumerate(text):
        if quote:
            if ch == quote:
                quote = None
        elif ch in "'\"" and opens_quote(text, i):
            quote = ch
        elif ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                return i + 1
    return None


def split_items(inner):
    """Split "a, b, {c,d}" on top-level commas (keeps glob {..} and [..] intact)."""
    items, buf, depth, quote = [], [], 0, None
    for i, ch in enumerate(inner):
        if quote:
            if ch == quote:
                quote = None
        elif ch in "'\"" and opens_quote(inner, i):
            quote = ch
        elif ch in "[{":
            depth += 1
        elif ch in "]}":
            depth -= 1
        elif ch == "," and depth == 0:
            items.append("".join(buf))
            buf = []
            continue
        buf.append(ch)
    items.append("".join(buf))
    return [unquote(item) for item in items if item.strip()]


def read_frontmatter(text):
    """Return (meta, issues). meta is None when the file is not a task card; issues[0] then says why."""
    lines = text.lstrip("\ufeff").splitlines()
    if not lines or lines[0].strip() != "---":
        return None, ["no frontmatter (the first line must be ---)"]
    meta, issues, key, flow = {}, [], None, None
    for line in lines[1:]:
        if line.strip() == "---":
            if flow is not None:  # unclosed [..] list: keep what was read
                meta[key] = split_items(" ".join(flow)[1:].rstrip("]"))
                issues.append(f"list '{key}' is not closed with ]")
            return meta, issues
        if flow is not None:  # [a, b] list spanning several lines
            flow.append(strip_comment(line).strip())
            joined = " ".join(flow)
            end = bracket_end(joined)
            if end is not None:
                meta[key] = split_items(joined[1:end - 1])
                flow = None
            continue
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        item = re.match(r"^\s*-\s+(.*)$", line)
        if item and key is not None and isinstance(meta.get(key), list):
            meta[key].append(unquote(strip_comment(item.group(1))))
            continue
        pair = re.match(r"^([A-Za-z_][\w-]*)\s*:(.*)$", line)
        if not pair:
            continue
        key, raw = pair.group(1), strip_comment(pair.group(2)).strip()
        if not raw:
            meta[key] = []
        elif raw.startswith("["):
            end = bracket_end(raw)
            if end is None:
                flow = [raw]
            elif end == len(raw):
                meta[key] = split_items(raw[1:-1])
            else:  # e.g. "title: [WIP] Login" is text, not a list
                meta[key] = unquote(raw)
        else:
            meta[key] = unquote(raw)
    return None, ["frontmatter is not closed with ---"]


def parse_frontmatter(text):
    return read_frontmatter(text)[0]


def scalar(value):
    if isinstance(value, list):
        return ", ".join(value)
    return (value or "").strip()


def as_list(value):
    if isinstance(value, list):
        return [item.strip() for item in value if item.strip()]
    value = (value or "").strip()
    return split_items(value) if value else []


class Task:
    def __init__(self, path, meta, issues=()):
        self.path = path
        self.issues = list(issues)
        self.id = scalar(meta.get("id"))
        self.title = scalar(meta.get("title"))
        self.declared_phase = scalar(meta.get("phase"))
        self.phase = self.declared_phase or self.id.split("-")[0]
        self.lane = scalar(meta.get("lane")).upper()
        status = scalar(meta.get("status")).lower() or "todo"
        self.status = STATUS_ALIASES.get(status, status)
        self.deps = as_list(meta.get("deps"))
        self.touches = as_list(meta.get("touches"))
        self.size = scalar(meta.get("size")).upper()

    def label(self):
        lane = f"[{self.lane}] " if self.lane else ""
        return f"{self.id} {lane}{self.title}".rstrip()


def load_tasks(directory):
    """Return (tasks, skipped): skipped lists (path, reason) for .md files that are not task cards."""
    root = Path(directory)
    if not root.is_dir():
        sys.exit(f"Task card folder not found: {root}. Use --dir to point to it (default: docs/tasks).")
    tasks, skipped = [], []
    for path in sorted(root.rglob("*.md")):
        if path.name.lower() in SKIP_FILES or path.name.startswith("_"):
            continue
        meta, issues = read_frontmatter(path.read_text(encoding="utf-8"))
        if meta is None:
            skipped.append((path, issues[0]))
            continue
        task = Task(path, meta, issues)
        if not task.id:
            skipped.append((path, "frontmatter has no id"))
            continue
        tasks.append(task)
    tasks.sort(key=lambda t: natural_key(t.id))
    return tasks, skipped


# ---------- file conflicts between tasks ----------

def segments(pattern):
    return [seg for seg in pattern.strip().replace("\\", "/").split("/") if seg not in ("", ".")]


def is_glob(seg):
    return any(c in DYNAMIC_PART.sub("", seg) for c in "*?{[")


def split_pattern(pattern):
    """Split a pattern into (fixed folder segments, literal prefix of the first glob segment or None)."""
    fixed = []
    for seg in segments(pattern):
        if is_glob(seg):
            return fixed, re.split(r"[*?{\[]", seg, maxsplit=1)[0]
        fixed.append(seg)
    return fixed, None


def overlaps(a, b):
    """Can two patterns match the same file? When unsure, assume yes (safer)."""
    fa, pa = split_pattern(a)
    fb, pb = split_pattern(b)
    if len(fa) > len(fb):
        fa, pa, fb, pb = fb, pb, fa, pa
    if fa != fb[:len(fa)]:
        return False
    if len(fa) == len(fb):
        return pa is None or pb is None or pa.startswith(pb) or pb.startswith(pa)
    return pa is None or fb[len(fa)].startswith(pa)


def changes_schema(task):
    """DB-lane tasks and tasks touching a migrations folder: their migrations must run one at a time."""
    return task.lane == "DB" or any(
        seg.lower() in MIGRATION_DIRS for pattern in task.touches for seg in segments(pattern))


def conflict(a, b):
    """Why two tasks must not run at the same time, or None if safe."""
    if changes_schema(a) and changes_schema(b):
        return "both change the DB schema (migrations run one at a time)"
    if not a.touches or not b.touches:
        missing = a if not a.touches else b
        return f"{missing.id} has no touches declared"
    for x in a.touches:
        for y in b.touches:
            if overlaps(x, y):
                return f"both touch {x}" if x == y else f"overlap ({x} ↔ {y})"
    return None


def make_batches(tasks, max_parallel):
    batches = []
    for task in tasks:
        for batch in batches:
            if len(batch) < max_parallel and not any(conflict(task, other) for other in batch):
                batch.append(task)
                break
        else:
            batches.append([task])
    return batches


# ---------- dependencies ----------

def compute_waves(tasks):
    """Order unfinished tasks into waves: wave k depends only on done tasks or earlier waves."""
    by_id = {t.id: t for t in tasks}
    placed = set()
    remaining = {t.id for t in tasks if t.status != "done"}
    waves = []
    while remaining:
        ready = sorted(
            (tid for tid in remaining
             if all(d in by_id and (by_id[d].status == "done" or d in placed) for d in by_id[tid].deps)),
            key=natural_key,
        )
        if not ready:
            break
        placed.update(ready)
        remaining.difference_update(ready)
        waves.append([by_id[tid] for tid in ready])
    return waves, sorted(remaining, key=natural_key)


def find_cycle(ids, by_id):
    ids = set(ids)
    state = {}  # 1 = visiting, 2 = finished
    path = []

    def visit(node):
        state[node] = 1
        path.append(node)
        for dep in by_id[node].deps:
            if dep not in ids or dep == node:  # self-deps are reported on their own
                continue
            if state.get(dep) == 1:
                return path[path.index(dep):] + [dep]
            if dep not in state:
                found = visit(dep)
                if found:
                    return found
        state[node] = 2
        path.pop()
        return None

    for node in sorted(ids, key=natural_key):
        if node not in state:
            found = visit(node)
            if found:
                return found
    return None


def find_cycles(ids, by_id):
    """Every dependency cycle among ids, each as a path that ends where it starts."""
    cycles, left = [], set(ids)
    while True:
        cycle = find_cycle(left, by_id)
        if not cycle:
            return cycles
        cycles.append(cycle)
        left.difference_update(cycle)


def ancestors(task, by_id):
    """Every task this one depends on, directly or indirectly."""
    seen, stack = set(), list(task.deps)
    while stack:
        dep = stack.pop()
        if dep in seen or dep not in by_id:
            continue
        seen.add(dep)
        stack.extend(by_id[dep].deps)
    return seen


def ready_tasks(tasks, by_id):
    return [t for t in tasks
            if t.status == "todo" and all(d in by_id and by_id[d].status == "done" for d in t.deps)]


def unblock_counts(tasks):
    """How many other tasks each task unblocks (directly or indirectly)."""
    children = {t.id: [] for t in tasks}
    for t in tasks:
        for dep in t.deps:
            if dep in children:
                children[dep].append(t.id)
    counts = {}
    for t in tasks:
        seen, stack = set(), list(children[t.id])
        while stack:
            child = stack.pop()
            if child not in seen:
                seen.add(child)
                stack.extend(children[child])
        counts[t.id] = len(seen)
    return counts


def in_phase(task, phase):
    return not phase or task.phase.upper() == phase.upper()


def phases_of(tasks):
    return sorted({t.phase.upper() for t in tasks}, key=natural_key)


def percent(part, whole):
    return round(100 * part / whole) if whole else 0


def bar(part, whole, width=10):
    filled = round(width * part / whole) if whole else 0
    return "█" * filled + "░" * (width - filled)


# ---------- validation, shared by every command ----------

def validate(tasks, skipped):
    errors, warnings = [], []
    for path, reason in skipped:
        errors.append(f"{path}: {reason}. Not a task card? Name it README.md or start its name with _")
    counts = Counter(t.id for t in tasks)
    for task_id, n in sorted(counts.items(), key=lambda item: natural_key(item[0])):
        if n > 1:
            files = ", ".join(str(t.path) for t in tasks if t.id == task_id)
            errors.append(f"id {task_id} is duplicated in {n} files: {files}")
    by_id = {t.id: t for t in tasks}
    for t in tasks:
        for issue in t.issues:
            errors.append(f"{t.id}: {issue}")
        if t.status not in STATUSES:
            errors.append(f"{t.id}: invalid status '{t.status}' (use {', '.join(STATUSES)})")
        id_phase = PHASE_ID.match(t.id)
        if t.declared_phase and id_phase and id_phase.group(1).upper() != t.declared_phase.upper():
            errors.append(f"{t.id}: phase {t.declared_phase} does not match the id (phase {id_phase.group(1)})")
        for dep in t.deps:
            if dep == t.id:
                errors.append(f"{t.id}: depends on itself")
            elif dep not in counts:
                errors.append(f"{t.id}: deps '{dep}' does not exist")
        if not t.title:
            warnings.append(f"{t.id}: missing title")
        if t.lane and t.lane not in LANES:
            warnings.append(f"{t.id}: unusual lane '{t.lane}' (usually {'/'.join(LANES)})")
        if not t.touches and t.status != "done":
            warnings.append(f"{t.id}: no touches declared, so it is never scheduled in parallel with other tasks")
        if t.size == "L":
            warnings.append(f"{t.id}: size L, split it into smaller tasks")
        elif t.size and t.size not in SIZES:
            warnings.append(f"{t.id}: unknown size '{t.size}' (use S/M/L)")
        if not t.path.name.startswith(t.id):
            warnings.append(f"{t.id}: file name {t.path.name} should start with the id")
    _, stuck = compute_waves(tasks)
    if stuck:
        for cycle in find_cycles(stuck, by_id):
            errors.append("dependency cycle: " + " → ".join(cycle))
        errors.append("cannot place in any wave: " + ", ".join(stuck))
    for phase in phases_of(tasks):
        schema = [t for t in tasks if in_phase(t, phase) and t.status != "done" and changes_schema(t)]
        for i, a in enumerate(schema):
            for b in schema[i + 1:]:
                if a.id not in ancestors(b, by_id) and b.id not in ancestors(a, by_id):
                    warnings.append(f"{a.id} and {b.id} both change the DB schema but neither depends on "
                                    f"the other: add a dep so their migrations run in a fixed order")
    return errors, warnings


def print_banner(tasks, skipped):
    """Print card errors before any other output. Returns the exit code (1 if there are errors)."""
    errors, _ = validate(tasks, skipped)
    if not errors:
        return 0
    print(f"✖ {plural(len(errors), 'card error')}, run `check` and fix them first:")
    for message in errors[:MAX_BANNER_ERRORS]:
        print(f"  - {message}")
    if len(errors) > MAX_BANNER_ERRORS:
        print(f"  - ... and {len(errors) - MAX_BANNER_ERRORS} more")
    print()
    return 1


def no_cards(args, skipped):
    extra = f" ({plural(len(skipped), 'file')} skipped: not task cards; run `check`)" if skipped else ""
    print(f"No task cards found in {args.dir}{extra}.")
    print("Split a phase of docs/plan/PHASES.md into task cards first (vibe-tasks skill, Job A).")
    return 1


def no_phase(tasks, phase):
    print(f"No tasks for phase {phase} (phases with task cards: {', '.join(phases_of(tasks))}).")
    return 1


def planned_phases(task_dir):
    """Phases listed in docs/plan/PHASES.md next to the task folder: [(id, name)] in order."""
    plan = Path(task_dir).resolve().parent / "plan" / "PHASES.md"
    try:
        text = plan.read_text(encoding="utf-8")
    except OSError:
        return None
    found = {}
    for line in text.splitlines():
        match = (re.match(r"^\s*#{1,6}\s*(P\d+)\b[\s:.\-–]*(.*)$", line)
                 or re.match(r"^\s*\|\s*(P\d+)\s*\|\s*([^|]*)\|", line))
        if match and not found.get(match.group(1).upper()):
            found[match.group(1).upper()] = match.group(2).strip()
    return sorted(found.items(), key=lambda item: natural_key(item[0]))


def print_phase_done(tasks, phase, args):
    group = [t for t in tasks if in_phase(t, phase)]
    print(f"All {plural(len(group), 'task')} of {phase} done.")
    print(f"Close the phase: review it as a whole (/vibe-check phase {phase}), "
          f"merge phase/{phase} → main (PR), deploy to staging.")
    plan = planned_phases(args.dir)
    later = [(p, name) for p, name in (plan or []) if natural_key(p) > natural_key(phase)]
    if plan is None:
        print("Then split the next phase in docs/plan/PHASES.md into task cards (vibe-tasks skill, Job A) "
              "and show the task table for approval.")
    elif not later:
        print(f"PHASES.md lists no phase after {phase}: the plan is complete. "
              "Ship to production (vibe-ship skill) or plan the next release (vibe-plan skill).")
    else:
        nxt, name = later[0]
        if any(in_phase(t, nxt) for t in tasks):
            print(f"Then continue with {nxt}: it already has task cards (`next --phase {nxt}`).")
        else:
            label = f"{nxt} {name}".strip()
            print(f"Then split the next phase, {label}, into task cards (vibe-tasks skill, Job A) "
                  "and show the task table for approval.")


# ---------- commands ----------

def cmd_check(tasks, skipped, args):
    errors, warnings = validate(tasks, skipped)
    if not tasks:
        errors.append(f"no task cards found in {args.dir}")
    for message in warnings:
        print(f"⚠  {message}")
    for message in errors:
        print(f"✖  {message}")
    if errors:
        print(f"\n{plural(len(errors), 'error')}, {plural(len(warnings), 'warning')} in "
              f"{plural(len(tasks), 'task card')}.")
        return 1
    suffix = f" ({plural(len(warnings), 'warning')})" if warnings else ""
    print(f"{chr(10) if warnings else ''}✔ {plural(len(tasks), 'task card')} valid{suffix}.")
    return 0


def cmd_waves(tasks, skipped, args):
    if not tasks:
        return no_cards(args, skipped)
    if args.phase and not any(in_phase(t, args.phase) for t in tasks):
        return no_phase(tasks, args.phase)
    code = print_banner(tasks, skipped)
    waves, stuck = compute_waves(tasks)
    shown = [w for w in ([t for t in wave if in_phase(t, args.phase)] for wave in waves) if w]
    scope = f"phase {args.phase}" if args.phase else "whole project"
    pending = sum(len(w) for w in shown)
    if not pending and not stuck:
        print(f"No unfinished tasks ({scope}).")
        return code
    solo = args.max_parallel == 1
    if solo:
        print(f"{plural(pending, 'unfinished task')} ({scope}), sequential order (one agent).\n")
    else:
        print(f"{plural(pending, 'unfinished task')} ({scope}), up to {args.max_parallel} agents at once.\n")
    busy_tasks = [t for t in tasks if t.status in BUSY]
    ready_now = set(ready_tasks(tasks, {t.id: t for t in tasks}))
    for i, wave in enumerate(shown, 1):
        runnable = [t for t in wave if t.status == "todo"]
        print(f"Wave {i}")
        for t in wave:
            if t.status in BUSY:
                print(f"  ▶ {t.label()}  ({t.status})")
            elif t.status != "todo":
                print(f"  ⏸ {t.label()}  ({t.status})")
        if solo:
            for t in runnable:
                print(f"  - {t.label()}")
        else:
            for j, batch in enumerate(make_batches(runnable, args.max_parallel), 1):
                mode = "parallel" if len(batch) > 1 else "single task"
                print(f"  Batch {i}.{j} ({mode}):")
                for t in batch:
                    print(f"    - {t.label()}")
            for t in runnable:
                if not t.touches:
                    print(f"  ⚠ {t.id} has no touches declared → runs alone")
            for x, a in enumerate(runnable):
                for b in runnable[x + 1:]:
                    reason = conflict(a, b)
                    if reason and (a.touches and b.touches or changes_schema(a) and changes_schema(b)):
                        print(f"  ⚠ {a.id} and {b.id} {reason} → not in the same batch")
        for a in runnable:
            if a not in ready_now:
                continue
            holder = next((b for b in busy_tasks if conflict(a, b)), None)
            if holder:
                print(f"  ⚠ {a.id} must wait for {holder.id} ({holder.status}, not merged): {conflict(a, holder)}")
        print()
    if stuck:
        print("✖ Cannot place in any wave: " + ", ".join(stuck))
        for cycle in find_cycles(stuck, {t.id: t for t in tasks}):
            print("  Dependency cycle: " + " → ".join(cycle))
        print("  Run `check` for details.")
        return 1
    return code


def cmd_status(tasks, skipped, args):
    if not tasks:
        return no_cards(args, skipped)
    shown = [t for t in tasks if in_phase(t, args.phase)]
    if not shown:
        return no_phase(tasks, args.phase)
    code = print_banner(tasks, skipped)
    by_id = {t.id: t for t in tasks}
    counts = Counter(t.status for t in shown)
    done = counts["done"]
    print(f"Progress: {done}/{len(shown)} tasks done ({percent(done, len(shown))}%) · "
          f"doing {counts['doing']} · review {counts['review']} · "
          f"blocked {counts['blocked']} · todo {counts['todo']}\n")
    phases = phases_of(shown)
    width = max(len(p) for p in phases)
    for phase in phases:
        group = [t for t in shown if in_phase(t, phase)]
        finished = sum(t.status == "done" for t in group)
        print(f"  {phase.ljust(width)}  {bar(finished, len(group))} "
              f"{percent(finished, len(group)):>3}%  {finished}/{len(group)}")
    ready = ready_tasks(shown, by_id)
    sections = [
        ("In progress", [t for t in shown if t.status == "doing"]),
        ("Awaiting review", [t for t in shown if t.status == "review"]),
        ("Blocked", [t for t in shown if t.status == "blocked"]),
        ("Ready now", ready),
        ("Unknown status (fix it)", [t for t in shown if t.status not in STATUSES]),
    ]
    for title, group in sections:
        if group:
            print(f"\n{title}:")
            for t in group:
                print(f"  - {t.label()}")
    waiting = [t for t in shown if t.status == "todo" and t not in ready]
    if waiting:
        print("\nWaiting on deps:")
        for t in waiting:
            unmet = [d for d in t.deps if d not in by_id or by_id[d].status != "done"]
            print(f"  - {t.id} waits for {', '.join(unmet)}")
    return code


def cmd_next(tasks, skipped, args):
    if not tasks:
        return no_cards(args, skipped)
    unfinished = None
    if args.phase:
        phase = args.phase.upper()
        if not any(in_phase(t, phase) for t in tasks):
            return no_phase(tasks, phase)
    else:
        unfinished = phases_of([t for t in tasks if t.status != "done"])
        phase = unfinished[0] if unfinished else phases_of(tasks)[-1]
    code = print_banner(tasks, skipped)
    by_id = {t.id: t for t in tasks}
    scope = [t for t in tasks if in_phase(t, phase)]
    running = [t for t in tasks if t.status == "doing"]
    reviewing = [t for t in tasks if t.status == "review"]
    holding = running + reviewing  # not merged yet, so still holding files
    unlocks = unblock_counts(tasks)
    ready = sorted(ready_tasks(scope, by_id), key=lambda t: (-unlocks[t.id], natural_key(t.id)))
    solo = args.max_parallel == 1

    if not args.phase and len(phases_of(tasks)) > 1 and unfinished:
        print(f"Phase {phase} (lowest phase with unfinished tasks; --phase to choose another)\n")
    if running:
        print("Running:")
        for t in running:
            print(f"  ▶ {t.label()}")
    if reviewing:
        print("Code done, awaiting review and merge:")
        for t in reviewing:
            print(f"  - {t.label()}")
    blocked = [t for t in scope if t.status == "blocked"]
    if blocked:
        print("Blocked (the user must decide; see the card's Notes):")
        for t in blocked:
            print(f"  ⏸ {t.label()}")
    if running or reviewing or blocked:
        print()

    if solo and reviewing:
        first = reviewing[0]
        print(f"Review first: {first.id} (/vibe-check {first.id}). Start new work only after it is merged.")
        return code
    if solo and running:
        print(f"Continue first: {running[0].id} (/vibe-next {running[0].id}).")

    if not ready:
        if not [t for t in scope if t.status != "done"]:
            print_phase_done(tasks, phase, args)
        else:
            print(f"No task is ready in {phase}: the rest are running, awaiting review, waiting on deps, "
                  "or blocked. See `status`.")
            later = [t for t in ready_tasks(tasks, by_id) if natural_key(t.phase) > natural_key(phase)]
            if later and not args.phase:
                print(f"(Later phases have ready tasks: {', '.join(t.id for t in later)}. "
                      f"Finish {phase} first unless the user decides otherwise.)")
        return code

    slots = max(args.max_parallel - len(running), 0)
    pick, wait = [], []
    for t in ready:
        clash = next((other for other in holding + pick if conflict(t, other)), None)
        if clash is None and len(pick) < slots:
            pick.append(t)
        else:
            wait.append((t, clash))

    def unlock_note(task):
        return f"  (unblocks {plural(unlocks[task.id], 'task')})" if unlocks[task.id] else ""

    if pick:
        print("Start now" + (", in parallel (no shared files):" if len(pick) > 1 else ":"))
        for t in pick:
            print(f"  - {t.label()}{unlock_note(t)}")
    if wait:
        print("Ready, but not yet:")
        for t, clash in wait:
            if clash is None:
                if not solo:
                    why = "parallel agent limit reached"
                else:
                    why = "finish the running task first" if running else "one task at a time"
            elif clash.status in BUSY:
                why = f"conflicts with {clash.id} ({clash.status}, not merged): {conflict(t, clash)}"
            else:
                why = f"conflicts with {clash.id}: {conflict(t, clash)}"
            print(f"  - {t.label()}  ({why})")
    return code


def main(argv=None):
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass
    parser = argparse.ArgumentParser(description="Validate task cards, order them into waves, show progress.")
    sub = parser.add_subparsers(dest="command")
    sub.required = True
    commands = {
        "check": (cmd_check, "find errors in task cards"),
        "waves": (cmd_waves, "order waves and parallel batches"),
        "status": (cmd_status, "progress by phase"),
        "next": (cmd_next, "what to do now"),
    }
    for name, (_, help_text) in commands.items():
        cmd = sub.add_parser(name, help=help_text)
        cmd.add_argument("--dir", default="docs/tasks", help="task card folder (default: docs/tasks)")
        if name != "check":
            cmd.add_argument("--phase", help="only tasks of one phase, e.g. P1")
        if name in ("waves", "next"):
            cmd.add_argument("--max-parallel", type=int, default=1,
                             help="max agents running at once (default: 1, sequential)")
    args = parser.parse_args(argv)
    if getattr(args, "max_parallel", 1) < 1:
        parser.error("--max-parallel must be ≥ 1")
    tasks, skipped = load_tasks(args.dir)
    return commands[args.command][0](tasks, skipped, args)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except BrokenPipeError:  # e.g. when piped to `head`
        os.dup2(os.open(os.devnull, os.O_WRONLY), sys.stdout.fileno())
        sys.exit(0)
