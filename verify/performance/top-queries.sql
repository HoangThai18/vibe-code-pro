-- 10 câu tốn tổng thời gian nhiều nhất từ lần reset gần nhất
SELECT round(total_exec_time)              AS total_ms,
       calls,
       round(mean_exec_time::numeric, 1)   AS mean_ms,
       round((100 * total_exec_time / sum(total_exec_time) OVER ())::numeric, 1) AS pct,
       left(regexp_replace(query, '\s+', ' ', 'g'), 80) AS query
  FROM pg_stat_statements
 WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
 ORDER BY total_exec_time DESC
 LIMIT 10;
