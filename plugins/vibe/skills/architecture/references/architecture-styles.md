# Chọn kiểu kiến trúc theo yêu cầu

Không có kiến trúc tốt nhất, chỉ có kiến trúc hợp với quy mô team, độ phức tạp nghiệp vụ, yêu cầu vận hành và giai đoạn sản phẩm. Chọn phức tạp quá sớm thì trả chi phí mỗi ngày cho một lợi ích chưa tới; chọn đơn giản quá thì phải viết lại khi lớn. Cách an toàn là bắt đầu đơn giản với **ranh giới rõ ràng**, để tách ra sau khi cần.

## Mục lục
1. Bảng so sánh
2. Câu hỏi để chọn
3. Mặc định khuyến nghị
4. Modular monolith: ranh giới module
5. Cấu trúc thư mục mẫu
6. Ghi quyết định

## 1. Bảng so sánh

| Kiểu | Hợp khi | Cái giá | Tránh khi |
|---|---|---|---|
| **Layered** (route → service → repository) | Ứng dụng nhiều CRUD, team nhỏ, nghiệp vụ vừa phải | Dễ thành "service khổng lồ" nếu không chia module | Nghiệp vụ rất phức tạp, nhiều quy tắc đan nhau |
| **Modular monolith** (module theo nghiệp vụ, mỗi module có tầng riêng) | Hầu hết SaaS giai đoạn đầu và giữa; 1 tới vài team | Phải giữ kỷ luật ranh giới (có thể dùng lint để ép); một phần quá tải có thể kéo cả ứng dụng | Một phần cần scale hoặc công nghệ khác hẳn ngay từ đầu (xử lý video, ML), hoặc nhiều team lớn cần deploy độc lập |
| **Hexagonal / Clean** (ports & adapters: lõi nghiệp vụ không phụ thuộc framework, DB, dịch vụ ngoài) | Lõi nghiệp vụ phức tạp, sống lâu; nhiều tích hợp ngoài có thể thay (thanh toán, AI, email) | Nhiều lớp và interface, chậm hơn khi làm CRUD đơn giản | Ứng dụng chủ yếu là form ↔ bảng |
| **DDD** (bounded context, aggregate, value object, domain event) | Nghiệp vụ phức tạp, nhiều quy tắc, có chuyên gia nghiệp vụ, nhiều miền con | Cần thời gian hiểu nghiệp vụ, nhiều khái niệm | CRUD đơn giản; team chưa hiểu nghiệp vụ |
| **CQRS** (tách mô hình ghi và mô hình đọc) | Đọc và ghi khác nhau nhiều (dashboard, báo cáo, tìm kiếm phức tạp) | Bản rẻ: hàm query riêng hoặc SQL view trên cùng DB, gần như không tốn gì. Bản đầy đủ: kho đọc riêng đồng bộ qua event, có độ trễ và phải lo đồng bộ | Màn đọc chỉ là danh sách và chi tiết thông thường (bản đầy đủ) |
| **Event-driven** (domain event, outbox, queue, worker) | Tác động phụ cần tách khỏi luồng chính (email, thông báo, đồng bộ hệ thống khác), tác vụ dài | Khó debug, phải lo thứ tự, trùng lặp, idempotency | Mọi thứ cần kết quả ngay trong cùng request |
| **Microservices** | Nhiều team độc lập, cần deploy và scale riêng, ranh giới nghiệp vụ đã rõ và ổn định | Vận hành nặng, giao dịch phân tán, network lỗi, quan sát khó | Team nhỏ, sản phẩm đang tìm hướng (monolith trước) |
| **Serverless functions** | Tải thất thường, xử lý theo sự kiện, webhook, cron | Cold start, giới hạn thời gian chạy, giới hạn connection DB, phụ thuộc nhà cung cấp | Workload liên tục nặng, cần kết nối DB lâu dài |

Các kiểu này không loại trừ nhau. Một hệ thống thường kết hợp: modular monolith, bên trong vài module phức tạp dùng DDD/hexagonal, cộng event-driven cho tác vụ phụ.

## 2. Câu hỏi để chọn

| Câu hỏi | Nếu... | Thì... |
|---|---|---|
| Team bao nhiêu người, mấy nhóm làm song song? | 1–8 người, 1–2 nhóm | Monolith (modular). Microservices chỉ khi nhiều nhóm cần deploy độc lập |
| Nghiệp vụ chủ yếu là CRUD hay có miền phức tạp (giá, đặt chỗ, công nợ, duyệt)? | Có miền phức tạp | DDD-lite / hexagonal **cho riêng miền đó**; phần CRUD giữ layered |
| Tích hợp ngoài nào có thể phải thay (thanh toán, AI, SMS/Zalo)? | Có | Port + adapter ở ranh giới đó |
| Đọc và ghi khác nhau nhiều (báo cáo, dashboard)? | Có | CQRS bản rẻ: query riêng, SQL view; kho đọc riêng khi đo thấy cần |
| Có tác vụ dài hoặc tác động phụ (gửi tin, đồng bộ)? | Có | Outbox + worker (event-driven ở phần đó) |
| Phần nào cần scale hoặc công nghệ khác hẳn (video, ML, báo cáo nặng)? | Có, và đo được | Tách riêng phần đó thành service/worker; phần còn lại vẫn monolith |
| Tải thất thường, chủ yếu xử lý theo sự kiện? | Có | Serverless cho phần đó, chú ý giới hạn connection DB |
| Team có người lo vận hành không? Ngân sách? | Không / thấp | Nền tảng managed, càng ít thành phần càng tốt |

Yêu cầu phi chức năng cũng quyết định kiến trúc, hỏi rõ từ đầu:
- **Sẵn sàng (availability)**: chấp nhận ngừng bao lâu? Cần nhiều vùng không?
- **Dữ liệu cá nhân và nơi lưu trữ**: quy định của Việt Nam về bảo vệ dữ liệu cá nhân và lưu trữ dữ liệu trong nước có thể ảnh hưởng tới việc chọn nhà cung cấp và vùng đặt máy chủ; hỏi pháp chế khi khách là doanh nghiệp lớn hoặc dữ liệu nhạy cảm.
- **Cô lập khách hàng**: dùng chung schema hay tách DB (skill `backend`; từ file này: `../../backend/references/multi-tenant.md`).
- **RPO/RTO**: ảnh hưởng tới backup và cách triển khai (skill `ship`; từ file này: `../../ship/references/backup-restore.md`).

## 3. Mặc định khuyến nghị

Cho team nhỏ đến vừa làm SaaS (kể cả multi-tenant):

- **Modular monolith**, module chia theo nghiệp vụ (customers, booking, billing...), bên trong mỗi module là layered đơn giản.
- **Hexagonal chỉ ở ranh giới với bên ngoài**: interface `PaymentGateway`, `AiProvider`, `Notifier` + adapter cho từng nhà cung cấp, để thay hoặc mock khi test.
- **DDD chỉ cho miền lõi phức tạp** (vd booking với quy tắc huỷ, cọc, no-show; billing với giá và chiết khấu): value object, aggregate, state machine. Các module CRUD khác giữ đơn giản.
- **Event-driven qua outbox** cho tác động phụ (gửi tin, đồng bộ), worker riêng cho tác vụ dài.
- Tách service riêng khi có bằng chứng đo được (tải, team, chu kỳ deploy), và module đó đã có ranh giới sạch từ trước.

## 4. Modular monolith: ranh giới module

- Mỗi module **sở hữu bảng của nó**; module khác chỉ truy cập qua service hoặc API công khai của module đó (file `index.ts` export ra ngoài), không query thẳng.
- Không có phụ thuộc vòng tròn giữa module; module dùng chung (`shared`) không import ngược vào module nghiệp vụ.
- Ép bằng công cụ thay vì chỉ dặn: `eslint-plugin-boundaries`, `dependency-cruiser`, rule `import/no-cycle`, hoặc `enforce-module-boundaries` của Nx (JS/TS); `import-linter` (Python); `ArchUnit` (Java). Kiểm cách cấu hình theo tài liệu hiện hành của công cụ trước khi dùng.
- Giao tiếp giữa module: gọi hàm trực tiếp cho truy vấn cần kết quả ngay; domain event (qua outbox) cho phản ứng không cần ngay.

## 5. Cấu trúc thư mục mẫu

```text
apps/api/src/
├── modules/
│   ├── customers/            # CRUD: layered đơn giản
│   │   ├── customers.routes.ts
│   │   ├── customers.service.ts
│   │   ├── customers.repository.ts
│   │   ├── customers.schema.ts
│   │   └── index.ts          # API công khai của module
│   └── booking/              # miền lõi phức tạp: DDD-lite
│       ├── domain/           # entity, value object, state machine, quy tắc (không import framework/ORM)
│       ├── application/      # use case: điều phối, transaction, gọi port
│       ├── infrastructure/   # repository, adapter
│       ├── booking.routes.ts
│       └── index.ts
├── shared/                   # errors, logger, config, db, tenant context
└── integrations/             # adapter cho dịch vụ ngoài: payment, ai, sms
```

Frontend: chia theo tính năng (`features/customers/...`) với component, hook, schema để cạnh nhau; phần dùng chung để ở `components/ui`, `lib`.

## 6. Ghi quyết định

Ghi vào `docs/plan/ARCHITECTURE.md`, bảng ADR: chọn kiểu nào, cho phần nào, vì sao, phương án đã loại, khi nào xem lại (vd "tách billing thành service khi có team riêng hoặc tải vượt X").
