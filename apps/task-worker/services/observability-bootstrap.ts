import {
    ensureDefaultMetrics,
    getCorrelationId,
    startTracing,
} from "@semantask/observability";
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
