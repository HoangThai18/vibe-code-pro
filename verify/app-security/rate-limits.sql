-- UNLOGGED: nhanh hơn, mất dữ liệu khi Postgres sập (chấp nhận được với bộ đếm); job dọn dòng cũ mỗi giờ
CREATE UNLOGGED TABLE rate_limits (
  key          text        NOT NULL,   -- vd 'login:ip:1.2.3.4', 'ai:user:<uuid>'
  window_start timestamptz NOT NULL,
  count        integer     NOT NULL,
  PRIMARY KEY (key, window_start)
);
-- Dọn: DELETE FROM rate_limits WHERE window_start < now() - interval '1 day';
