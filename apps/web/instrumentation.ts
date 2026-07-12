export async function register() {
    if (process.env.NEXT_RUNTIME !== "nodejs") {
        return;
    }

    const { ensureDefaultMetrics, getCorrelationId, startTracing } = await import(
        "@semantask/observability"
    );
    const { setCorrelationIdResolver } = await import(
        "@semantask/types/utils/internal-bridge-auth"
    );

    ensureDefaultMetrics("web");
    startTracing("web");
    setCorrelationIdResolver(() => getCorrelationId());
}
