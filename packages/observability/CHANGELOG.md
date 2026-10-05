# @semantask/observability

## 1.2.0

### Minor Changes

- d63de76: Harden classifier shadow metrics/isolation, add assignee/due heuristics, and ship a labeled evaluation harness. Production default remains `TASK_CLASSIFIER_MODE=regex`.

  ### Added
  - `classifier_classifications_total{mode,source}`; disagreement counter labels `{regex_type,llm_type}`
  - Failure-isolated disagreement hooks; shadow LLM failures cannot break classification
  - Deterministic assignee (@mention/email) + due-date heuristics → MessageIntent / WorkSuggestion candidates
  - Extractor version `intelligent-v7-entity-heuristics`
  - Seed gold eval harness (`packages/services/eval/`) with CI gate (≥0.7 type accuracy)

  ### Compatibility
  - `regex` remains default authority; shadow never alters product path or execution

- 5049ff5: Classifier ingress creates reviewable WorkSuggestions under `suggest_only` without enqueueing execution.

  ### Added
  - `SUGGESTION_INGRESS` / `SUGGESTION_BLOCK_EXEC` flags and `shouldBlockExecutionEnqueue`
  - Dual-write: actionable classify → MessageIntent + idempotent WorkSuggestion (`SUGGESTION_INGRESS=1`)
  - Shared enqueue guard: refuse `task.execution.requested` at the worker/enqueue boundary under suggest_only
  - Worker defense-in-depth for leaked execution events; `classifier_disagreement_total` hook
  - Metrics: `suggestions_created_total`, `suggestion_latency_ms`, `execution_enqueue_attempted_while_suggest_only_total` + P0 alert

  ### Compatibility
  - `SUGGESTION_INGRESS=0` (default) preserves legacy classify → Task → enqueue behavior

- eb2ed2b: Phase 2 hardening — emit `work.suggestion.accepted|dismissed` outbox events, triage accept/dismiss metrics + latency, and accept→execution-while-disabled safety signal. AuthZ matrix documented as conversation participant OR org owner/admin (no behavior change; no conversation manager role).

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
