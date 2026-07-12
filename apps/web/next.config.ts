import type { NextConfig } from "next";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadDotEnv } from "dotenv";

// Ensure the web app can run from monorepo root env files in Turbo workspaces.
const rootEnvPath = resolve(process.cwd(), "../../.env");
if (existsSync(rootEnvPath)) {
  loadDotEnv({ path: rootEnvPath, override: false });
}

const nextConfig: NextConfig = {
  // Use prebuilt dist for observability (avoids webpack resolving .js ESM paths in TS sources
  // and keeps @opentelemetry/sdk-node out of the Next compile graph).
  transpilePackages: ["@semantask/auth", "@semantask/services", "@semantask/db", "@semantask/types"],
  serverExternalPackages: [
    "@semantask/observability",
    "prom-client",
    "@opentelemetry/sdk-trace-node",
    "@opentelemetry/sdk-trace-base",
    "@opentelemetry/exporter-trace-otlp-http",
    "@opentelemetry/resources",
    "@opentelemetry/api",
    "@opentelemetry/semantic-conventions",
  ],
  images: {
    domains: ["lh3.googleusercontent.com", "ik.imagekit.io"],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "ik.imagekit.io",
      },
    ],
  },
  webpack: (config) => {
    config.resolve = config.resolve || {};
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      "@semantask/services": resolve(process.cwd(), "../../packages/services"),
      "@semantask/db": resolve(process.cwd(), "../../packages/db"),
    };

    return config;
  },
};

export default nextConfig;
