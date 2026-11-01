import "./test-env.js";
import assert from "node:assert/strict";
import test from "node:test";
import {
    getClassifierTimeoutMs,
    getLlmApiKey,
    getLlmBaseUrl,
    getLlmModel,
    getLlmProviderConfig,
} from "../config/llm.js";
import {
    getLeaseMs,
    getRedisUrl,
    getStuckRemediationMode,
    getWorkerRuntimeConfig,
    LEASE_MS_FALLBACK,
} from "../config/worker.js";
import { warnDeprecatedWorkerAliases } from "../config/aliases.js";
import { resetAliasWarnings } from "../config/parse.js";

function withEnv(values: Record<string, string | undefined>, fn: () => void) {
    const previous: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(values)) {
        previous[key] = process.env[key];
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }
    try {
        fn();
    } finally {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    }
}

test("LLM_API_KEY is the only credential env the worker reads", () => {
    withEnv({
        LLM_API_KEY: "llm-key",
        OPENAI_API_KEY: "openai-key",
        HUGGINGFACE_API_KEY: "hf-key",
        AMD_API_KEY: "amd-key",
    }, () => {
        assert.equal(getLlmApiKey(), "llm-key");
    });
});

test("vendor API key aliases are ignored when LLM_API_KEY is unset", () => {
    withEnv({
        LLM_API_KEY: undefined,
        OPENAI_API_KEY: "openai-key",
        HUGGINGFACE_API_KEY: "hf-key",
        AMD_API_KEY: "amd-key",
    }, () => {
        assert.equal(getLlmApiKey(), "");
    });
});

test("LLM_BASE_URL is the only gateway URL env the worker reads", () => {
    withEnv({
        LLM_BASE_URL: "http://llm.example/v1",
        OPENAI_BASE_URL: "http://openai.example/v1",
        HUGGINGFACE_BASE_URL: "http://hf.example/v1",
        AMD_BASE_URL: "http://amd.example/v1",
    }, () => {
        assert.equal(getLlmBaseUrl(), "http://llm.example/v1");
    });
});

test("LLM_PROVIDER is the only provider selector", () => {
    withEnv({
        LLM_PROVIDER: "huggingface",
        TASK_LLM_PROVIDER: "openai-compatible",
        LLM_API_KEY: "k",
    }, () => {
        assert.equal(getLlmProviderConfig().provider, "huggingface");
    });
});

test("TASK_LLM_PROVIDER is ignored when LLM_PROVIDER is unset", () => {
    withEnv({
        LLM_PROVIDER: undefined,
        TASK_LLM_PROVIDER: "openai-compatible",
        LLM_API_KEY: "k",
    }, () => {
        assert.equal(getLlmProviderConfig().provider, "openai");
    });
});

test("TASK_AGENT_MODEL is canonical; LLM_MODEL / HUGGINGFACE_MODEL are ignored", () => {
    withEnv({
        TASK_AGENT_MODEL: undefined,
        LLM_MODEL: "alias-model",
        HUGGINGFACE_MODEL: "hf-model",
    }, () => {
        assert.equal(getLlmModel(), undefined);
        assert.equal(getLlmProviderConfig().model, undefined);
    });

    withEnv({
        TASK_AGENT_MODEL: "canonical-model",
        LLM_MODEL: "alias-model",
        HUGGINGFACE_MODEL: "hf-model",
    }, () => {
        assert.equal(getLlmModel(), "canonical-model");
    });
});

test("lease and worker knobs use documented fallbacks", () => {
    withEnv({
        TASK_LEASE_MS: undefined,
        TASK_WORKER_BATCH_SIZE: undefined,
        TASK_WORKER_POLL_MS: undefined,
        TASK_STUCK_REMEDIATION: undefined,
        TASK_AGENT_MAX_ITERATIONS: undefined,
    }, () => {
        const runtime = getWorkerRuntimeConfig();
        assert.equal(getLeaseMs(), LEASE_MS_FALLBACK);
        assert.equal(runtime.batchSize, 10);
        assert.equal(runtime.pollMs, 800);
        assert.equal(getStuckRemediationMode(), "log");
        assert.equal(runtime.agentMaxIterationsPlan, 5);
        assert.equal(runtime.agentMaxIterationsPersistent, 8);
    });
});

test("TASK_AGENT_MAX_ITERATIONS overrides both loop defaults when set", () => {
    withEnv({ TASK_AGENT_MAX_ITERATIONS: "4" }, () => {
        const runtime = getWorkerRuntimeConfig();
        assert.equal(runtime.agentMaxIterationsPlan, 4);
        assert.equal(runtime.agentMaxIterationsPersistent, 4);
    });
});

test("worker Redis is REDIS_URL only; Upstash REST is ignored", () => {
    withEnv({
        REDIS_URL: undefined,
        UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
    }, () => {
        assert.equal(getRedisUrl(), undefined);
        assert.equal(getWorkerRuntimeConfig().redisUrl, undefined);
    });

    withEnv({
        REDIS_URL: "redis://localhost:6379",
        UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
    }, () => {
        assert.equal(getRedisUrl(), "redis://localhost:6379");
    });
});

test("boot warns when only INTERNAL_SECRET or Upstash REST URL is set", () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (message?: unknown) => {
        warnings.push(String(message));
    };
    resetAliasWarnings();
    try {
        withEnv({
            TASK_AGENT_MODEL: undefined,
            LLM_MODEL: "alias-model",
            HUGGINGFACE_MODEL: undefined,
            TASK_WORKER_ALLOWED_EMAIL_DOMAINS: undefined,
            ALLOWED_EMAIL_DOMAINS: "example.com",
            INTERNAL_SECRET_SOCKET: undefined,
            INTERNAL_SECRET: "legacy-secret",
            REDIS_URL: undefined,
            UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
        }, () => {
            warnDeprecatedWorkerAliases();
            warnDeprecatedWorkerAliases();
        });
    } finally {
        console.warn = originalWarn;
        resetAliasWarnings();
    }

    assert.equal(warnings.length, 2);
    assert.ok(warnings.some((line) => line.includes("INTERNAL_SECRET")));
    assert.ok(warnings.some((line) => line.includes("UPSTASH_REDIS_REST_URL")));
    assert.ok(!warnings.some((line) => line.includes("LLM_MODEL")));
    assert.ok(!warnings.some((line) => line.includes("ALLOWED_EMAIL_DOMAINS")));
});

test("classifier timeout defaults to 15s and can be overridden", () => {
    withEnv({ TASK_CLASSIFIER_LLM_TIMEOUT_MS: undefined }, () => {
        assert.equal(getClassifierTimeoutMs(), 15_000);
    });
    withEnv({ TASK_CLASSIFIER_LLM_TIMEOUT_MS: "5000" }, () => {
        assert.equal(getClassifierTimeoutMs(), 5000);
    });
});
