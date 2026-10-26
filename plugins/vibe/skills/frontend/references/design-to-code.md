# Design to Code: từ mockup Claude Design tới UI chạy thật

Mục tiêu: UI trong code giống mockup đã duyệt (đúng token, đúng state, đúng chuyển động) và nhất quán với design system của codebase. Kết quả không nên là một trang "na ná" với mã màu hex rải khắp component.

**Cân đúng mức**: màn hình hoặc luồng mới thì đi đủ 5 bước. Chỉnh nhỏ trên màn đã có thì sửa thẳng bằng token sẵn có, rồi chụp một ảnh ở breakpoint bị ảnh hưởng để kiểm; không cần file kiểm kê.

## Đầu vào, từ tốt nhất tới kém nhất

1. **Handoff bundle từ Claude Design**: khi design xong, Claude Design đóng gói thiết kế để chuyển sang Claude Code. Có cấu trúc, token và code prototype nên ít phải đoán nhất.
2. **HTML/CSS export hoặc prototype chạy được**: đọc được giá trị thật (màu, spacing, transition) trong CSS.
3. **Figma** (qua Figma MCP nếu có: `get_variable_defs` cho token, `get_design_context` cho cấu trúc, `get_screenshot` để so; code nó trả về chỉ là bản mô tả, dựng lại bằng component và token của dự án. Cài và giới hạn lượt gọi: skill `plan`, `references/dev-tools.md` mục 6; từ file này: `../../plan/references/dev-tools.md`).
4. **Screenshot**: phải ước lượng. Nói rõ với user là kết quả sẽ xấp xỉ, và hỏi các giá trị quan trọng (font, màu chủ đạo) nếu không suy ra được.

## Bước 1: Kiểm kê trước khi code → `docs/design/<feature>.md`

1. **Màn hình và route**; layout ở từng breakpoint (375 / 768 / 1280+).
2. **Token**: màu theo vai trò (background, surface, text, muted, primary, danger...), typography scale, spacing, radius, shadow. Đặt tên theo vai trò (`--color-primary`), không theo giá trị (`--blue-500`), để đổi theme không phải sửa component.
3. **Component**: cái nào tái dùng từ codebase, cái nào mới. Mỗi component liệt kê variant và state: default, hover, focus-visible, active, disabled, loading, empty, error.
4. **Motion spec**: mọi chuyển động trong prototype đưa vào một bảng (xem [motion-spec.md](motion-spec.md)).
5. **Dữ liệu**: field nào lấy từ endpoint nào (đối chiếu contract), chữ nào là copy cố định hay i18n.

Chỗ design và thực tế không khớp (thiếu state rỗng, chữ dài làm vỡ layout, dữ liệu thật khác dữ liệu mẫu) thì ghi lại và đề xuất cách xử lý với user. Đừng tự chế ngầm, vì người duyệt design sẽ không biết đã có thay đổi.

## Bước 2: Đưa token vào code trước

Đưa token vào hệ thống của dự án (CSS variables, Tailwind theme, theme object...) trước khi dựng component. Component chỉ dùng token. Dự án đã có design system thì map token của design sang token sẵn có; chỉ thêm token mới khi có lý do.

## Bước 3: Dựng component từ nhỏ đến lớn

- Ưu tiên component sẵn có; mở rộng bằng variant thay vì copy ra bản mới.
- HTML có ngữ nghĩa (nút là `button`, liên kết là `a`), input có label, focus-visible thấy rõ, tương phản đạt WCAG AA.
- Dữ liệu lấy từ mock theo contract nếu BE chưa xong (skill `backend`; từ file này: `../../backend/references/api-contract.md`).
- Mọi state trong bảng kiểm kê phải xem được: Storybook nếu dự án có, không thì một route demo tạm.

## Bước 4: Motion

Code chuyển động đúng spec (thuộc tính, duration, easing, delay):

- Chỉ animate `transform` và `opacity` khi có thể: mượt và không làm trình duyệt tính lại layout.
- Tôn trọng `prefers-reduced-motion`: tắt hoặc giảm các chuyển động lớn.
- Dùng công cụ dự án đã có (CSS transition/keyframes, Motion/Framer Motion, GSAP...); không thêm thư viện chỉ vì một hiệu ứng.
- Đưa giá trị motion vào token (`--duration-base`, `--ease-out`) để các màn đồng bộ với nhau.

## Bước 5: Verify bằng mắt (bắt buộc với UI)

Chạy app, chụp màn hình ở 375 / 768 / 1280, đặt cạnh mockup, liệt kê chỗ lệch (khoảng cách, cỡ chữ, màu, căn lề, xuống dòng) rồi sửa. Kiểm thêm state rỗng / loading / lỗi, điều hướng bằng bàn phím (Tab qua được, focus thấy rõ), chữ rất dài, dark mode nếu có.

```js
// scripts/shot.mjs: node scripts/shot.mjs http://localhost:3101/customers [thư-mục-lưu]
// Dùng đúng port của dev server bạn đang chạy (agent khác có thể đang chạy app ở port khác).
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const url = new URL(process.argv[2] ?? 'http://localhost:3000/');
const outDir = process.argv[3] ?? 'docs/design/shots';
const name = url.pathname.replace(/^\/+|\/+$/g, '').replace(/[^\w-]+/g, '_') || 'home';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
for (const width of [375, 768, 1280]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.goto(url.href);
  await page.waitForLoadState('load');
  // Chờ một phần tử chính của màn hình hiện ra, vd: await page.getByRole('heading').first().waitFor();
  await page.screenshot({ path: `${outDir}/${name}-${width}.png`, fullPage: true, animations: 'disabled' });
  await page.close();
}
await browser.close();
```

Ảnh được đặt tên theo route và breakpoint nên chụp nhiều màn không đè nhau. Agent chạy trong worktree thì ảnh nằm trong worktree; người điều phối xem ảnh trước khi xoá worktree, hoặc commit ảnh vào `docs/design/shots/` nếu team muốn lưu. Dự án không có Playwright thì dùng công cụ chụp màn hình có sẵn; vẫn phải nhìn ảnh thật chứ không chỉ đọc code.

## Đầu ra

- Code UI + token.
- `docs/design/<feature>.md`: kiểm kê, motion spec, chỗ lệch so với design và lý do.
- Ảnh chụp verify đính kèm trong báo cáo task (hoặc commit vào `docs/design/shots/` nếu team muốn lưu).
