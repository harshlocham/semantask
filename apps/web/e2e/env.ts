import path from "node:path";

const webRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(webRoot, "../..");

export const E2E_BASE_URL = process.env.E2E_BASE_URL?.trim() || "http://127.0.0.1:3000";
export const E2E_SOCKET_URL = process.env.E2E_SOCKET_URL?.trim() || "http://127.0.0.1:3001";
export const E2E_MAIL_DIR = process.env.E2E_MAIL_DIR?.trim() || path.join(webRoot, "e2e", ".mail");

const isCi = Boolean(process.env.CI);

export const E2E_MONGODB_URI =
    process.env.E2E_MONGODB_URI?.trim()
    || (isCi
        ? "mongodb://127.0.0.1:27017/semantask_e2e"
        : "mongodb://127.0.0.1:27018/semantask_e2e");

export const E2E_REDIS_URL =
    process.env.E2E_REDIS_URL?.trim()
    || (isCi ? "redis://127.0.0.1:6379" : "redis://127.0.0.1:6380");

/** Curated env for Playwright webServer processes. Does not inherit a developer .env. */
export function e2eStackEnv(): NodeJS.ProcessEnv {
    return {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        CI: process.env.CI,
        NODE_ENV: isCi ? "production" : "development",
        MONGODB_URI: E2E_MONGODB_URI,
        REDIS_URL: E2E_REDIS_URL,
        ACCESS_TOKEN_SECRET: process.env.ACCESS_TOKEN_SECRET || "e2e-access-secret-at-least-32-chars",
        REFRESH_TOKEN_SECRET: process.env.REFRESH_TOKEN_SECRET || "e2e-refresh-secret-at-least-32-chars",
        INTERNAL_SECRET: process.env.INTERNAL_SECRET || "e2e-internal-secret",
        INTERNAL_SECRET_SOCKET: process.env.INTERNAL_SECRET_SOCKET || process.env.INTERNAL_SECRET || "e2e-internal-secret",
        INTERNAL_SECRET_WORKER: process.env.INTERNAL_SECRET_WORKER || "e2e-internal-worker-secret",
        ORIGIN: `${E2E_BASE_URL},${E2E_SOCKET_URL}`,
        APP_URL: E2E_BASE_URL,
        NEXT_PUBLIC_SOCKET_URL: E2E_SOCKET_URL,
        SOCKET_SERVER_URL: E2E_SOCKET_URL,
        WEB_SERVER_URL: E2E_BASE_URL,
        COORDINATION_BOARD: "1",
        ORG_DASHBOARD: "1",
        TASK_CLASSIFIER_MODE: "regex",
        E2E_MAIL_DIR,
        METRICS_PORT: "9091",
        TURBO_ENV_MODE: "loose",
    };
}

export { repoRoot, webRoot };
