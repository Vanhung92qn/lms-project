// k6 smoke test — verifies the public stack holds up under a light load.
//
// Usage:
//   k6 run scripts/k6-smoke.js
//   k6 run -e BASE=https://khohoc.online scripts/k6-smoke.js
//
// Design:
//   - 10 virtual users ramping in over 10s, holding for 30s, ramp-down 5s.
//   - Each VU loops through the happy-path endpoints a real user hits:
//     public catalog, login, dashboard enrollments, lesson fetch.
//   - Threshold: p(95) < 800ms on reads, 99%+ success rate.
//
// NOT in scope:
//   - Submission grading (would hammer the sandbox orchestrator + spin a
//     Docker container per request — run a separate targeted test).
//   - AI tutor streaming (SSE is awkward to load-test with k6; would
//     also burn DeepSeek credits).
//   - Writes that mutate DB state (we don't want the smoke to pollute
//     the pilot database with 300 fake payments).

import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE || 'http://127.0.0.1:4000/api/v1';

export const options = {
  stages: [
    { duration: '10s', target: 10 },
    { duration: '30s', target: 10 },
    { duration: '5s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],             // <1% errors
    http_req_duration: ['p(95)<800'],           // 95th percentile <800ms
    'http_req_duration{endpoint:login}': ['p(95)<1500'], // argon2 is slower
  },
};

const STUDENT_EMAIL = 'student@khohoc.online';
const STUDENT_PASSWORD = 'Student@12345';

export default function () {
  // 1. Public catalog — unauth
  let res = http.get(`${BASE}/courses`, { tags: { endpoint: 'catalog' } });
  check(res, { 'catalog 200': (r) => r.status === 200 });
  sleep(0.3);

  // 2. Login (per VU — argon2 verify is the slowest single endpoint)
  res = http.post(
    `${BASE}/auth/login`,
    JSON.stringify({ email: STUDENT_EMAIL, password: STUDENT_PASSWORD }),
    { headers: { 'Content-Type': 'application/json' }, tags: { endpoint: 'login' } },
  );
  check(res, { 'login 200': (r) => r.status === 200 });
  if (res.status !== 200) {
    sleep(1);
    return;
  }
  const token = res.json('tokens.access_token');
  const headers = { Authorization: `Bearer ${token}` };

  // 3. My enrollments
  res = http.get(`${BASE}/me/enrollments`, { headers, tags: { endpoint: 'enrollments' } });
  check(res, { 'enrollments 200': (r) => r.status === 200 });
  sleep(0.3);

  // 4. Wallet balance
  res = http.get(`${BASE}/wallet/me`, { headers, tags: { endpoint: 'wallet' } });
  check(res, { 'wallet 200': (r) => r.status === 200 });

  // 5. Mastery + recommendations
  res = http.get(`${BASE}/knowledge/me/mastery`, { headers, tags: { endpoint: 'mastery' } });
  check(res, { 'mastery 200': (r) => r.status === 200 });

  res = http.get(`${BASE}/knowledge/me/recommendations`, { headers, tags: { endpoint: 'recs' } });
  check(res, { 'recommendations 200': (r) => r.status === 200 });

  sleep(1);
}
