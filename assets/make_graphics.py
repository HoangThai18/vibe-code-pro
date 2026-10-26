"""Sinh 3 SVG động cho README: hero, flow, terminal.

Chỉ dùng CSS animation, nên người xem bật "giảm chuyển động" sẽ thấy bản tĩnh đầy đủ nội dung.
Hình terminal lấy output thật của tasks.py trên ví dụ mini-crm, nên sửa script hay ví dụ thì chạy lại:

    python3 assets/make_graphics.py
"""
import html, os, subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = str(ROOT / "assets") + "/"
SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif"
MONO = "ui-monospace, SFMono-Regular, 'Cascadia Mono', 'JetBrains Mono', Menlo, Consolas, 'Liberation Mono', monospace"
E = html.escape

COMMON_CSS = """
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; } }
"""

def bg_defs(w, h):
    return f"""
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#0A0F24"/><stop offset="1" stop-color="#141A3A"/>
  </linearGradient>
  <filter id="blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="70"/></filter>
  <pattern id="dots" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.4" fill="#FFFFFF" fill-opacity="0.07"/></pattern>
  <clipPath id="card"><rect width="{w}" height="{h}" rx="28"/></clipPath>"""

def backdrop(w, h, blobs):
    out = [f'<g clip-path="url(#card)"><rect width="{w}" height="{h}" fill="url(#bg)"/>']
    for i, (cx, cy, r, color) in enumerate(blobs):
        out.append(f'<circle class="blob b{i}" cx="{cx}" cy="{cy}" r="{r}" fill="{color}" fill-opacity="0.45" filter="url(#blur)"/>')
    out.append(f'<rect width="{w}" height="{h}" fill="url(#dots)"/></g>')
    out.append(f'<rect x="0.5" y="0.5" width="{w-1}" height="{h-1}" rx="27.5" fill="none" stroke="#FFFFFF" stroke-opacity="0.10"/>')
    return "\n".join(out)

BLOB_CSS = """
.blob { transform-box: fill-box; transform-origin: center; }
.b0 { animation: drift0 16s ease-in-out infinite alternate; }
.b1 { animation: drift1 19s ease-in-out infinite alternate; }
.b2 { animation: drift2 23s ease-in-out infinite alternate; }
@keyframes drift0 { to { transform: translate(90px, 40px) scale(1.15); } }
@keyframes drift1 { to { transform: translate(-110px, -30px) scale(0.9); } }
@keyframes drift2 { to { transform: translate(60px, -50px) scale(1.2); } }
"""

def seq_keyframes(name, i, n, prop_on, prop_off):
    """Keyframes cho phần tử thứ i trong chuỗi n bước sáng lần lượt (một chu kỳ chung)."""
    step = 100 / n
    a = i * step
    b = a + step * 0.9
    pts = [(0, prop_off)]
    if a > 0:
        pts.append((max(a - 0.01, 0), prop_off))
    pts += [(a + step * 0.15, prop_on), (b, prop_on), (min(b + step * 0.15, 100), prop_off), (100, prop_off)]
    body = " ".join(f"{p:.2f}% {{ {v} }}" for p, v in pts)
    return f"@keyframes {name}{i} {{ {body} }}"

# ---------------------------------------------------------------- hero
def hero():
    W, H = 1280, 420
    skills = ["plan", "tasks", "architecture", "backend", "frontend", "mobile", "desktop", "ai", "build", "review", "ship", "fix"]
    n = len(skills)
    cyc = 13.5
    css = [COMMON_CSS, BLOB_CSS, """
.shine { animation: shine 7s linear infinite; }
@keyframes shine { from { transform: translateX(0); } to { transform: translateX(640px); } }
.chip rect { fill: #FFFFFF; fill-opacity: 0.05; stroke: #FFFFFF; stroke-opacity: 0.16; }
.chip text { fill: #CBD5E1; }
.cursor { animation: blink 1.1s steps(1) infinite; }
@keyframes blink { 50% { opacity: 0; } }
"""]
    chips = []
    x0, y0, cw, ch, gx, gy = 796, 96, 142, 48, 14, 12
    for i, s in enumerate(skills):
        r, c = divmod(i, 3)
        indent = (cw + gx) / 2 if r == (n - 1) // 3 and n % 3 == 2 else 0   # hàng cuối 2 ô thì canh giữa
        x, y = x0 + indent + c * (cw + gx), y0 + r * (ch + gy)
        css.append(seq_keyframes("lit", i, n, "fill-opacity: 1;", "fill-opacity: 0;"))
        css.append(f".glow{i} {{ animation: lit{i} {cyc}s ease-in-out infinite; }}")
        chips.append(f'''<g class="chip">
  <rect x="{x}" y="{y}" width="{cw}" height="{ch}" rx="14"/>
  <rect class="glow{i}" x="{x}" y="{y}" width="{cw}" height="{ch}" rx="14" style="fill:url(#chipGrad);stroke:none" fill-opacity="0"/>
  <text x="{x + cw/2}" y="{y + 31}" text-anchor="middle" font-family="{MONO}" font-size="16">{E(s)}</text>
</g>''')
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" aria-labelledby="t d">
<title id="t">vibe: bộ skill Claude Code cho phát triển phần mềm thật</title>
<desc id="d">Logo vibe và 12 skill: plan, tasks, architecture, backend, frontend, mobile, desktop, ai, build, review, ship, fix, lần lượt sáng lên. Cho web, app mobile, app desktop và tính năng AI.</desc>
<defs>{bg_defs(W, H)}
  <linearGradient id="titleGrad" x1="0" y1="0" x2="640" y2="0" gradientUnits="userSpaceOnUse" spreadMethod="repeat">
    <stop offset="0" stop-color="#A78BFA"/><stop offset="0.35" stop-color="#22D3EE"/>
    <stop offset="0.7" stop-color="#F0ABFC"/><stop offset="1" stop-color="#A78BFA"/>
  </linearGradient>
  <linearGradient id="chipGrad" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#7C3AED" stop-opacity="0.85"/><stop offset="1" stop-color="#0891B2" stop-opacity="0.85"/>
  </linearGradient>
  <clipPath id="titleClip"><text x="58" y="250" font-family="{SANS}" font-size="168" font-weight="800" letter-spacing="-6">vibe</text></clipPath>
  <style>{"".join(css)}</style>
</defs>
{backdrop(W, H, [(180, 80, 170, "#7C3AED"), (640, 380, 190, "#0891B2"), (1130, 60, 150, "#DB2777")])}
<g>
  <rect x="64" y="56" width="292" height="36" rx="18" fill="#FFFFFF" fill-opacity="0.08" stroke="#FFFFFF" stroke-opacity="0.18"/>
  <circle cx="86" cy="74" r="5" fill="#34D399"/>
  <text x="100" y="80" font-family="{SANS}" font-size="16" fill="#E2E8F0">Claude Code plugin · open source</text>
</g>
<g clip-path="url(#titleClip)">
  <rect class="shine" x="-640" y="90" width="1920" height="200" fill="url(#titleGrad)"/>
</g>
<text x="64" y="312" font-family="{SANS}" font-size="30" font-weight="650" fill="#F8FAFC">Bộ skill để vibe code ra phần mềm thật</text>
<text x="64" y="352" font-family="{SANS}" font-size="20" fill="#94A3B8">nghiệp vụ → plan → task → code + test → review → deploy → vận hành</text>
<text x="64" y="386" font-family="{SANS}" font-size="17" fill="#A5B4FC">web · mobile · desktop · AI · /vibe:start → /vibe:next → /vibe:check</text>
{"".join(chips)}
<text x="{x0}" y="{y0 + 4*(ch+gy) + 22}" font-family="{SANS}" font-size="15" fill="#64748B">12 skill · 5 lệnh tắt · 2 agent</text>
</svg>'''
    open(OUT + "hero.svg", "w").write(svg)

# ---------------------------------------------------------------- flow
def flow():
    W, H = 1280, 600
    main = [
        ("Ý tưởng", "", "", "muted"),
        ("plan", "nghiệp vụ · PRD", "kiến trúc · phase", ""),
        ("tasks", "task card", "tiến độ · handoff", ""),
        ("build", "code + test", "một agent chính", ""),
        ("review", "verifier độc lập", "PASS · BLOCK", ""),
        ("ship", "CI/CD · rollback", "giám sát · backup", ""),
        ("Chạy thật", "", "", "live"),
    ]
    nw, nh, gap, top = 148, 120, 30, 120
    x0 = (W - (len(main) * nw + (len(main) - 1) * gap)) / 2
    xs = [x0 + i * (nw + gap) for i in range(len(main))]
    n_lit = 5
    cyc = 10
    css = [COMMON_CSS, BLOB_CSS, """
.node rect.base { fill: #FFFFFF; fill-opacity: 0.06; stroke: #FFFFFF; stroke-opacity: 0.18; }
.node text.t { fill: #F8FAFC; } .node text.c { fill: #94A3B8; }
.wire { fill: none; stroke: #FFFFFF; stroke-opacity: 0.22; stroke-width: 2; }
.flow { fill: none; stroke: url(#wireGrad); stroke-width: 3; stroke-linecap: round; stroke-dasharray: 6 14; animation: march 1.2s linear infinite; }
.flow.slow { animation-duration: 2.4s; }
@keyframes march { to { stroke-dashoffset: -20; } }
.support rect { fill: #FFFFFF; fill-opacity: 0.04; stroke: #A78BFA; stroke-opacity: 0.45; stroke-dasharray: 5 5; }
.support text { fill: #DDD6FE; }
.live-dot { animation: pulse 1.6s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
@keyframes pulse { 50% { transform: scale(1.8); opacity: 0.3; } }
"""]
    parts = []
    cy = top + nh / 2
    # main wires
    for i in range(len(main) - 1):
        a, b = xs[i] + nw, xs[i + 1]
        parts.append(f'<path class="wire" d="M{a+4} {cy} H{b-4}"/><path class="flow" d="M{a+4} {cy} H{b-12}"/>'
                     f'<path d="M{b-12} {cy-6} L{b-4} {cy} L{b-12} {cy+6}" fill="none" stroke="#22D3EE" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>')
    for i, (t, c1, c2, kind) in enumerate(main):
        x = xs[i]
        if kind == "muted":
            parts.append(f'<g class="node"><rect class="base" x="{x}" y="{top+30}" width="{nw}" height="{nh-60}" rx="30" style="stroke-dasharray:6 6"/>'
                         f'<text class="t" x="{x+nw/2}" y="{cy+8}" text-anchor="middle" font-family="{SANS}" font-size="22" font-weight="600">{E(t)}</text></g>')
            continue
        if kind == "live":
            parts.append(f'<g class="node"><rect x="{x}" y="{top+30}" width="{nw}" height="{nh-60}" rx="30" fill="#059669" fill-opacity="0.22" stroke="#34D399" stroke-opacity="0.7"/>'
                         f'<circle class="live-dot" cx="{x+20}" cy="{cy}" r="5" fill="#34D399"/>'
                         f'<text class="t" x="{x+34}" y="{cy+7}" font-family="{SANS}" font-size="20" font-weight="600">{E(t)}</text></g>')
            continue
        k = i - 1
        css.append(seq_keyframes("on", k, n_lit, "fill-opacity: 1;", "fill-opacity: 0;"))
        css.append(f".hl{k} {{ animation: on{k} {cyc}s ease-in-out infinite; }}")
        parts.append(f'''<g class="node">
  <rect class="base" x="{x}" y="{top}" width="{nw}" height="{nh}" rx="18"/>
  <rect class="hl{k}" x="{x}" y="{top}" width="{nw}" height="{nh}" rx="18" fill="url(#nodeGrad)" fill-opacity="0"/>
  <text class="t" x="{x+nw/2}" y="{top+44}" text-anchor="middle" font-family="{MONO}" font-size="24" font-weight="700">{E(t)}</text>
  <text class="c" x="{x+nw/2}" y="{top+76}" text-anchor="middle" font-family="{SANS}" font-size="15">{E(c1)}</text>
  <text class="c" x="{x+nw/2}" y="{top+98}" text-anchor="middle" font-family="{SANS}" font-size="15">{E(c2)}</text>
</g>''')
    # support skills under build
    bx = xs[3] + nw / 2
    sup = [("architecture", "SOLID · DDD"), ("backend", "DB · RLS · job"), ("frontend", "web · state"),
           ("mobile", "iOS · Android"), ("desktop", "Win · Mac · Linux"), ("ai", "LLM · eval")]
    sw, sh, sgap, sy = 158, 70, 14, 330
    sx0 = bx - (len(sup) * sw + (len(sup) - 1) * sgap) / 2
    for j, (t, c) in enumerate(sup):
        x = sx0 + j * (sw + sgap)
        mx = x + sw / 2
        parts.append(f'<path class="wire" d="M{bx} {top+nh+4} C{bx} {top+nh+60}, {mx} {sy-60}, {mx} {sy-4}" style="stroke-dasharray:4 6"/>')
        parts.append(f'''<g class="support"><rect x="{x}" y="{sy}" width="{sw}" height="{sh}" rx="16"/>
  <text x="{mx}" y="{sy+30}" text-anchor="middle" font-family="{MONO}" font-size="19" font-weight="700">{E(t)}</text>
  <text x="{mx}" y="{sy+54}" text-anchor="middle" font-family="{SANS}" font-size="13" fill-opacity="0.85">{E(c)}</text></g>''')
    parts.append(f'<text x="{bx}" y="{sy+sh+28}" text-anchor="middle" font-family="{SANS}" font-size="15" fill="#64748B">skill chuyên môn: chỉ nạp phần tài liệu cần cho việc đang làm</text>')
    # fix loop: from "Chạy thật" down to fix, then back to tasks
    lx = xs[6] + nw / 2
    fx, fy, fw, fh = xs[6] - 10, 470, nw + 20, 84
    parts.append(f'<path class="wire" d="M{lx} {top+nh-26} V{fy-4}"/><path class="flow slow" d="M{lx} {top+nh-26} V{fy-10}" style="stroke:#FB7185"/>')
    parts.append(f'''<g class="node"><rect x="{fx}" y="{fy}" width="{fw}" height="{fh}" rx="18" fill="#E11D48" fill-opacity="0.16" stroke="#FB7185" stroke-opacity="0.7"/>
  <text class="t" x="{fx+fw/2}" y="{fy+36}" text-anchor="middle" font-family="{MONO}" font-size="24" font-weight="700">fix</text>
  <text class="c" x="{fx+fw/2}" y="{fy+62}" text-anchor="middle" font-family="{SANS}" font-size="14">test tái hiện · gốc rễ</text></g>''')
    tx = xs[2] + nw / 2
    ry = fy + fh / 2
    lane = sx0 - 28                      # chạy vòng bên trái các skill hỗ trợ, không cắt qua ô nào
    mid = top + nh + 40
    path = (f"M{fx-4} {ry} H{lane+16} Q{lane} {ry} {lane} {ry-16} V{mid+16} Q{lane} {mid} {lane+16} {mid} "
            f"H{tx-16} Q{tx} {mid} {tx} {mid-16} V{top+nh+8}")
    parts.append(f'<path class="wire" d="{path}"/><path class="flow slow" d="{path}" style="stroke:#FB7185"/>')
    parts.append(f'<path d="M{tx-6} {top+nh+16} L{tx} {top+nh+8} L{tx+6} {top+nh+16}" fill="none" stroke="#FB7185" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>')
    parts.append(f'<text x="{(lane + fx)/2 + 120}" y="{ry - 12}" text-anchor="middle" font-family="{SANS}" font-size="15" fill="#FDA4AF">có lỗi → test tái hiện → sửa → thêm task phòng ngừa</text>')
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" aria-labelledby="t d">
<title id="t">Quy trình của vibe</title>
<desc id="d">Ý tưởng, plan, tasks, build, review, ship, chạy thật. Build dùng các skill architecture, backend, frontend, mobile, desktop, ai. Khi chạy thật có lỗi thì qua fix rồi quay lại tasks.</desc>
<defs>{bg_defs(W, H)}
  <linearGradient id="nodeGrad" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#7C3AED" stop-opacity="0.75"/><stop offset="1" stop-color="#0891B2" stop-opacity="0.75"/>
  </linearGradient>
  <linearGradient id="wireGrad" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#A78BFA"/><stop offset="1" stop-color="#22D3EE"/></linearGradient>
  <style>{"".join(css)}</style>
</defs>
{backdrop(W, H, [(120, 520, 160, "#7C3AED"), (700, 40, 170, "#0891B2"), (1200, 560, 150, "#DB2777")])}
<text x="64" y="70" font-family="{SANS}" font-size="26" font-weight="700" fill="#F8FAFC">Một agent chính, đi trọn vòng đời phần mềm</text>
{"".join(parts)}
</svg>'''
    open(OUT + "flow.svg", "w").write(svg)

# ---------------------------------------------------------------- terminal
def terminal():
    S = str(ROOT / "plugins/vibe/skills/tasks") + "/"
    run = lambda *a: subprocess.run(["python3", S + "scripts/tasks.py", *a, "--dir", S + "examples/mini-crm"],
                                    capture_output=True, text=True, check=True).stdout.rstrip("\n").split("\n")
    blocks = [("python3 tasks.py status --dir docs/tasks", run("status")),
              ("python3 tasks.py next --dir docs/tasks", run("next"))]
    W, lh, top, left = 1040, 23, 86, 36
    lines = []
    for cmd, out in blocks:
        lines.append(("cmd", cmd))
        lines += [("out", l) for l in out]
        lines.append(("out", ""))
    lines.pop()
    H = top + len(lines) * lh + 40
    total = 18.0
    # thời điểm (giây) mỗi dòng xuất hiện
    t, times = 0.6, []
    for kind, text in lines:
        times.append(t)
        t += 1.6 if kind == "cmd" else 0.12
        if kind == "cmd":
            pass
    hold_end = 0.94
    css = [COMMON_CSS, BLOB_CSS, f"""
.cur {{ animation: blink 1s steps(1) infinite; }}
@keyframes blink {{ 50% {{ opacity: 0; }} }}
"""]
    rows = []
    for i, ((kind, text), ts) in enumerate(zip(lines, times)):
        p = ts / total * 100
        if kind == "cmd":
            # gõ lệnh: lộ dần bằng clip rect co giãn theo steps
            chars = len(text) + 2
            dur = 1.2 / total * 100
            css.append(f"@keyframes ln{i} {{ 0%, {p-0.01:.2f}% {{ opacity: 0; }} {p:.2f}%, {hold_end*100:.2f}% {{ opacity: 1; }} {hold_end*100+2:.2f}%, 100% {{ opacity: 0; }} }}")
            css.append(f"@keyframes ty{i} {{ 0%, {p:.2f}% {{ transform: scaleX(0); }} {p+dur:.2f}%, 100% {{ transform: scaleX(1); }} }}")
            css.append(f".l{i} {{ animation: ln{i} {total}s linear infinite; }} .c{i} {{ transform-box: fill-box; transform-origin: left; animation: ty{i} {total}s steps({chars}) infinite; }}")
            y = top + i * lh
            rows.append(f'<clipPath id="cp{i}"><rect class="c{i}" x="{left}" y="{y-18}" width="{W-2*left}" height="{lh}"/></clipPath>')
            rows.append(f'<g class="ln l{i}" clip-path="url(#cp{i})"><text x="{left}" y="{y}" font-family="{MONO}" font-size="16" xml:space="preserve"><tspan fill="#34D399">$ </tspan><tspan fill="#F8FAFC">{E(text)}</tspan></text></g>')
        else:
            css.append(f"@keyframes ln{i} {{ 0%, {p-0.01:.2f}% {{ opacity: 0; }} {p:.2f}%, {hold_end*100:.2f}% {{ opacity: 1; }} {hold_end*100+2:.2f}%, 100% {{ opacity: 0; }} }}")
            css.append(f".l{i} {{ animation: ln{i} {total}s linear infinite; }}")
            color = "#CBD5E1"
            if text.startswith(("Tiến độ", "Đang", "Sẵn sàng", "Chờ")):
                color = "#F0ABFC" if not text.startswith("Tiến độ") else "#F8FAFC"
            if "██" in text or "░" in text:
                color = "#22D3EE"
            y = top + i * lh
            rows.append(f'<text class="ln l{i}" x="{left}" y="{y}" font-family="{MONO}" font-size="16" fill="{color}" xml:space="preserve">{E(text)}</text>')
    last_y = top + (len(lines)) * lh
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" aria-labelledby="t d">
<title id="t">tasks.py: tiến độ và việc tiếp theo</title>
<desc id="d">Output thật của tasks.py status và next trên dự án mẫu mini-crm.</desc>
<defs>{bg_defs(W, H)}
  <style>{"".join(css)}</style>
</defs>
{backdrop(W, H, [(900, 60, 150, "#7C3AED"), (120, H-40, 140, "#0891B2")])}
<rect x="0" y="0" width="{W}" height="48" fill="#FFFFFF" fill-opacity="0.04" clip-path="url(#card)"/>
<circle cx="30" cy="24" r="7" fill="#FF5F57"/><circle cx="54" cy="24" r="7" fill="#FEBC2E"/><circle cx="78" cy="24" r="7" fill="#28C840"/>
<text x="{W/2}" y="30" text-anchor="middle" font-family="{SANS}" font-size="15" fill="#94A3B8">~/spa-crm · tasks.py (output thật, dự án mẫu mini-crm)</text>
{"".join(rows)}
<rect class="cur" x="{left}" y="{last_y - 16}" width="10" height="20" fill="#22D3EE"/>
</svg>'''
    open(OUT + "terminal.svg", "w").write(svg)

hero(); flow(); terminal()
for f in ("hero.svg", "flow.svg", "terminal.svg"):
    print(f"{f}: {os.path.getsize(OUT + f):,} byte")
