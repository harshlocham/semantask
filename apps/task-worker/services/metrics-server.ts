import http from "node:http";
import {
    ensureDefaultMetrics,
    prometheusContentType,
    renderPrometheusMetrics,
} from "@semantask/observability/metrics";
import { logExecution } from "./execution-logger.js";

/**
 * Lightweight scrape server for the task-worker (no Express).
 */
export function startWorkerMetricsServer(port = Number(process.env.METRICS_PORT || 9091)): http.Server {
    ensureDefaultMetrics("task-worker");

    const server = http.createServer(async (req, res) => {
        if (req.method === "GET" && (req.url === "/metrics" || req.url?.startsWith("/metrics?"))) {
            try {
                const body = await renderPrometheusMetrics();
                res.writeHead(200, { "Content-Type": prometheusContentType() });
                res.end(body);
            } catch (error) {
                res.writeHead(500, { "Content-Type": "text/plain" });
                res.end(error instanceof Error ? error.message : "metrics error");
            }
            return;
        }

        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("not found");
    });

    server.on("error", (error: NodeJS.ErrnoException) => {
        logExecution("error", {
            event: "metrics_server.bind_failed",
            port,
            code: error.code,
            error: error.message,
        });
    });

    server.listen(port, "0.0.0.0");
    return server;
}
