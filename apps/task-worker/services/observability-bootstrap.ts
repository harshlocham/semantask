import {
    ensureDefaultMetrics,
    getCorrelationId,
} from "@semantask/observability";
import { startTracing } from "@semantask/observability/tracing";
import { setCorrelationIdResolver } from "@semantask/types/utils/internal-bridge-auth";

let bootstrapped = false;

export function bootstrapWorkerObservability(): void {
    if (bootstrapped) {
        return;
    }
    bootstrapped = true;
    ensureDefaultMetrics("task-worker");
    startTracing("task-worker");
    setCorrelationIdResolver(() => getCorrelationId());
}
