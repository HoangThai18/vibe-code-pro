---
id: P1-T04
title: Màn danh sách khách hàng
phase: P1
lane: FE
status: todo
deps: [P1-T01]
touches: [apps/web/src/features/customers/list/**, apps/web/src/routes.tsx]
size: M
---

## Mục tiêu
Màn danh sách theo mockup "Customers / List" trên Claude Design: tìm kiếm, lọc trạng thái, phân trang, đủ state loading / empty / error. Dùng mock MSW khi API chưa xong.

## Acceptance criteria
- [ ] Khớp mockup ở 375 / 768 / 1280 (ảnh chụp đính kèm báo cáo)
- [ ] Đủ state: loading skeleton, rỗng, lỗi có nút thử lại
- [ ] Điều hướng bàn phím được, focus thấy rõ
