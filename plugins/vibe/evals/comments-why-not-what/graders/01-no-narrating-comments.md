---
type: regex
target:
  source: file
  path: src/billing/total.js
pattern: '^\s*(?://+|/?\*+)\s*(?:import|imports|define[sd]?|create[sd]?|initiali[sz]e[sd]?|loop(?:s|ing)?|iterate[sd]?|return(?:s|ing)?|check(?:s|ing)? if|get(?:s)? the|set(?:s)? the|calculate[sd]? the|function (?:to|that)|helper (?:to|that)|added|updated|changed|new:|step \d|tính tổng|lặp qua|trả về|khởi tạo|kiểm tra xem|hàm này|thêm mới|cập nhật)\b'
flags: im
match: not_contains
---
