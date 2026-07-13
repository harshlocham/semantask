# @semantask/observability

## 1.1.0

### Minor Changes

- 4a0b104: ## Runtime

  Phase 4 Observability — structured correlation logs, Prometheus metrics, OpenTelemetry foundation, and SLO alerts (Production Roadmap 4.1–4.4).

  ### Added
  - `@semantask/observability` package: JSON logger + ALS `correlationId`, Prometheus registry, OTLP tracing bootstrap
  - Outbox payloads carry `correlationId` (and `traceparent` when tracing); worker binds ALS on claim; `x-correlation-id` on internal bridges
  - Scrape endpoints: web `GET /api/metrics`, socket `GET /metrics`, worker `METRICS_PORT` `/metrics`; RUM moved to `POST /api/metrics/rum`
  - Manual spans `message.created` → `task.execution` → `tool.execute` when `OTEL_EXPORTER_OTLP_ENDPOINT` is set
  - `docs/operations/SLO.md` and `deploy/observability/` Prometheus/alerts/Grafana assets

  ### Updated
  - Task-worker execution logger wraps shared JSON logger; LLM metrics dual-write histogram/counters
  - Production roadmap Phase 4 milestones marked complete
