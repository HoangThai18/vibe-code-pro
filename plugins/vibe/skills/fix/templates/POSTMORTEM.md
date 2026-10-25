# Postmortem: Tên sự cố

_Ngày: YYYY-MM-DD · Mức độ: nghiêm trọng / cao / trung bình · Người viết: ..._

Mục đích là cải thiện hệ thống và quy trình, không phải tìm người để trách.

## Tóm tắt
2–3 câu: chuyện gì xảy ra, ảnh hưởng ai, đã khắc phục ra sao.

## Ảnh hưởng
- Thời gian: từ HH:mm tới HH:mm (tổng ... phút)
- Tenant / người dùng bị ảnh hưởng: ...
- Chức năng: ...
- Dữ liệu: không ảnh hưởng / hỏng / lộ (chi tiết)

## Dòng thời gian
| Thời điểm | Sự kiện |
|---|---|
| HH:mm | Deploy vX.Y.Z |
| HH:mm | Cảnh báo / khách báo lỗi |
| HH:mm | Rollback / tắt flag |
| HH:mm | Hệ thống ổn định |

## Nguyên nhân gốc
Vì sao lỗi xảy ra, và vì sao các lớp kiểm tra (test, review, staging, cảnh báo) không bắt được nó sớm hơn.

## Điều đã giúp / điều đã cản trở
- Giúp: ...
- Cản trở: ...

## Hành động phòng ngừa
| Hành động | Người phụ trách | Task card | Hạn |
|---|---|---|---|
