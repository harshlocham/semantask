# Service Level Objectives (SLOs)

Operational SLIs and targets for Semantask autonomous execution. Metrics are scraped from Prometheus endpoints listed below.

## Scrape endpoints

| Service | Endpoint | Default port |
|---------|----------|--------------|
| Web | `GET /api/metrics` | app port (3000) |
| Socket | `GET /metrics` | `PORT` (3001) |
| Task worker | `GET /metrics` | `METRICS_PORT` (9091) |

Client RUM beacons post to `POST /api/metrics/rum` (not scraped by Prometheus).

Prometheus scrape config lives in [`deploy/observability/prometheus.yml`](../../deploy/observability/prometheus.yml). Alert rules: [`deploy/observability/alerts.yml`](../../deploy/observability/alerts.yml). Grafana dashboard: [`deploy/observability/grafana-dashboard.json`](../../deploy/observability/grafana-dashboard.json).

## SLIs

| SLI | Metric(s) | How measured |
|-----|-----------|--------------|
| Outbox claim lag | `outbox_lag_seconds{topic}` | Age of oldest pending/failed outbox event per topic |
| Outbox backlog | `outbox_pending{topic}` | Count of claimable pending/failed events |
| Task success rate | `task_execution_total{outcome}` | `succeeded / (succeeded + failed)` over a window |
| Stuck task rate | `task_stuck_detected_total` | Remediations (`logged`, `failed`, `retry_scheduled`, …) |
| LLM latency p95 | `llm_request_duration_seconds` | Histogram quantile 0.95 by `provider` |

## Targets

| SLI | Target | Notes |
|-----|--------|-------|
| Outbox claim lag | p99 < 60s under normal load | Sustained lag > 5m with backlog warrants alert |
| Outbox backlog | pending < 100 for 5m | See `OutboxBacklogHigh` |
| Task success rate | ≥ 90% over 15m | Failures / (success + fail) < 10% |
| Stuck tasks | 0 sustained detections | Any stuck detection for 10m alerts |
| LLM p95 | < 10s per provider | Tune per model; histogram buckets up to 60s |

## Correlation & tracing

- Logs include `correlationId` (JSON) from web ingress → outbox payload → worker ALS → `x-correlation-id` on internal socket calls.
- Set `OTEL_EXPORTER_OTLP_ENDPOINT` (e.g. `http://localhost:4318`) to enable OTLP traces. Spans: `message.created`, `task.execution`, `tool.execute`.
- Local Tempo/Jaeger: point OTLP HTTP to the collector; see [`deploy/observability/README.md`](../../deploy/observability/README.md).

## Related env

| Variable | Purpose |
|----------|---------|
| `METRICS_PORT` | Worker metrics HTTP port (default `9091`) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP HTTP base or `/v1/traces` URL; unset = tracing no-op |
| `x-correlation-id` | Request header; minted if absent at web/socket ingress |
