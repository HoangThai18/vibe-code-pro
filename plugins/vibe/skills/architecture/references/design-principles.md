# Nguyên tắc thiết kế, SOLID, pattern, refactor

Nguyên tắc là công cụ để quyết định, không phải luật để tuân thủ máy móc. Câu hỏi chung cho mọi nguyên tắc: "áp vào đây thì code dễ hiểu, dễ sửa, dễ test hơn thật không, hay chỉ thêm lớp?".

## Mục lục
1. SOLID áp dụng thực tế
2. Các nguyên tắc khác
3. Pattern nên dùng và nên tránh
4. Code smell và cách sửa
5. Quy tắc refactor

## 1. SOLID áp dụng thực tế

| Nguyên tắc | Ý nghĩa thực tế | Dùng khi | Quá đà khi |
|---|---|---|---|
| **S**: một lý do để thay đổi | Tách theo **ai/điều gì** khiến code phải đổi (quy tắc tính giá vs định dạng hoá đơn), không theo số dòng | Một service ôm nhiều nghiệp vụ khác nhau, sửa chỗ này vỡ chỗ kia | Chẻ mỗi hàm thành một class |
| **O**: mở để mở rộng, đóng để sửa | Điểm biến đổi thật (nhiều cách tính phí, nhiều kênh gửi thông báo) thì thêm biến thể mới mà không sửa code cũ | Đã có biến thể thứ hai thật sự | Dựng plugin system cho thứ chỉ có một cách |
| **L**: thay thế được | Mọi implementation của một interface (adapter thật, fake trong test) phải giữ đúng hợp đồng: cùng ý nghĩa đầu vào, đầu ra, lỗi; không đòi thêm điều kiện | Mọi chỗ có interface, kể cả khi dùng composition thay cho kế thừa | Không có: vi phạm LSP là bug, nhất là fake trong test hành xử khác bản thật |
| **I**: interface nhỏ, đúng nhu cầu | Port như `Notifier.send()` thay vì interface 20 hàm | Ở ranh giới module và tích hợp ngoài | Tạo interface cho mọi class nội bộ chỉ có một implementation |
| **D**: phụ thuộc vào trừu tượng | Phần nghiệp vụ **định nghĩa** interface (port) theo nhu cầu của nó, hạ tầng implement port đó; phụ thuộc chỉ trỏ vào trong. Truyền implementation qua tham số/constructor (DI) là cách thực hiện | Ranh giới với hạ tầng và dịch vụ ngoài, chỗ cần thay khi test | Tạo interface và inject cho mọi thứ, kể cả hàm thuần |

```ts
// Port do phần nghiệp vụ định nghĩa, cho cổng thanh toán kiểu "charge trực tiếp" (thẻ, ví đã liên kết)
export interface PaymentGateway {
  charge(input: { amount: Money; idempotencyKey: string }): Promise<{ id: string }>;
}

export function makeConfirmAppointment(deps: { payments: PaymentGateway; repo: AppointmentRepo; now: () => Date }) {
  return async (id: string, deposit: Money, attemptId: string) => {
    const appt = await deps.repo.get(id);
    appt.assertCanConfirm();                       // 1. kiểm trạng thái TRƯỚC khi trừ tiền
    await deps.payments.charge({                   // 2. mỗi lần khách thử thanh toán một key riêng
      amount: deposit,                             //    (retry do lỗi mạng thì gửi lại cùng attemptId)
      idempotencyKey: `deposit:${id}:${attemptId}`,
    });
    appt.confirm(deposit, deps.now());
    await deps.repo.save(appt);                    // 3. lưu có kiểm version; xung đột thì báo lỗi, đối soát khoản đã trừ
  };
}
```

Đổi nhà cung cấp cùng kiểu "charge trực tiếp" = thêm adapter mới, use case không đổi; test = truyền fake gateway (fake phải hành xử đúng như bản thật, theo nguyên tắc L).

Cổng kiểu chuyển hướng hoặc QR (VNPay, MoMo, nhiều cổng nội địa) không có `charge()` đồng bộ: luồng là `createPayment()` → trả `redirectUrl` hoặc mã QR → khách thanh toán → cổng gọi về **IPN/webhook**. Khi đó port là `createPayment` + một handler webhook kiểm chữ ký, xử lý idempotent (nhận trùng không xác nhận hai lần), và chỉ lúc đó mới chuyển lịch hẹn sang `confirmed`. Lịch hẹn nằm ở trạng thái chờ thanh toán trong lúc chờ, có hạn huỷ tự động.

## 2. Các nguyên tắc khác

- **KISS và YAGNI**: giải pháp đơn giản nhất đáp ứng yêu cầu hiện tại; không xây cho "sau này có thể".
- **DRY có chừng mực**: gộp ngay khi hai chỗ là **cùng một tri thức** (cùng quy tắc nghiệp vụ, cùng công thức). Hai đoạn chỉ trông giống nhau nhưng thay đổi vì lý do khác nhau thì để riêng; với loại này, chờ tới lần lặp thứ ba mới cân nhắc trừu tượng hoá.
- **Composition hơn inheritance**: ghép hành vi bằng hàm và đối tượng nhỏ; kế thừa sâu khó đổi.
- **Hàm thuần cho logic nghiệp vụ**: nhận dữ liệu, trả kết quả, không I/O. Dễ test, dễ hiểu; I/O để ở rìa (use case, repository).
- **Làm trạng thái sai không biểu diễn được**: dùng union type, enum, value object thay vì nhiều boolean (`isPaid`, `isCancelled` cùng `true` là trạng thái vô nghĩa).
- **Fail fast ở biên**: validate input ngay khi vào hệ thống; bên trong tin vào kiểu dữ liệu đã kiểm.
- **Tường minh hơn "phép thuật"**: luồng dữ liệu đọc được từ code; hạn chế decorator, metaprogramming, global state khó lần theo.
- **Phụ thuộc một chiều**: nghiệp vụ không biết tới framework web, ORM, UI.

## 3. Pattern nên dùng và nên tránh

Nên dùng khi đúng chỗ:

| Pattern | Dùng cho |
|---|---|
| Repository | Gom truy cập dữ liệu của một aggregate/module; dễ thay bằng fake khi test use case |
| Service / use case | Một hành động nghiệp vụ có điều phối và transaction |
| Strategy (map hàm hoặc object) | Quy tắc thay đổi theo loại: cách tính phí, cách gửi thông báo |
| Adapter | Bọc API bên ngoài sau interface của mình |
| State machine | Vòng đời có trạng thái và luật chuyển (đơn, lịch hẹn, duyệt) |
| Outbox | Phát event hoặc gửi tác động phụ mà không mất khi lỗi |
| Result type hoặc error class có `code` | Lỗi nghiệp vụ rõ ràng, map sang HTTP ở một chỗ |

Tránh theo mặc định: kế thừa nhiều tầng, generic repository cho mọi bảng, service locator / biến global để lấy dependency, event sourcing khi chưa có nhu cầu rõ, abstract factory cho thứ chỉ có một biến thể.

## 4. Code smell và cách sửa

| Dấu hiệu | Thường do | Sửa |
|---|---|---|
| Hàm dài, nhiều tầng if | Làm nhiều việc | Tách hàm theo bước; guard clause sớm |
| `switch (type)` lặp ở nhiều nơi | Thiếu điểm mở rộng | Strategy map hoặc đa hình |
| Tham số boolean (`send(true, false)`) | Một hàm làm hai việc | Tách hai hàm hoặc dùng options object có tên |
| Kiểu nguyên thuỷ cho khái niệm nghiệp vụ (tiền là `number`, sđt là `string` khắp nơi) | Thiếu value object | Value object có validate |
| Sửa một tính năng phải đụng 5 file ở 5 module | Ranh giới module sai | Gom về một module, hoặc định lại ranh giới |
| Service "khổng lồ" (God class) | Không tách theo lý do thay đổi | Tách theo use case hoặc theo miền con |
| Hàm của module A dùng toàn dữ liệu của module B | Đặt sai chỗ (feature envy) | Chuyển hàm về module B, A gọi qua API |

## 5. Quy tắc refactor

- Refactor là thay đổi cấu trúc **không đổi hành vi**: có test bao trước (thiếu thì viết characterization test), chạy test sau mỗi bước nhỏ.
- Commit refactor tách khỏi commit tính năng.
- Chỉ refactor trong phạm vi task, hoặc phần cần thiết để làm task gọn hơn; phần lớn hơn thì ghi task card riêng và hỏi user.
- Đo trước và sau nếu refactor vì hiệu năng.
