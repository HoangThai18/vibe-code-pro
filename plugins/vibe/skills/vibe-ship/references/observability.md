# Monitoring: logs, metrics, traces, alerts

Goal: know whether the system is healthy before users report it, and when something fails, find the cause in minutes, not hours.

## Contents
1. Structured logs
2. Error tracking
3. Metrics
4. Traces
5. Healthchecks
6. Alerts
7. Dashboards
8. Multi-tenant

## 1. Structured logs

- JSON logs; each line has `time`, `level`, `msg`, `requestId`, `tenantId`, `userId` (id, not email), `route`, `durationMs`, `status`.
- Generate `requestId` at the edge (or take it from the load balancer header), pass it through every internal call and job, and return it to the client in the error format so users can report errors with it.
- Never log passwords, tokens, card numbers, sensitive content, or full payloads of personal forms. Configure a redact list in the logger.
- Levels: `error` when a human must act; `warn` for self-healing anomalies; `info` for important business events; `debug` off in production.

## 2. Error tracking

- Use Sentry or an equivalent for both BE and FE: errors grouped by type, with stack trace and release version, tagged with `tenantId` and `requestId`.
- Upload source maps at FE build time (don't serve them publicly unless you're fine exposing the code).
- Review every new error after a release the same day; recurring errors become task cards.

## 3. Metrics

- **RED** per endpoint and job: Rate (requests), Errors (rate of 5xx and important business errors), Duration (p50, p95, p99).
- **USE** for resources: CPU, RAM, DB connections in use/max, job queue length, disk space.
- Business metrics: orders, appointments, payment success rate. They often reveal incidents before technical metrics do.
- Set SLOs for a few main flows, e.g. "99.5% of create-appointment requests succeed in under 1 second over 30 days".

## 4. Traces

With several services, queues or many outbound calls, add tracing (OpenTelemetry) to see where a request goes and which step is slow. For a small monolith, logs with `requestId` and `durationMs` are usually enough at first.

## 5. Healthchecks

- **Liveness** (`/health/live`): the process is alive; don't check external dependencies, or a flaky DB makes the platform restart the whole app.
- **Readiness** (`/health/ready`): ready for traffic: DB reachable, migrations at the right version. Used for zero-downtime deploys.
- Never expose internals (library versions, connection strings) on a public endpoint.

## 6. Alerts

- Alert on **symptoms**: rising error rate, p95 over threshold, job queue backing up, payment failures, backup failures, disk nearly full, SSL certificate nearly expired.
- Each alert links a runbook: what it means, how to check, how to mitigate.
- Severity: urgent (page the on-call now) and non-urgent (handle in working hours). An alert that fires with nothing to do gets its threshold fixed or is deleted; otherwise the team learns to ignore alerts.
- External uptime checks for the home page and the main API.

## 7. Dashboards

One overview dashboard per environment: RED for main flows, errors by release, DB resources, job queues, business metrics. Mark deploy times on the charts to see at once which deploy caused a change.

## 8. Multi-tenant

- Every log, error and metric carries `tenantId`, to know who an incident affects and notify the right customers.
- Watch for noisy-neighbor tenants: requests, query time, storage per tenant; combine with rate limits and quotas.
- Never put high-cardinality tenant data (e.g. record ids) in metric labels; `tenantId` is fine with a moderate number of tenants; with many tenants, put it in logs instead of metric labels.
