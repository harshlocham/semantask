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
  transpilePackages: ["@semantask/auth", "@semantask/services", "@semantask/db", "@semantask/observability", "@semantask/types"],
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
      "@semantask/observability": resolve(process.cwd(), "../../packages/observability"),
    };

    return config;
  },
};

export default nextConfig;