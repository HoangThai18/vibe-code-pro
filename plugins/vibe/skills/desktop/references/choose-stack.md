# Chọn cách làm app desktop

## Mục lục
1. Có cần app desktop không
2. So sánh các cách làm
3. Mặc định khuyến nghị
4. Ghi quyết định

## 1. Có cần app desktop không

Web app (có thể cài dạng PWA) đủ cho phần lớn phần mềm quản lý. Cần app desktop khi có ít nhất một nhu cầu:

- Làm việc với file và thiết bị trên máy: máy in hoá đơn, máy quét mã vạch, cân điện tử, thư mục đồng bộ, file lớn.
- Chạy offline cả ngày (quầy thu ngân, kho) và đồng bộ khi có mạng.
- Tích hợp hệ điều hành: khay hệ thống, phím tắt toàn cục, khởi động cùng máy, thông báo hệ thống.
- Khách hàng doanh nghiệp yêu cầu cài đặt, quản lý qua công cụ IT.

## 2. So sánh các cách làm

| Cách làm | Hợp khi | Cái giá | Tránh khi |
|---|---|---|---|
| **PWA** | Chủ yếu là app web, cần icon trên desktop và cửa sổ riêng | Truy cập file, thiết bị hạn chế, tuỳ trình duyệt | Cần thiết bị ngoại vi, chạy nền |
| **Tauri** (v2) | Muốn bộ cài nhỏ, ít RAM, giao diện web (React/Vue/Svelte), phần native viết bằng Rust | Dùng webview của hệ điều hành: hiển thị khác nhau giữa Windows, macOS, Linux; phần backend native cần Rust | Team không muốn đụng Rust, cần chính xác một engine Chromium |
| **Electron** | Cần hệ sinh thái Node.js, hiển thị giống hệt nhau mọi nơi (Chromium đóng gói kèm), nhiều thư viện có sẵn | Bộ cài lớn (thường hơn 100 MB), tốn RAM; phải tự giữ cấu hình bảo mật đúng | Máy cấu hình yếu là đối tượng chính |
| **Native** (WinUI/.NET, SwiftUI, Qt) | Một hệ điều hành chính, cần tích hợp sâu hoặc hiệu năng cao | Mỗi nền tảng một codebase, không dùng lại code web | Cần cả ba hệ điều hành với team nhỏ |
| **Flutter desktop** | Đã có app Flutter mobile, muốn dùng chung | Hệ sinh thái desktop nhỏ hơn mobile | Team web React |

## 3. Mặc định khuyến nghị

Cho team web React/TypeScript:

- **Tauri** khi app chủ yếu là giao diện + gọi API, cần bộ cài nhẹ, và chấp nhận viết vài command Rust cho phần native (đọc file, thiết bị).
- **Electron** khi cần thư viện Node.js (driver máy in, SQLite qua Node, SDK chỉ có cho Node), hoặc cần hiển thị đồng nhất tuyệt đối.
- Dùng chung `packages/contracts` và token giao diện với web (skill `mobile`, `choose-stack.md` mục 4; từ file này: `../../mobile/references/choose-stack.md`); phần renderer viết như một app web (skill `frontend`).

## 4. Ghi quyết định

Ghi vào `docs/plan/ARCHITECTURE.md` (ADR): hệ điều hành và phiên bản tối thiểu hỗ trợ, cách làm, mức offline (như mobile), kênh phân phối (tải từ web, Microsoft Store, Mac App Store, công cụ IT của khách), cách tự cập nhật, chính sách hỗ trợ bản cũ.
