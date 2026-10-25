# Motion spec

Viết spec trước khi code để chuyển động trong app khớp với prototype và nhất quán giữa các màn hình. Spec còn giúp reviewer có cái để so: "drawer mở trong 200ms ease-out" kiểm được, "mượt mượt" thì không.

## Bảng spec

| Phần tử | Trigger | Thuộc tính | Từ → Đến | Duration | Easing | Delay | Ghi chú |
|---|---|---|---|---|---|---|---|
| Drawer form | mở | opacity, transform | 0, translateX(24px) → 1, none | 200ms | cubic-bezier(.2,.8,.2,1) | 0 | đóng: 150ms, ease-in |
| Toast | xuất hiện | opacity, transform | 0, translateY(8px) → 1, none | 180ms | ease-out | 0 | tự ẩn sau 4s |
| Item danh sách | vào màn | opacity, transform | 0, translateY(4px) → 1, none | 160ms | ease-out | 30ms × thứ tự (tối đa 8 item) | stagger |
| Nút | hover | background-color | token → token đậm hơn | 120ms | ease-out | 0 | |

## Lấy giá trị từ prototype

- **HTML/CSS export, handoff bundle**: tìm `transition`, `animation`, `@keyframes`, `transform` trong CSS; animation bằng JS (Motion, GSAP) thì đọc tham số duration, ease, delay, stagger.
- **Chỉ có video hoặc ảnh**: đề xuất giá trị theo bảng tham khảo bên dưới và ghi "ước lượng" trong spec để người duyệt design biết.

## Giá trị tham khảo

| Loại | Duration | Easing |
|---|---|---|
| Vi tương tác (hover, toggle, checkbox) | 100–150ms | ease-out |
| Phần tử nhỏ vào/ra (tooltip, dropdown, toast) | 150–200ms | ease-out khi vào, ease-in khi ra |
| Panel, modal, drawer | 200–300ms | cubic-bezier(.2,.8,.2,1) |
| Chuyển trang, hero | 300–500ms | ease-in-out |

Chuyển động ra thường nhanh hơn chuyển động vào khoảng 25%. Người dùng đã quyết định đóng thì đừng bắt họ chờ.

## Token gợi ý

```css
:root {
  --duration-fast: 120ms;
  --duration-base: 200ms;
  --duration-slow: 320ms;
  --ease-out: cubic-bezier(.2, .8, .2, 1);
  --ease-in: cubic-bezier(.4, 0, 1, 1);
  --ease-in-out: cubic-bezier(.4, 0, .2, 1);
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

## Checklist

- [ ] Chỉ animate `transform` / `opacity` (ngoại lệ có lý do được ghi lại)
- [ ] Có xử lý `prefers-reduced-motion`
- [ ] Animation không chặn thao tác: click, gõ phím được ngay
- [ ] Không gây layout shift
- [ ] Dùng token motion chung, không có số lẻ rải rác trong component
- [ ] Đã so với prototype ở tốc độ thật (không chỉ so ảnh tĩnh)
