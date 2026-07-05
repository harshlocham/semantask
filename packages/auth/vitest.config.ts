import { defineConfig, configDefaults } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const alias = {
    "@": path.resolve(__dirname, "../db"),
};

// Loaded before every test file: applies test env defaults (JWT secrets, etc.).
const envSetup = path.resolve(__dirname, "./__tests__/helpers/env.ts");
const integrationGlobalSetup = path.resolve(__dirname, "./__tests__/helpers/global-setup.ts");

export default defineConfig({
    resolve: { alias },
    test: {
        projects: [
            {
                resolve: { alias },
                test: {
                    name: "unit",
                    environment: "node",
                    globals: true,
                    setupFiles: [envSetup],
                    // Pure-unit specs: the new `unit/` folder plus existing flat
                    // specs, excluding anything named `*.integration.test.ts`.
                    include: [
                        "__tests__/unit/**/*.test.ts",
                        "__tests__/*.test.ts",
                    ],
                    exclude: [
                        ...configDefaults.exclude,
                        "__tests__/**/*.integration.test.ts",
                    ],
                },
            },
            {
                resolve: { alias },
                test: {
                    name: "integration",
                    environment: "node",
                    globals: true,
                    setupFiles: [envSetup],
                    globalSetup: [integrationGlobalSetup],
                    // DB-backed and flow specs. Generous timeouts cover the
                    // first-run mongodb-memory-server binary download/boot.
                    hookTimeout: 180_000,
                    testTimeout: 30_000,
                    // A single shared repl set is booted in globalSetup. Run
                    // integration files serially via CLI flags in package.json
                    // (--no-file-parallelism --max-workers=1) so afterEach
                    // collection clears do not race across files.
                    pool: "forks",
                    include: [
                        "__tests__/integration/**/*.test.ts",
                        "__tests__/e2e/**/*.test.ts",
                        "__tests__/**/*.integration.test.ts",
                    ],
                },
            },
        ],
    },
});
