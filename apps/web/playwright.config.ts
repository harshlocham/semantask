import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { E2E_BASE_URL, E2E_SOCKET_URL, e2eStackEnv } from "./e2e/env";

const webRoot = __dirname;
const repoRoot = path.resolve(webRoot, "../..");
const isCi = Boolean(process.env.CI);
const stackEnv = e2eStackEnv();

export default defineConfig({
    testDir: "./e2e",
    testMatch: "**/*.spec.ts",
    fullyParallel: false,
    forbidOnly: isCi,
    retries: isCi ? 1 : 0,
    workers: 1,
    reporter: isCi ? [["github"], ["html", { open: "never" }]] : [["list"]],
    globalSetup: "./e2e/global-setup.ts",
    timeout: 60_000,
    use: {
        baseURL: E2E_BASE_URL,
        trace: "on-first-retry",
        screenshot: "only-on-failure",
    },
    projects: [
        {
            name: "chromium",
            use: { ...devices["Desktop Chrome"] },
        },
    ],
    webServer: [
        {
            command: isCi ? "pnpm start" : "pnpm dev",
            cwd: webRoot,
            url: E2E_BASE_URL,
            reuseExistingServer: !isCi,
            timeout: 180_000,
            env: stackEnv,
        },
        {
            command: "pnpm dev",
            cwd: path.join(repoRoot, "apps/socket"),
            url: `${E2E_SOCKET_URL}/health`,
            reuseExistingServer: !isCi,
            timeout: 120_000,
            env: stackEnv,
        },
        {
            command: "pnpm dev",
            cwd: path.join(repoRoot, "apps/task-worker"),
            url: "http://127.0.0.1:9091/metrics",
            reuseExistingServer: !isCi,
            timeout: 120_000,
            env: stackEnv,
        },
    ],
});
