---
name: frontend
description: "Code tầng frontend web: dựng UI từ mockup (handoff Claude Design, HTML export, Figma, screenshot) với design token, đủ state, motion spec và ảnh chụp để kiểm; quản lý state/store (TanStack Query, SWR, RTK Query, Zustand, Redux Toolkit, Pinia, URL state, form), cache và invalidation, xoá cache khi đổi tenant hay đăng xuất. Dùng khi dựng màn hình hoặc component web từ thiết kế, làm animation theo prototype, chọn hoặc sửa store, dữ liệu hiển thị cũ hoặc sai, re-render nhiều. App mobile dùng skill mobile, app desktop dùng skill desktop. Chỉnh nhỏ thì làm thẳng."
---

# Frontend: UI theo design và quản lý state

Thư mục skill: `${CLAUDE_SKILL_DIR}`. Chỉ đọc phần cần cho việc đang làm:

| Việc | Đọc |
|---|---|
| Dựng màn hình hoặc component mới từ mockup, handoff Claude Design | `references/design-to-code.md` |
| Animation, hiệu ứng theo prototype | `references/motion-spec.md` |
| Store, cache dữ liệu API, form, đồng bộ khi đổi tenant | `references/state-management.md` |
| Trang chậm, Core Web Vitals (LCP, INP, CLS), ngân sách hiệu năng | `${CLAUDE_SKILL_DIR}/../ship/references/performance.md` mục 5 |

Thư viện frontend đổi API nhanh (React, Next.js, Tailwind, TanStack Query đều có bản major gần đây). Trước khi dùng API mà bạn không chắc, kiểm version đang cài và tài liệu đúng version (`${CLAUDE_SKILL_DIR}/../plan/references/tech-research.md`).

## Quy tắc luôn áp dụng

1. **Component dùng design token** (màu, spacing, chữ, radius, motion), không hardcode mã màu hay px lẻ.
2. **Đủ state**: loading, rỗng, lỗi, disabled, cùng hover/focus-visible. Màn hình chỉ đẹp ở trạng thái "có dữ liệu" là chưa xong.
3. **Truy cập được**: HTML có ngữ nghĩa, input có label, dùng được bằng bàn phím, tương phản đạt AA, tôn trọng `prefers-reduced-motion`.
4. **Dữ liệu từ API là server state**: để thư viện query lo cache; không chép vào store toàn cục rồi tự đồng bộ bằng tay.
5. **Tenant nằm trong query key và trong chính request** (tốt nhất là trong URL), không dựa vào "tenant hiện tại" của cookie phiên; giữ dữ liệu cũ trong lúc tải (`keepPreviousData`) chỉ khi vẫn cùng tenant; đăng xuất thì xoá cache. Nhờ vậy màn hình không bao giờ hiện dữ liệu của workspace cũ.
6. **Không lưu token hay dữ liệu nhạy cảm vào localStorage** khi có cách an toàn hơn (cookie httpOnly).
7. **Dữ liệu theo contract** của backend; BE chưa xong thì dùng mock của contract, không tự đặt ra field.

## Trước khi coi là xong

Chạy app, chụp màn hình ở 375 / 768 / 1280, so với mockup, kiểm các state và điều hướng bằng Tab. Chỉ đọc code là chưa đủ, phải nhìn ảnh thật. Cách chụp ở `references/design-to-code.md`.

Màn hình thuộc luồng chính (đăng nhập, tạo đơn, thanh toán, đổi workspace): thêm hoặc cập nhật test Playwright cho luồng đó (`${CLAUDE_SKILL_DIR}/../build/references/e2e-playwright.md`).
