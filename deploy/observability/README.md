# Observability deploy assets

Prometheus scrape jobs, alert rules, and a minimal Grafana dashboard for Phase 4 SLOs.

## Quick start (local)

1. Run web, socket, and task-worker with Mongo/Redis as usual.
2. Ensure worker exposes metrics: `METRICS_PORT=9091` (default).
3. Optionally enable traces: `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`.
4. Start Prometheus with this directory as config context:

```bash
prometheus --config.file=deploy/observability/prometheus.yml
```

5. Import `grafana-dashboard.json` into Grafana (Prometheus datasource).

## Files

| File | Purpose |
|------|---------|
| `prometheus.yml` | Scrape web `/api/metrics`, socket `/metrics`, worker `:9091/metrics` |
| `alerts.yml` | Outbox backlog, stuck tasks, task failure rate |
| `grafana-dashboard.json` | Outbox lag, task rates, LLM p95 panels |

Adjust `static_configs` hostnames for your deploy (Docker Compose service names, k8s DNS, etc.).
