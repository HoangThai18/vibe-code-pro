// load/customers-list.js — chạy: k6 run -e BASE_URL=https://staging.example.vn load/customers-list.js
import http from 'k6/http';
import { check } from 'k6';

// Mỗi tenant một token đăng nhập của tài khoản test trên staging (tạo bằng script seed, không dùng tài khoản thật)
const TENANTS = JSON.parse(open('./tenants.json'));
const BASE_URL = __ENV.BASE_URL;

export const options = {
  scenarios: {
    list_customers: {
      executor: 'ramping-arrival-rate',   // giữ đúng số request/giây dù server chậm đi
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 200,
      stages: [
        { target: Number(__ENV.RPS || 100), duration: __ENV.RAMP || '30s' },   // tăng dần lên mức mục tiêu
        { target: Number(__ENV.RPS || 100), duration: __ENV.HOLD || '1m' },    // giữ ở mức đó
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],                               // dưới 1% lỗi
    'http_req_duration{name:customers_list}': ['p(95)<300'],      // p95 dưới 300 ms
  },
};

export default function () {
  const tenant = TENANTS[Math.floor(Math.random() * TENANTS.length)];   // trải đều các tenant như thật
  const res = http.get(`${BASE_URL}/v1/t/${tenant.id}/customers?limit=20`, {
    headers: { authorization: `Bearer ${tenant.token}` },
    tags: { name: 'customers_list' },                                    // gom các URL khác tenant vào một nhóm số liệu
  });
  check(res, { 'status 200': (r) => r.status === 200 });
}
