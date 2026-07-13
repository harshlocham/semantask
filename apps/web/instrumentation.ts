export async function register() {
    if (process.env.NEXT_RUNTIME !== "nodejs") {
        return;
    }

    const { ensureDefaultMetrics, getCorrelationId } = await import(
        /* webpackIgnore: true */
        "@semantask/observability"
    );
    const { startTracing } = await import(
        /* webpackIgnore: true */
        "@semantask/observability/tracing"
    );
    const { setCorrelationIdResolver } = await import(
        /* webpackIgnore: true */
        "@semantask/types/utils/internal-bridge-auth"
    );

    ensureDefaultMetrics("web");
    startTracing("web");
    setCorrelationIdResolver(() => getCorrelationId());
}
