import { createHash } from "node:crypto";
import mongoose from "mongoose";
import type { TaskExecutionActionType } from "@semantask/types";
import { createTaskAction } from "@semantask/services/repositories/task.repo";
import TaskActionModel from "@semantask/db/models/TaskAction";
import { logExecution } from "../execution-logger.js";
import { withSpan } from "@semantask/observability";
import { resolveToolParameters } from "../resolve-tool-params.js";
import {
    applyPromptGuardDecision,
    getPromptGuardMode,
    validateToolArgsAgainstContext,
} from "../prompt-guard.js";
import { loadPromptGuardEmailContext } from "../prompt-guard-context.js";
import { assertToolGrant } from "@semantask/services/tool-grant.service";
import { AuthorizationError } from "@semantask/services/authorization.service";
import { appendExecutionAudit } from "@semantask/services/execution-audit.service";
import type { AgentContext } from "./context.js";
import { combineAbortSignals } from "./types.js";
import type {
    ActionExecutionResult,
    ExecutionActionRecord,
    ExecutionOptions,
    LoopContext,
    VerificationOutcome,
} from "./types.js";

export function extractExternalIds(evidence: unknown): Record<string, string> {
    const ids: Record<string, string> = {};
    if (!evidence || typeof evidence !== "object") {
        return ids;
    }

    const record = evidence as Record<string, unknown>;
    const nested = record.result && typeof record.result === "object"
        ? (record.result as Record<string, unknown>)
        : record;

    const issue = nested.issue && typeof nested.issue === "object"
        ? (nested.issue as Record<string, unknown>)
        : null;

    const body = nested.responseBody && typeof nested.responseBody === "object"
        ? (nested.responseBody as Record<string, unknown>)
        : null;

    const candidates: Array<[string, unknown]> = [
        ["resendId", body?.id ?? nested.id ?? nested.messageId ?? nested.resendId],
        ["githubIssueNumber", issue?.number ?? nested.number ?? nested.issueNumber],
        ["githubIssueUrl", issue?.html_url ?? nested.html_url ?? nested.htmlUrl ?? nested.url],
        ["responseStatus", nested.responseStatus],
    ];

    for (const [key, value] of candidates) {
        if (typeof value === "string" && value.trim()) {
            ids[key] = value.trim();
        } else if (typeof value === "number" && Number.isFinite(value)) {
            ids[key] = String(value);
        }
    }

    return ids;
}

/**
 * Owns tool execution: idempotency guarding, prompt-guard/authorization checks,
 * parameter resolution, invoking the tool adapter, and post-execution
 * observation and verification.
 */
export class ToolExecutor {
    constructor(private readonly ctx: AgentContext) {}

    getToolTimeoutMs() {
        return Math.max(1000, Number(process.env.TASK_AGENT_TOOL_TIMEOUT_MS || 60000));
    }

    stableStringify(value: unknown): string {
        if (value === undefined || typeof value === "function" || typeof value === "symbol") {
            return "null";
        }
        if (typeof value === "bigint") {
            return JSON.stringify(value.toString());
        }
        if (value === null || typeof value !== "object") {
            return JSON.stringify(value) ?? "null";
        }

        if (Array.isArray(value)) {
            return `[${value.map((entry) => this.stableStringify(entry)).join(",")}]`;
        }

        const record = value as Record<string, unknown>;
        return `{${Object.keys(record)
            .filter((key) => {
                const entry = record[key];
                return entry !== undefined && typeof entry !== "function" && typeof entry !== "symbol";
            })
            .sort()
            .map((key) => `${JSON.stringify(key)}:${this.stableStringify(record[key])}`)
            .join(",")}}`;
    }

    // Intentionally run-independent so tool calls stay idempotent across lease handoffs.
    buildToolIdempotencyKey(args: {
        taskId: string;
        stepId: string | null;
        toolName: string;
        params: unknown;
    }): string {
        const canonical = this.stableStringify(args.params ?? {});
        return createHash("sha256")
            .update(`${args.taskId}|${args.stepId ?? "default"}|${args.toolName}|${canonical}`)
            .digest("hex")
            .slice(0, 64);
    }

    private async guardIdempotentToolExecution(
        payload: ExecutionActionRecord,
        actorId?: string | null
    ): Promise<{ proceed: boolean; cached?: ActionExecutionResult }> {
        if (!payload.idempotencyKey || mongoose.connection.readyState !== 1) {
            return { proceed: true };
        }

        const existing = await TaskActionModel.findOne({ idempotencyKey: payload.idempotencyKey }).lean().exec();
        if (existing) {
            if (existing.executionState === "succeeded" && existing.summary) {
                return {
                    proceed: false,
                    cached: {
                        summary: existing.summary,
                        adapterSuccess: true,
                        evidence: {
                            toolName: payload.toolName,
                            idempotentReplay: true,
                            parameters: existing.parameters ?? {},
                        },
                    },
                };
            }

            return {
                proceed: false,
                cached: {
                    summary: "Skipped duplicate in-flight tool execution.",
                    adapterSuccess: false,
                    evidence: { toolName: payload.toolName, idempotentReplay: true },
                    error: "duplicate_in_flight",
                },
            };
        }

        try {
            await createTaskAction({
                taskId: payload.taskId,
                conversationId: payload.conversationId,
                actorType: "agent",
                actorId: actorId ?? null,
                actionType: this.ctx.mapToolNameToActionType(payload.toolName),
                toolName: payload.toolName,
                messageId: payload.messageId,
                parameters: payload.parameters ?? {},
                executionState: "running",
                summary: `Tool execution started: ${payload.toolName}`,
                error: null,
                patch: { before: null, after: { runId: this.ctx.currentRunId, stepId: payload.stepId, attempt: payload.attempt } },
                reason: "execution_idempotency_guard",
                idempotencyKey: payload.idempotencyKey,
            });

            await appendExecutionAudit({
                taskId: payload.taskId,
                conversationId: payload.conversationId,
                actorId: actorId ?? null,
                runId: this.ctx.currentRunId,
                toolName: payload.toolName,
                action: "started",
                parameters: payload.parameters ?? {},
                decision: "auto_execute",
            });
        } catch (error) {
            const maybeMongo = error as { code?: number };
            if (maybeMongo?.code === 11000) {
                return this.guardIdempotentToolExecution(payload, actorId);
            }
            throw error;
        }

        return { proceed: true };
    }

    private async finalizeIdempotentToolExecution(
        idempotencyKey: string | undefined,
        result: ActionExecutionResult
    ): Promise<void> {
        if (!idempotencyKey || mongoose.connection.readyState !== 1) {
            return;
        }

        await TaskActionModel.updateOne(
            { idempotencyKey },
            {
                $set: {
                    executionState: result.adapterSuccess ? "succeeded" : "failed",
                    summary: result.summary,
                    error: result.error ?? null,
                },
            }
        ).exec();
    }

    async observe(_context: LoopContext, result: ActionExecutionResult): Promise<ActionExecutionResult> {
        console.log("agent-runner step:observe", {
            runId: this.ctx.currentRunId,
            summary: result.summary,
            adapterSuccess: result.adapterSuccess,
        });

        return result;
    }

    async execute(payload: ExecutionActionRecord, options?: ExecutionOptions): Promise<ActionExecutionResult> {
        const tool = this.ctx.toolRegistry.get(payload.toolName);
        const runId = this.ctx.getCurrentRunId();
        const toolTimeoutMs = this.getToolTimeoutMs();

        logExecution("info", {
            event: "tool.execute",
            runId,
            stepId: payload.stepId ?? null,
            attempt: payload.attempt ?? null,
            idempotencyKey: payload.idempotencyKey ?? null,
            taskId: payload.taskId,
            toolName: payload.toolName,
            parameters: payload.parameters,
        });

        if (!tool) {
            return {
                summary: `No tool registered for name ${payload.toolName}.`,
                adapterSuccess: false,
                evidence: { toolName: payload.toolName },
                error: `No tool registered for name ${payload.toolName}`,
            };
        }

        try {
            await assertToolGrant(options?.userId ?? "", payload.toolName, payload.conversationId);
        } catch (error) {
            if (!(error instanceof AuthorizationError)) {
                logExecution("error", {
                    event: "tool_grant.check_failed",
                    runId,
                    taskId: payload.taskId,
                    toolName: payload.toolName,
                    userId: options?.userId ?? null,
                    error: error instanceof Error ? error.message : String(error),
                });
                throw error;
            }

            const message = error.message;
            logExecution("warn", {
                event: "tool_grant.deny",
                runId,
                taskId: payload.taskId,
                toolName: payload.toolName,
                userId: options?.userId ?? null,
            });
            await appendExecutionAudit({
                taskId: payload.taskId,
                conversationId: payload.conversationId,
                actorId: options?.userId ?? null,
                runId,
                toolName: payload.toolName,
                action: "denied",
                parameters: payload.parameters ?? {},
                decision: "TOOL_GRANT_DENIED",
                reason: message,
            });
            return {
                summary: `Tool grant denied for ${payload.toolName}.`,
                adapterSuccess: false,
                evidence: {
                    toolName: payload.toolName,
                    reason: "TOOL_GRANT_DENIED",
                },
                error: message,
            };
        }

        const idempotencyGuard = await this.guardIdempotentToolExecution(payload, options?.userId);
        if (!idempotencyGuard.proceed && idempotencyGuard.cached) {
            logExecution("info", {
                event: "tool.idempotent_replay",
                workerId: this.ctx.workerId,
                runId: this.ctx.currentRunId ?? undefined,
                taskId: payload.taskId,
                toolName: payload.toolName,
            });
            return idempotencyGuard.cached;
        }

        try {
            const resolution = await resolveToolParameters({
                toolName: payload.toolName,
                params: payload.parameters ?? {},
                userId: options?.userId,
                clarificationReply: options?.clarificationReply ?? null,
                pendingResolution: options?.pendingResolution ?? null,
            });

            if (resolution.status === "clarification_required") {
                return {
                    summary: "Execution paused for clarification.",
                    adapterSuccess: false,
                    evidence: {
                        toolName: payload.toolName,
                        needsClarification: true,
                        clarificationQuestion: resolution.clarificationQuestion,
                        pendingResolution: resolution.pendingResolution,
                    },
                    error: "clarification_required",
                };
            }

            if (resolution.status === "failed") {
                return {
                    summary: `Parameter resolution failed for ${payload.toolName}.`,
                    adapterSuccess: false,
                    evidence: {
                        toolName: payload.toolName,
                        resolutionError: resolution.error,
                    },
                    error: resolution.error,
                };
            }

            const resolvedParams = resolution.params ?? {};
            const promptGuardMode = getPromptGuardMode();
            if (promptGuardMode !== "off") {
                let participantEmails = options?.participantEmails;
                let contactEmails = options?.contactEmails;

                if (!participantEmails || !contactEmails) {
                    const context = await loadPromptGuardEmailContext({
                        conversationId: payload.conversationId,
                        ownerUserId: options?.userId,
                    });
                    participantEmails = participantEmails ?? context.participantEmails;
                    contactEmails = contactEmails ?? context.contactEmails;
                }

                const guardValidation = validateToolArgsAgainstContext({
                    tool: payload.toolName,
                    params: resolvedParams,
                    participantEmails,
                    contactEmails,
                });
                const guardDecision = applyPromptGuardDecision(guardValidation, {
                    taskId: payload.taskId,
                    tool: payload.toolName,
                    mode: promptGuardMode,
                });

                if (!guardDecision.allow) {
                    await appendExecutionAudit({
                        taskId: payload.taskId,
                        conversationId: payload.conversationId,
                        actorId: options?.userId ?? null,
                        runId,
                        toolName: payload.toolName,
                        action: "denied",
                        parameters: resolvedParams,
                        decision: "PROMPT_GUARD_BLOCKED",
                        reason: guardValidation.reasons.join(" "),
                    });
                    await this.finalizeIdempotentToolExecution(payload.idempotencyKey ?? undefined, {
                        summary: `Prompt guard blocked ${payload.toolName}.`,
                        adapterSuccess: false,
                        evidence: { toolName: payload.toolName },
                        error: "prompt_guard_blocked",
                    });
                    return {
                        summary: `Prompt guard blocked ${payload.toolName}.`,
                        adapterSuccess: false,
                        evidence: {
                            toolName: payload.toolName,
                            promptGuard: {
                                mode: promptGuardMode,
                                reasons: guardValidation.reasons,
                            },
                        },
                        error: guardValidation.reasons.join(" ") || "prompt_guard_blocked",
                    };
                }
            }

            const parsedInput = tool.inputSchema.parse(resolvedParams);
            const startedAt = Date.now();
            const timeoutController = new AbortController();
            const timeoutHandle = setTimeout(() => timeoutController.abort(), toolTimeoutMs);
            const signal = combineAbortSignals(this.ctx.currentExecutionSignal ?? undefined, timeoutController.signal) ?? timeoutController.signal;

            try {
                const result = await withSpan("tool.execute", {
                    "tool.name": payload.toolName,
                    "task.id": payload.taskId,
                    "run.id": runId ?? "",
                }, async () => tool.execute(parsedInput, {
                    taskId: payload.taskId,
                    conversationId: payload.conversationId,
                    messageId: payload.messageId,
                    signal,
                    metadata: {
                        runId,
                        stepId: payload.stepId ?? undefined,
                        attempt: payload.attempt ?? undefined,
                        idempotencyKey: payload.idempotencyKey ?? undefined,
                    },
                }));

                await this.finalizeIdempotentToolExecution(payload.idempotencyKey ?? undefined, result);

                await appendExecutionAudit({
                    taskId: payload.taskId,
                    conversationId: payload.conversationId,
                    actorId: options?.userId ?? null,
                    runId,
                    toolName: tool.name,
                    action: result.adapterSuccess ? "completed" : "failed",
                    parameters: resolvedParams,
                    externalIds: extractExternalIds(result.evidence),
                    decision: result.adapterSuccess ? "succeeded" : "failed",
                    reason: result.error ?? null,
                });

                logExecution("info", {
                    event: "tool.completed",
                    runId,
                    stepId: payload.stepId ?? null,
                    toolName: tool.name,
                    success: result.adapterSuccess,
                    idempotencyKey: payload.idempotencyKey ?? null,
                    latencyMs: Date.now() - startedAt,
                });

                return {
                    ...result,
                    evidence: {
                        toolName: tool.name,
                        result: result.evidence,
                        metadata: {
                            runId,
                            stepId: payload.stepId ?? null,
                            attempt: payload.attempt ?? null,
                            idempotencyKey: payload.idempotencyKey ?? null,
                        },
                    },
                };
            } finally {
                clearTimeout(timeoutHandle);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : "unknown tool error";
            if (this.ctx.currentExecutionSignal?.aborted || /abort|timed out|lease lost/i.test(message)) {
                await appendExecutionAudit({
                    taskId: payload.taskId,
                    conversationId: payload.conversationId,
                    actorId: options?.userId ?? null,
                    runId,
                    toolName: tool.name,
                    action: "failed",
                    parameters: payload.parameters ?? {},
                    decision: "aborted",
                    reason: message,
                });
                throw new Error(message.includes("timed out") ? message : "Execution aborted.");
            }
            console.warn("agent-runner step:tool-failure", {
                runId,
                stepId: payload.stepId ?? null,
                taskId: payload.taskId,
                toolName: tool.name,
                reason: message,
                idempotencyKey: payload.idempotencyKey ?? null,
            });

            const failedResult: ActionExecutionResult = {
                summary: `Tool ${tool.name} failed.`,
                adapterSuccess: false,
                evidence: {
                    toolName: tool.name,
                    metadata: {
                        runId,
                        stepId: payload.stepId ?? null,
                        attempt: payload.attempt ?? null,
                        idempotencyKey: payload.idempotencyKey ?? null,
                    },
                    reason: message,
                },
                error: message,
            };

            await this.finalizeIdempotentToolExecution(payload.idempotencyKey ?? undefined, failedResult);
            await appendExecutionAudit({
                taskId: payload.taskId,
                conversationId: payload.conversationId,
                actorId: options?.userId ?? null,
                runId,
                toolName: tool.name,
                action: "failed",
                parameters: payload.parameters ?? {},
                decision: "failed",
                reason: message,
            });

            return failedResult;
        }
    }

    async verify(result: ActionExecutionResult, context: LoopContext): Promise<VerificationOutcome> {
        const validationLog = this.ctx.taskSuccessRegistry.validate(context.action.toolName as TaskExecutionActionType, context.task, result);
        const passedChecks = validationLog.checks.filter((check) => check.passed).length;
        const totalChecks = validationLog.checks.length;
        const confidence = totalChecks > 0 ? passedChecks / totalChecks : (validationLog.passed ? 1 : 0);

        console.log("agent-runner step:verify", {
            toolName: context.action.toolName,
            evidence: result.evidence,
            validator: validationLog.validator,
            passed: validationLog.passed,
            checks: validationLog.checks,
        });

        return {
            success: validationLog.passed,
            confidence,
            validationLog,
        };
    }
}
