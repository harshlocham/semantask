# @semantask/observability

## 1.2.0

### Minor Changes

- 5049ff5: Classifier ingress creates reviewable WorkSuggestions under `suggest_only` without enqueueing execution.

  ### Added
  - `SUGGESTION_INGRESS` / `SUGGESTION_BLOCK_EXEC` flags and `shouldBlockExecutionEnqueue`
  - Dual-write: actionable classify → MessageIntent + idempotent WorkSuggestion (`SUGGESTION_INGRESS=1`)
  - Shared enqueue guard: refuse `task.execution.requested` at the worker/enqueue boundary under suggest_only
  - Worker defense-in-depth for leaked execution events; `classifier_disagreement_total` hook
  - Metrics: `suggestions_created_total`, `suggestion_latency_ms`, `execution_enqueue_attempted_while_suggest_only_total` + P0 alert

  ### Compatibility
  - `SUGGESTION_INGRESS=0` (default) preserves legacy classify → Task → enqueue behavior

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
