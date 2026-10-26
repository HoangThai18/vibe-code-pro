#!/usr/bin/env python3
"""tasks.py: trợ lý cho task card của bộ skill vibe.

Đọc các task card Markdown (mặc định trong docs/tasks/) rồi:
  check   kiểm tra lỗi: id trùng, deps không tồn tại, vòng phụ thuộc, thiếu touches...
  waves   xếp task chưa xong thành các wave; trong mỗi wave chia lượt chạy song song
          sao cho không hai task nào trong cùng lượt sửa chung file/thư mục
  status  bảng tiến độ theo phase
  next    task làm được ngay bây giờ (mặc định một agent; --max-parallel N để gợi ý lượt song song)

Chỉ dùng thư viện chuẩn, chạy với Python 3.8+.

  python3 tasks.py check  --dir docs/tasks
  python3 tasks.py waves  --phase P1
  python3 tasks.py waves  --phase P1 --max-parallel 3   # xem task nào chạy song song được
  python3 tasks.py status
  python3 tasks.py next

Frontmatter của một task card:
  ---
  id: P1-T03
  title: API CRUD khách hàng
  phase: P1
  lane: BE            # DB | BE | FE | MOBILE | DESKTOP | INFRA | QA | DOC
  status: todo        # todo | doing | review | done | blocked
  deps: [P1-T01, P1-T02]
  touches: [apps/api/src/modules/customers/**, apps/api/src/routes.ts]
  size: M             # S | M | L (L nên tách nhỏ)
  ---
"""

import argparse
import os
import re
import sys
from collections import Counter
from pathlib import Path

STATUSES = ("todo", "doing", "review", "done", "blocked")
# doing = agent đang làm; review = code xong nhưng CHƯA merge. Cả hai vẫn đang giữ file của mình.
BUSY = ("doing", "review")
STATUS_ALIASES = {
    "pending": "todo", "open": "todo", "backlog": "todo",
    "in-progress": "doing", "in_progress": "doing", "inprogress": "doing", "wip": "doing",
    "in-review": "review", "in_review": "review",
    "complete": "done", "completed": "done", "xong": "done",
}
LANES = ("DB", "BE", "FE", "MOBILE", "DESKTOP", "INFRA", "QA", "DOC")
SIZES = ("S", "M", "L")
SKIP_FILES = {"readme.md", "index.md"}
# Thư mục động kiểu Next.js ([id], [...slug], [[...slug]]) là tên thật, không phải glob.
DYNAMIC_SEGMENT = re.compile(r"^\[{1,2}(\.\.\.)?[\w.-]+\]{1,2}$")


def natural_key(text):
    return [int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", text)]


# ---------- frontmatter: tập con YAML đủ dùng cho task card ----------

def strip_comment(value):
    quote = None
    for i, ch in enumerate(value):
        if quote:
            if ch == quote:
                quote = None
        elif ch in "'\"":
            quote = ch
        elif ch == "#" and (i == 0 or value[i - 1].isspace()):
            return value[:i].rstrip()
    return value


def unquote(value):
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
        return value[1:-1]
    return value


def split_items(inner):
    """Tách "a, b, {c,d}" theo dấu phẩy ở tầng ngoài cùng (giữ nguyên {..} và [..] của glob)."""
    items, buf, depth, quote = [], [], 0, None
    for ch in inner:
        if quote:
            if ch == quote:
                quote = None
        elif ch in "'\"":
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


def parse_frontmatter(text):
    lines = text.lstrip("﻿").splitlines()
    if not lines or lines[0].strip() != "---":
        return None
    meta, key, flow = {}, None, None
    for line in lines[1:]:
        if line.strip() == "---":
            if flow is not None:  # danh sách [..] chưa đóng: lấy phần đã có
                meta[key] = split_items(" ".join(flow).lstrip("[").rstrip("]"))
            return meta
        if flow is not None:  # danh sách [a, b] viết trên nhiều dòng
            flow.append(strip_comment(line).strip())
            joined = " ".join(flow)
            if joined.endswith("]"):
                meta[key] = split_items(joined[1:-1])
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
        elif raw.startswith("[") and raw.endswith("]"):
            meta[key] = split_items(raw[1:-1])
        elif raw.startswith("["):
            flow = [raw]
        else:
            meta[key] = unquote(raw)
    return None


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
    def __init__(self, path, meta):
        self.path = path
        self.id = scalar(meta.get("id"))
        self.title = scalar(meta.get("title"))
        self.phase = scalar(meta.get("phase")) or self.id.split("-")[0]
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
    root = Path(directory)
    if not root.is_dir():
        sys.exit(f"Không thấy thư mục task card: {root}. Dùng --dir để chỉ đúng chỗ (mặc định docs/tasks).")
    tasks, notes = [], []
    for path in sorted(root.rglob("*.md")):
        if path.name.lower() in SKIP_FILES or path.name.startswith("_"):
            continue
        meta = parse_frontmatter(path.read_text(encoding="utf-8"))
        if meta is None:
            notes.append(f"{path}: không có frontmatter, bỏ qua")
            continue
        task = Task(path, meta)
        if not task.id:
            notes.append(f"{path}: frontmatter thiếu id, bỏ qua")
            continue
        tasks.append(task)
    tasks.sort(key=lambda t: natural_key(t.id))
    return tasks, notes


# ---------- xung đột file giữa các task ----------

def split_pattern(pattern):
    """Tách pattern thành (các tầng thư mục cố định, tiền tố literal của tầng glob đầu tiên hoặc None)."""
    fixed = []
    for seg in pattern.strip().replace("\\", "/").split("/"):
        if seg in ("", "."):
            continue
        globby = any(c in seg for c in "*?{") or ("[" in seg and not DYNAMIC_SEGMENT.match(seg))
        if globby:
            return fixed, re.split(r"[*?{\[]", seg, maxsplit=1)[0]
        fixed.append(seg)
    return fixed, None


def overlaps(a, b):
    """Hai pattern có thể cùng trỏ tới một file không? Nghi ngờ thì coi là có (an toàn hơn)."""
    fa, pa = split_pattern(a)
    fb, pb = split_pattern(b)
    if len(fa) > len(fb):
        fa, pa, fb, pb = fb, pb, fa, pa
    if fa != fb[:len(fa)]:
        return False
    if len(fa) == len(fb):
        return pa is None or pb is None or pa.startswith(pb) or pb.startswith(pa)
    return pa is None or fb[len(fa)].startswith(pa)


def conflict(a, b):
    """Lý do hai task không nên chạy cùng lúc, hoặc None nếu an toàn."""
    if not a.touches or not b.touches:
        missing = a if not a.touches else b
        return f"{missing.id} chưa khai báo touches"
    for x in a.touches:
        for y in b.touches:
            if overlaps(x, y):
                return f"cùng đụng {x}" if x == y else f"đụng nhau ({x} ↔ {y})"
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


# ---------- phụ thuộc ----------

def compute_waves(tasks):
    """Xếp task chưa done theo wave: wave k chỉ phụ thuộc task đã done hoặc nằm ở wave trước."""
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
    state = {}  # 1 = đang duyệt, 2 = đã xong
    path = []

    def visit(node):
        state[node] = 1
        path.append(node)
        for dep in by_id[node].deps:
            if dep not in ids:
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


def ready_tasks(tasks, by_id):
    return [t for t in tasks
            if t.status == "todo" and all(d in by_id and by_id[d].status == "done" for d in t.deps)]


def unblock_counts(tasks):
    """Mỗi task mở khoá (trực tiếp hoặc gián tiếp) bao nhiêu task khác."""
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


def percent(part, whole):
    return round(100 * part / whole) if whole else 0


def bar(part, whole, width=10):
    filled = round(width * part / whole) if whole else 0
    return "█" * filled + "░" * (width - filled)


def warn_duplicates(tasks):
    dups = sorted((i for i, n in Counter(t.id for t in tasks).items() if n > 1), key=natural_key)
    if dups:
        print(f"⚠  id bị trùng: {', '.join(dups)}. Chạy `check` để xem chi tiết.\n")


def print_notes(notes):
    if notes:
        print(f"\n({len(notes)} file bị bỏ qua vì thiếu frontmatter hoặc id. Chạy `check` để xem.)")


# ---------- lệnh ----------

def cmd_check(tasks, notes, args):
    errors, warnings = [], list(notes)
    counts = Counter(t.id for t in tasks)
    for task_id, n in counts.items():
        if n > 1:
            files = ", ".join(str(t.path) for t in tasks if t.id == task_id)
            errors.append(f"id {task_id} bị trùng ở {n} file: {files}")
    for t in tasks:
        if t.status not in STATUSES:
            errors.append(f"{t.id}: status '{t.status}' không hợp lệ (dùng {', '.join(STATUSES)})")
        for dep in t.deps:
            if dep == t.id:
                errors.append(f"{t.id}: tự phụ thuộc vào chính nó")
            elif dep not in counts:
                errors.append(f"{t.id}: deps '{dep}' không tồn tại")
        if not t.title:
            warnings.append(f"{t.id}: thiếu title")
        if t.lane and t.lane not in LANES:
            warnings.append(f"{t.id}: lane '{t.lane}' lạ (thường dùng {'/'.join(LANES)})")
        if not t.touches and t.status != "done":
            warnings.append(f"{t.id}: chưa khai báo touches, sẽ không được xếp chạy song song với task khác")
        if t.size == "L":
            warnings.append(f"{t.id}: size L, nên tách thành các task nhỏ hơn")
        elif t.size and t.size not in SIZES:
            warnings.append(f"{t.id}: size '{t.size}' lạ (dùng S/M/L)")
        if not t.path.name.startswith(t.id):
            warnings.append(f"{t.id}: tên file {t.path.name} nên bắt đầu bằng id")
    _, stuck = compute_waves(tasks)
    if stuck:
        cycle = find_cycle(stuck, {t.id: t for t in tasks})
        if cycle:
            errors.append("vòng phụ thuộc: " + " → ".join(cycle))
        errors.append("không xếp được wave cho: " + ", ".join(stuck))

    for message in warnings:
        print(f"⚠  {message}")
    for message in errors:
        print(f"✖  {message}")
    if errors:
        print(f"\n{len(errors)} lỗi, {len(warnings)} cảnh báo trong {len(tasks)} task card.")
        return 1
    suffix = f" ({len(warnings)} cảnh báo)" if warnings else ""
    print(f"{chr(10) if warnings else ''}✔ {len(tasks)} task card hợp lệ{suffix}.")
    return 0


def cmd_waves(tasks, notes, args):
    warn_duplicates(tasks)
    waves, stuck = compute_waves(tasks)
    shown = [w for w in ([t for t in wave if in_phase(t, args.phase)] for wave in waves) if w]
    scope = f"phase {args.phase}" if args.phase else "toàn dự án"
    pending = sum(len(w) for w in shown)
    if not pending and not stuck:
        print(f"Không còn task nào chưa xong ({scope}).")
        return 0
    solo = args.max_parallel == 1
    if solo:
        print(f"{pending} task chưa xong ({scope}), thứ tự làm lần lượt (một agent).\n")
    else:
        print(f"{pending} task chưa xong ({scope}), tối đa {args.max_parallel} agent cùng lúc.\n")
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
                mode = "song song" if len(batch) > 1 else "một task"
                print(f"  Lượt {i}.{j} ({mode}):")
                for t in batch:
                    print(f"    - {t.label()}")
            for t in runnable:
                if not t.touches:
                    print(f"  ⚠ {t.id} chưa khai báo touches → xếp chạy riêng")
            known = [t for t in runnable if t.touches]
            for x, a in enumerate(known):
                for b in known[x + 1:]:
                    reason = conflict(a, b)
                    if reason:
                        print(f"  ⚠ {a.id} và {b.id} {reason} → không chạy cùng lượt")
        for a in runnable:
            if a not in ready_now:
                continue
            holder = next((b for b in busy_tasks if conflict(a, b)), None)
            if holder:
                print(f"  ⚠ {a.id} phải chờ {holder.id} ({holder.status}, chưa merge): {conflict(a, holder)}")
        print()
    if stuck:
        print("✖ Không xếp được wave cho: " + ", ".join(stuck))
        cycle = find_cycle(stuck, {t.id: t for t in tasks})
        if cycle:
            print("  Vòng phụ thuộc: " + " → ".join(cycle))
        print("  Chạy `check` để xem chi tiết.")
        return 1
    print_notes(notes)
    return 0


def cmd_status(tasks, notes, args):
    warn_duplicates(tasks)
    shown = [t for t in tasks if in_phase(t, args.phase)]
    if not shown:
        print("Chưa có task card nào" + (f" cho phase {args.phase}" if args.phase else "") + ".")
        return 0
    by_id = {t.id: t for t in tasks}
    counts = Counter(t.status for t in shown)
    done = counts["done"]
    print(f"Tiến độ: {done}/{len(shown)} task done ({percent(done, len(shown))}%) · "
          f"doing {counts['doing']} · review {counts['review']} · "
          f"blocked {counts['blocked']} · todo {counts['todo']}\n")
    phases = sorted({t.phase for t in shown}, key=natural_key)
    width = max(len(p) for p in phases)
    for phase in phases:
        group = [t for t in shown if t.phase == phase]
        finished = sum(t.status == "done" for t in group)
        print(f"  {phase.ljust(width)}  {bar(finished, len(group))} "
              f"{percent(finished, len(group)):>3}%  {finished}/{len(group)}")
    ready = ready_tasks(shown, by_id)
    sections = [
        ("Đang làm", [t for t in shown if t.status == "doing"]),
        ("Chờ review", [t for t in shown if t.status == "review"]),
        ("Bị chặn", [t for t in shown if t.status == "blocked"]),
        ("Sẵn sàng làm ngay", ready),
        ("Trạng thái lạ (sửa lại cho đúng)", [t for t in shown if t.status not in STATUSES]),
    ]
    for title, group in sections:
        if group:
            print(f"\n{title}:")
            for t in group:
                print(f"  - {t.label()}")
    waiting = [t for t in shown if t.status == "todo" and t not in ready]
    if waiting:
        print("\nChờ deps:")
        for t in waiting:
            unmet = [d for d in t.deps if d not in by_id or by_id[d].status != "done"]
            print(f"  - {t.id} chờ {', '.join(unmet)}")
    print_notes(notes)
    return 0


def cmd_next(tasks, notes, args):
    warn_duplicates(tasks)
    by_id = {t.id: t for t in tasks}
    scope = [t for t in tasks if in_phase(t, args.phase)]
    running = [t for t in tasks if t.status == "doing"]
    reviewing = [t for t in scope if t.status == "review"]
    holding = [t for t in tasks if t.status in BUSY]  # chưa merge nên vẫn giữ file
    unlocks = unblock_counts(tasks)
    ready = sorted(ready_tasks(scope, by_id), key=lambda t: (-unlocks[t.id], natural_key(t.id)))

    if running:
        print("Đang chạy:")
        for t in running:
            print(f"  ▶ {t.label()}")
    if reviewing:
        print("Code xong, chờ review và merge:")
        for t in reviewing:
            print(f"  - {t.label()}")
    if running or reviewing:
        print()

    if not ready:
        left = [t for t in scope if t.status != "done"]
        if not left:
            print("Mọi task đã done. Review cả phase (skill review) rồi ship hoặc chuyển phase tiếp.")
        else:
            print("Chưa có task nào sẵn sàng: các task còn lại đang chạy, chờ review, chờ deps hoặc bị chặn. "
                  "Xem `status`.")
        print_notes(notes)
        return 0

    slots = max(args.max_parallel - len(running), 0)
    pick, later = [], []
    for t in ready:
        clash = next((other for other in holding + pick if conflict(t, other)), None)
        if clash is None and len(pick) < slots:
            pick.append(t)
        else:
            later.append((t, clash))

    def unlock_note(task):
        return f"  (mở khoá {unlocks[task.id]} task)" if unlocks[task.id] else ""

    if pick:
        print("Chạy được ngay" + (", song song vì không đụng file nhau:" if len(pick) > 1 else ":"))
        for t in pick:
            print(f"  - {t.label()}{unlock_note(t)}")
    if later:
        print("Sẵn sàng nhưng để lượt sau:")
        for t, clash in later:
            if clash is None:
                if args.max_parallel > 1:
                    why = "đã đủ số agent chạy song song"
                else:
                    why = "làm xong task đang chạy trước" if running else "mỗi lúc một task"
            elif clash.status in BUSY:
                why = f"đụng file với {clash.id} đang {clash.status}, chưa merge"
            else:
                why = f"đụng file với {clash.id}"
            print(f"  - {t.label()}  ({why})")
    print_notes(notes)
    return 0


def main(argv=None):
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass
    parser = argparse.ArgumentParser(description="Kiểm tra, xếp wave và xem tiến độ task card.")
    sub = parser.add_subparsers(dest="command", required=True)
    commands = {
        "check": (cmd_check, "kiểm tra lỗi trong task card"),
        "waves": (cmd_waves, "xếp wave và lượt chạy song song"),
        "status": (cmd_status, "bảng tiến độ theo phase"),
        "next": (cmd_next, "task chạy được ngay bây giờ"),
    }
    for name, (_, help_text) in commands.items():
        cmd = sub.add_parser(name, help=help_text)
        cmd.add_argument("--dir", default="docs/tasks", help="thư mục chứa task card (mặc định: docs/tasks)")
        if name != "check":
            cmd.add_argument("--phase", help="chỉ xem task của một phase, vd P1")
        if name in ("waves", "next"):
            cmd.add_argument("--max-parallel", type=int, default=1,
                             help="số agent tối đa chạy cùng lúc (mặc định: 1, làm lần lượt)")
    args = parser.parse_args(argv)
    if getattr(args, "max_parallel", 1) < 1:
        parser.error("--max-parallel phải ≥ 1")
    tasks, notes = load_tasks(args.dir)
    return commands[args.command][0](tasks, notes, args)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except BrokenPipeError:  # vd khi pipe sang `head`
        os.dup2(os.open(os.devnull, os.O_WRONLY), sys.stdout.fileno())
        sys.exit(0)
