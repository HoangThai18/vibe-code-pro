// apps/web/src/report-web-vitals.ts — gọi một lần khi app khởi động
import { onCLS, onINP, onLCP, type Metric } from 'web-vitals';

// Số đo từ trình duyệt thật của người dùng: nguồn đúng nhất cho INP (cần tương tác thật)
function send(metric: Metric) {
  const body = JSON.stringify({
    name: metric.name,        // LCP | INP | CLS
    value: metric.value,
    rating: metric.rating,    // good | needs-improvement | poor
    id: metric.id,
    page: location.pathname,  // chỉ đường dẫn, không gửi query string (có thể chứa dữ liệu cá nhân)
  });
  // sendBeacon vẫn gửi được khi người dùng đóng tab
  if (!navigator.sendBeacon?.('/v1/vitals', body)) {
    void fetch('/v1/vitals', { method: 'POST', body, keepalive: true });
  }
}

export function reportWebVitals() {
  onLCP(send);
  onINP(send);
  onCLS(send);
}
