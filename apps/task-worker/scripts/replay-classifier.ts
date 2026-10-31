/**
 * Replay fixture messages through the real ingress classifier and report whether
 * each would create a WorkSuggestion. Calls the LLM only: no Mongo, Redis, or writes.
 *
 * Usage:
 *   pnpm --filter @semantask/task-worker replay:classifier             # live, needs LLM_API_KEY
 *   pnpm --filter @semantask/task-worker replay:classifier --runs 5    # stability across runs
 *   pnpm --filter @semantask/task-worker replay:classifier --mock      # stub LLM, no key, no network
 *
 * Exits 1 on a classifier error, or on a failed expectation in live mode. --mock
 * answers from the regex heuristics, so its failures say nothing about the model.
 */
import "../config/env.js";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { z } from "zod";
import {
    classifyMessage,
    classifyMessageWithRegex,
    configureMessageClassifier,
    getClassifierThreshold,
    isActionableClassification,
} from "@semantask/services/message-classifier.service";
import { getClassifierModel, getLlmApiKey, getLlmProviderConfig } from "../config/llm.js";
import type { LLMRequest, LLMResponse } from "../services/llm/types.js";
import { classifyMessageWithLlm } from "../services/message-classifier-llm.js";

const FIXTURE_URL = new URL("./classifier-replay.fixture.json", import.meta.url);
const MESSAGE_PREVIEW_LENGTH = 40;

const fixtureSchema = z.array(z.object({
    // processMessageTaskIntelligence never sends blank content to the classifier.
    message: z.string().trim().min(1),
    expected: z.enum(["suggestion", "ignored"]),
    category: z.string().min(1),
})).min(1);

type FixtureCase = z.infer<typeof fixtureSchema>[number];

type Attempt = {
    type: string;
    confidence: number | null;
    suggestion: boolean | null;
    latencyMs: number;
    pass: boolean;
    error?: string;
};

/**
 * Stands in for the provider, so the real prompt, response parsing, and schema
 * validation in classifyMessageWithLlm still run.
 */
const stubProvider = {
    generate: async (request: LLMRequest): Promise<LLMResponse> => {
        const { userMessage } = JSON.parse(String(request.input)) as { userMessage: string };
        const { semanticType, confidence, reasoning } = classifyMessageWithRegex(userMessage);
        return {
            model: request.model,
            provider: "mock",
            output_text: JSON.stringify({ semanticType, confidence, reasoning }),
        };
    },
};

function parseCliArgs(): { mock: boolean; runs: number } {
    const { values } = parseArgs({
        options: {
            mock: { type: "boolean", default: false },
            runs: { type: "string", default: "1" },
        },
    });

    const runs = Number(values.runs);
    if (!Number.isInteger(runs) || runs < 1) {
        throw new Error(`--runs must be a positive integer, got "${values.runs}"`);
    }

    return { mock: values.mock, runs };
}

async function runCase(testCase: FixtureCase): Promise<Attempt> {
    const startedAt = Date.now();
    try {
        const classification = await classifyMessage(testCase.message);
        const suggestion = isActionableClassification(classification);
        return {
            type: classification.semanticType,
            confidence: classification.confidence,
            suggestion,
            latencyMs: Date.now() - startedAt,
            pass: suggestion === (testCase.expected === "suggestion"),
        };
    } catch (error) {
        return {
            type: "ERROR",
            confidence: null,
            suggestion: null,
            latencyMs: Date.now() - startedAt,
            pass: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

/** "task", or "task×3 chat×2" when the runs disagree. */
function tally(values: string[]): string {
    const counts = new Map<string, number>();
    for (const value of values) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    if (counts.size === 1) {
        return values[0];
    }
    return [...counts]
        .sort((a, b) => b[1] - a[1])
        .map(([value, count]) => `${value}×${count}`)
        .join(" ");
}

function percentile(values: number[], fraction: number): number {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function formatConfidence(attempts: Attempt[]): string {
    const scores = attempts.flatMap((attempt) => attempt.confidence ?? []);
    if (scores.length === 0) {
        return "-";
    }
    const low = Math.min(...scores).toFixed(2);
    const high = Math.max(...scores).toFixed(2);
    return low === high ? low : `${low}-${high}`;
}

function formatSuggestion(suggestion: boolean | null): string {
    if (suggestion === null) {
        return "-";
    }
    return suggestion ? "yes" : "no";
}

function formatMessage(message: string): string {
    return message.length > MESSAGE_PREVIEW_LENGTH
        ? `${message.slice(0, MESSAGE_PREVIEW_LENGTH - 1)}…`
        : message;
}

function allPassed(attempts: Attempt[]): boolean {
    return attempts.every((attempt) => attempt.pass);
}

function isStable(attempts: Attempt[]): boolean {
    return new Set(attempts.map((attempt) => attempt.type)).size === 1
        && new Set(attempts.map((attempt) => attempt.suggestion)).size === 1;
}

function printTable(rows: Record<string, string>[]): void {
    const columns = Object.keys(rows[0]);
    const widths = columns.map((column) => Math.max(column.length, ...rows.map((row) => row[column].length)));
    const printLine = (cells: string[]) => {
        console.log(cells.map((cell, index) => cell.padEnd(widths[index])).join("  ").trimEnd());
    };

    printLine(columns);
    printLine(widths.map((width) => "-".repeat(width)));
    for (const row of rows) {
        printLine(columns.map((column) => row[column]));
    }
}

function printReport(cases: FixtureCase[], results: Attempt[][], runs: number): void {
    printTable(cases.map((testCase, index) => {
        const attempts = results[index];
        const passes = attempts.filter((attempt) => attempt.pass).length;
        const verdict = allPassed(attempts) ? "PASS" : "FAIL";
        return {
            message: formatMessage(testCase.message),
            category: testCase.category,
            type: tally(attempts.map((attempt) => attempt.type)),
            confidence: formatConfidence(attempts),
            suggestion: tally(attempts.map((attempt) => formatSuggestion(attempt.suggestion))),
            latency: `${percentile(attempts.map((attempt) => attempt.latencyMs), 0.5)}ms`,
            result: runs > 1 ? `${verdict} ${passes}/${runs}` : verdict,
        };
    }));

    const passedCases = results.filter(allPassed).length;
    console.log(`\nPassed: ${passedCases}/${cases.length} messages`);

    const categories = new Map<string, { passed: number; total: number }>();
    cases.forEach((testCase, index) => {
        const category = categories.get(testCase.category) ?? { passed: 0, total: 0 };
        category.total += 1;
        category.passed += allPassed(results[index]) ? 1 : 0;
        categories.set(testCase.category, category);
    });
    const byCategory = [...categories].map(([name, { passed, total }]) => `${name} ${passed}/${total}`);
    console.log(`By category: ${byCategory.join(", ")}`);

    const latencies = results.flat().map((attempt) => attempt.latencyMs);
    console.log(`Latency: p50 ${percentile(latencies, 0.5)}ms, p95 ${percentile(latencies, 0.95)}ms, max ${Math.max(...latencies)}ms`);

    if (runs > 1) {
        const unstable = results.filter((attempts) => !isStable(attempts)).length;
        console.log(`Unstable across ${runs} runs: ${unstable}/${cases.length} messages changed type or suggestion`);
    }

    const errors = new Set(results.flat().flatMap((attempt) => attempt.error ?? []));
    for (const error of errors) {
        console.log(`Error: ${error}`);
    }
}

async function main(): Promise<void> {
    const { mock, runs } = parseCliArgs();
    const cases = fixtureSchema.parse(JSON.parse(readFileSync(FIXTURE_URL, "utf8")));

    // regex and shadow return heuristic results, which is not what this replays.
    process.env.TASK_CLASSIFIER_MODE = "llm";

    if (mock) {
        // classifyMessageWithLlm returns null without a key, and classifyMessage then uses regex.
        process.env.LLM_API_KEY = "mock-key";
        configureMessageClassifier({
            llmClassify: (content) => classifyMessageWithLlm(content, { provider: stubProvider }),
        });
    } else {
        if (!getLlmApiKey().trim()) {
            throw new Error("LLM_API_KEY is not set. Set it, or pass --mock to use the stub LLM.");
        }
        configureMessageClassifier({ llmClassify: classifyMessageWithLlm });
    }

    // The classifier and provider log every call with console.info, which would bury the table.
    console.info = () => {};

    console.log(`Replaying ${cases.length} messages × ${runs} run(s)`);
    console.log(mock
        ? "LLM: MOCK (stub answering from regex heuristics, no network). This does not measure the model."
        : `LLM: ${getLlmProviderConfig().provider} / ${getClassifierModel()}`);
    console.log(`Suggestion threshold: ${getClassifierThreshold()}\n`);

    const results: Attempt[][] = cases.map(() => []);
    for (let run = 1; run <= runs; run += 1) {
        for (const [index, testCase] of cases.entries()) {
            process.stderr.write(`\rRun ${run}/${runs}, message ${index + 1}/${cases.length}`);
            results[index].push(await runCase(testCase));
        }
    }
    process.stderr.write("\n");

    printReport(cases, results, runs);

    const attempts = results.flat();
    const hasError = attempts.some((attempt) => attempt.error);
    const hasFailure = attempts.some((attempt) => !attempt.pass);
    if (hasError || (hasFailure && !mock)) {
        process.exitCode = 1;
    }
}

main()
    .catch((error) => {
        console.error(
            "replay-classifier failed:",
            error instanceof Error ? error.message : String(error),
        );
        process.exitCode = 1;
    })
    .finally(() => {
        process.exit();
    });
