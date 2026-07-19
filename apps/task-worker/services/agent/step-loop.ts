import type { TaskCheckpoint, TaskExecutionActionType, TaskExecutionHistory, TaskExecutionUpdatedPayload } from "@semantask/types";
import { createHash } from "node:crypto";
import mongoose from "mongoose";
import TaskPlanModel from "@semantask/db/models/TaskPlan";
import { scheduleTaskRetry } from "../schedule-retry.js";
import { logExecution } from "../execution-logger.js";
import { finalizeTaskCancellation, isTaskCancellationRequested } from "../task-cancellation.js";
import { rankTools, type ToolRankingInput } from "../tool-ranking.js";
import { collectPreviousStepOutputs, llmDecisionSchema, normalizeParams, resolveStepTemplates, type PreviousStepOutputs, validateToolParameters } from "../step-execution-utils.js";
import { createDefaultLLMProvider } from "../llm/index.js";
import { parseJsonText } from "../llm/response-parser.js";
import { runWithLLMUsageContext } from "../llm/usage-context.js";
import { buildFencedTaskFields } from "../prompt-guard.js";
import { listGrantedToolNames } from "@semantask/services/tool-grant.service";
import type { AgentContext } from "./context.js";
import type { ClarificationHandler } from "./clarification-handler.js";
import type { ShadowFsmWriter } from "./shadow-fsm-writer.js";
import type { ToolExecutor } from "./tool-executor.js";
import { combineAbortSignals } from "./types.js";
import type {
    ActionExecutionResult,
    AvailableToolForDecision,
    ExecutionActionRecord,
    ExecutionHistoryDelta,
    IterationContextEntry,
    LoopContext,
    NextActionDecision,
    PlanStepLike,
    RequestedToolName,
    RunTaskContext,
    RunTaskOutcome,
    TaskDocumentLike,
    TaskPlanLike,
    VerificationOutcome,
} from "./types.js";

/**
 * Owns the agent execution loops. Composes the ToolExecutor, ShadowFsmWriter,
 * and ClarificationHandler collaborators and drives both the autonomous
 * (`runTask`) and persistent step-based (`runTaskPersistent`) loops, along with
 * planning, decision, checkpoint, cancellation, and lease-watchdog helpers.
 */
export class StepLoop {
    constructor(
        private readonly ctx: AgentContext,
        private readonly toolExecutor: ToolExecutor,
        private readonly shadow: ShadowFsmWriter,
        private readonly clarification: ClarificationHandler,
    ) {}

    private trimCheckpoints(checkpoints: TaskCheckpoint[]) {
        const cap = 200;
        return checkpoints.length <= cap ? checkpoints : checkpoints.slice(checkpoints.length - cap);
    }

    private trimExecutionResults(results: TaskExecutionHistory["results"]) {
        const cap = 100;
        return results.length <= cap ? results : results.slice(results.length - cap);
    }

    private getExecutionHistory(task: TaskDocumentLike): TaskExecutionHistory {
        return {
            attempts: typeof task.executionHistory?.attempts === "number" ? task.executionHistory.attempts : 0,
            failures: typeof task.executionHistory?.failures === "number" ? task.executionHistory.failures : 0,
            results: Array.isArray(task.executionHistory?.results) ? task.executionHistory.results : [],
        };
    }

    private getConfidenceThreshold() {
        const configured = Number(process.env.TASK_AGENT_CONFIDENCE_THRESHOLD ?? 0.7);
        if (Number.isNaN(configured)) return 0.7;
        return Math.max(0, Math.min(1, configured));
    }

    private buildPreviousStepOutputs(plan: TaskPlanLike): PreviousStepOutputs {
        return collectPreviousStepOutputs(plan.steps);
    }

    private rethrowLlmFailure(err: unknown): never {
        const detail = err instanceof Error ? err.message : String(err);
        if (/abort/i.test(detail)) {
            throw err instanceof Error ? err : new Error(detail);
        }

        throw new Error(`LLM_ERROR: ${detail}`);
    }

    private async resolveCancellationBeforeSideEffect(
        taskId: string,
        runAbortController: AbortController,
        runId: string,
    ): Promise<RunTaskOutcome | null> {
        const fresh = await this.ctx.taskModel.findById(taskId);
        if (!fresh) {
            return null;
        }

        return this.handleCancellationIfRequested(fresh, runAbortController, runId);
    }

    private getCancelPollIntervalMs(): number {
        const configured = Number(process.env.TASK_CANCEL_POLL_MS || 250);
        return Math.max(100, Math.min(2000, configured));
    }

    private startCancelWatcher(taskId: string, runAbortController: AbortController) {
        let stopped = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const intervalMs = this.getCancelPollIntervalMs();

        const schedule = () => {
            if (stopped || runAbortController.signal.aborted) {
                return;
            }

            timer = setTimeout(async () => {
                if (stopped || runAbortController.signal.aborted) {
                    return;
                }

                try {
                    const fresh = await this.ctx.taskModel.findById(taskId);
                    if (fresh && isTaskCancellationRequested(fresh)) {
                        runAbortController.abort();
                        return;
                    }
                } catch (error) {
                    logExecution("warn", {
                        event: "cancel.watchdog.error",
                        workerId: this.ctx.workerId,
                        taskId,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }

                schedule();
            }, intervalMs);
        };

        schedule();

        return {
            stop: () => {
                stopped = true;
                if (timer) {
                    clearTimeout(timer);
                }
            },
        };
    }

    private async requestLlmResponse(model: string, input: string): Promise<{ output_text?: string; output?: unknown }> {
        if (this.ctx.currentExecutionSignal?.aborted) {
            throw new Error("Execution aborted.");
        }

        if (this.ctx.llmRequestFn) {
            const response = await this.ctx.llmRequestFn({ model, input });
            if (this.ctx.currentExecutionSignal?.aborted) {
                throw new Error("Execution aborted.");
            }

            return response;
        }

        const provider = createDefaultLLMProvider();
        const startedAt = Date.now();

        const response = await runWithLLMUsageContext(
            this.ctx.currentUsageContext ?? {},
            () => provider.generate({
                model,
                input,
            }, {
                signal: this.ctx.currentExecutionSignal ?? undefined,
            })
        );

        console.log("agent-runner llm:provider", {
            runId: this.ctx.currentRunId,
            model,
            provider: response.provider,
            latencyMs: Date.now() - startedAt,
            retryCount: 0,
            success: true,
        });

        return {
            output_text: response.output_text,
            output: response.output ?? response.raw,
        };
    }

    private setUsageContextFromTask(task: TaskDocumentLike): void {
        this.ctx.currentUsageContext = {
            taskId: task._id.toString(),
            userId: this.getTaskUserId(task),
            organizationId: task.organizationId?.toString?.() ?? null,
        };
    }

    private getTaskUserId(task: TaskDocumentLike): string | null {
        if (!task.createdBy) {
            return null;
        }

        if (typeof task.createdBy === "string") {
            return task.createdBy;
        }

        if (typeof task.createdBy.toString === "function") {
            return task.createdBy.toString();
        }

        return null;
    }

    private async listToolsForUser(task: TaskDocumentLike): Promise<AvailableToolForDecision[]> {
        const allTools = this.ctx.toolRegistry.listForLLM();
        const highRiskTools = new Set(["send_email", "schedule_meeting", "create_github_issue"]);
        const userId = this.getTaskUserId(task);
        if (!userId) {
            return allTools.filter((tool) => !highRiskTools.has(tool.name));
        }

        const granted = new Set(
            await listGrantedToolNames(
                userId,
                task.conversationId?.toString?.() ?? String(task.conversationId),
                task.organizationId?.toString?.() ?? null
            )
        );

        return allTools.filter((tool) => {
            // Non-high-risk tools always available; high-risk require grant (listGrantedToolNames
            // returns all HIGH_RISK_TOOLS when RBAC is off).
            if (!granted.has(tool.name) && highRiskTools.has(tool.name)) {
                return false;
            }
            return true;
        });
    }

    private async decideNextAction(
        task: TaskDocumentLike,
        executionHistory: TaskExecutionHistory,
        availableTools: AvailableToolForDecision[],
        iterationContext: IterationContextEntry[]
    ): Promise<NextActionDecision> {
        const model = process.env.TASK_AGENT_MODEL || "gpt-4o-mini";
        const confidenceThreshold = this.getConfidenceThreshold();
        const fenced = buildFencedTaskFields(task.title, task.description);

        const systemPrompt = [
            "Return one JSON object only with keys: tool, confidence, parameters, reasoning, noAction, needsClarification, clarificationQuestion.",
            "No extra text. Execute at most one tool per iteration.",
            "For requests with multiple outcomes (for example email + github issue + meeting), keep selecting the next required tool in later iterations.",
            "Do not repeat a tool that already succeeded unless the user explicitly asks for repetition.",
            "Set noAction=true only when all requested outcomes are complete.",
            "For create_github_issue, always provide a detailed title and body.",
            "For send_email, set parameters.to to the literal recipient as the user wrote it: a name (e.g. \"harsh\") OR an exact email address the user provided. NEVER invent, fabricate, or guess an email address. NEVER use placeholder, example, or reserved domains (example.com, example.org, example.net, *.test, *.invalid, *.localhost, test.com, etc.). If the user gave only a name, put just the name in `to` — a downstream contact resolver will look it up. If you cannot determine the recipient, set needsClarification=true with a specific question such as \"What email address should I send to for <name>?\" and leave `to` empty.",
            fenced.fenceInstruction,
        ].join(" ");

        const requestedOutcomes = Array.from(this.extractRequestedTools(task));
        const completedOutcomes = Array.from(this.collectCompletedTools(iterationContext));

        const userPayload = {
            task: {
                id: task._id.toString(),
                title: fenced.title,
                description: fenced.description,
                status: task.status,
                progress: typeof task.progress === "number" ? task.progress : 0,
                result: task.result ?? null,
            },
            executionHistory,
            availableTools,
            requestedOutcomes,
            completedOutcomes,
            iterationContext,
        };

        const llmRequest = {
            model,
            input: JSON.stringify({
                systemPrompt,
                userPayload,
            }),
            temperature: 0.0,
        };

        // Log sanitized request metadata only (no task/memory/email/model text payloads).
        const requestInput = llmRequest.input;
        console.log("agent-runner llm:request", {
            runId: this.ctx.currentRunId,
            taskId: task._id.toString(),
            model,
            inputLength: requestInput.length,
            inputHash: createHash("sha256").update(requestInput).digest("hex").slice(0, 16),
            availableToolCount: availableTools.length,
            availableToolNames: availableTools.map((tool) => tool.name),
            requestedOutcomeCount: requestedOutcomes.length,
            completedOutcomeCount: completedOutcomes.length,
            iterationContextCount: iterationContext.length,
        });

        let res;
        try {
            res = await this.requestLlmResponse(model, llmRequest.input);
        } catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            console.error("agent-runner llm:error", {
                taskId: task._id.toString(),
                runId: this.ctx.currentRunId,
                errorCode: "llm_request_failed",
                detailLength: detail.length,
            });
            this.rethrowLlmFailure(err);
        }

        // Log sanitized response metadata only.
        const responseText = String(res.output_text ?? (Array.isArray(res.output) ? JSON.stringify(res.output) : "")).trim();
        console.log("agent-runner llm:response", {
            runId: this.ctx.currentRunId,
            taskId: task._id.toString(),
            stepId: null,
            responseLength: responseText.length,
            responseHash: createHash("sha256").update(responseText).digest("hex").slice(0, 16),
        });

        const text = responseText;

        if (!text) {
            console.error("agent-runner llm:empty-response", { taskId: task._id.toString(), runId: this.ctx.currentRunId });
            throw new Error("LLM_ERROR: empty response from model");
        }

        // parse JSON-only response per system instructions
        try {
            const parsedRaw = parseJsonText<unknown>(text).value ?? JSON.parse(text) as unknown;
            const parsed = llmDecisionSchema.safeParse(parsedRaw);
            if (!parsed.success) {
                console.error("agent-runner llm:parse-failure", {
                    taskId: task._id.toString(),
                    runId: this.ctx.currentRunId,
                    errorCode: "llm_schema_invalid",
                    responseLength: text.length,
                    responseHash: createHash("sha256").update(text).digest("hex").slice(0, 16),
                    issueCount: parsed.error.issues.length,
                });
                throw new Error("LLM_ERROR: response parsing failed");
            }

            const decision = parsed.data;
            if (decision.tool !== null) {
                const selectedTool = availableTools.find((t) => t.name === decision.tool);
                if (!selectedTool) {
                    throw new Error(`LLM_ERROR: requested tool not available: ${decision.tool}`);
                }
            }

            const needsClarification = Boolean(decision.needsClarification) || decision.confidence < confidenceThreshold;
            return {
                toolName: decision.tool,
                confidence: decision.confidence,
                toolInput: decision.parameters,
                reasoning: decision.reasoning ?? undefined,
                goalAchieved: Boolean(decision.noAction),
                noAction: Boolean(decision.noAction),
                needsClarification,
                clarificationQuestion: needsClarification
                    ? (decision.clarificationQuestion ?? "Please provide more context.")
                    : decision.clarificationQuestion ?? undefined,
            };
        } catch (err) {
            if (err instanceof Error && err.message.startsWith("LLM_ERROR:")) {
                throw err;
            }
            console.error("agent-runner llm:parse-failure", {
                taskId: task._id.toString(),
                runId: this.ctx.currentRunId,
                errorCode: "llm_parse_failed",
                responseLength: text.length,
                responseHash: createHash("sha256").update(text).digest("hex").slice(0, 16),
                err: err instanceof Error ? err.message : String(err),
            });
            throw new Error("LLM_ERROR: response parsing failed");
        }
    }

    private extractEmailFromText(text: string): string | null {
        const emailRegex = /([a-zA-Z0-9._%-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
        const match = text.match(emailRegex);
        return match ? match[0] : null;
    }

    private generateEmailSubject(taskTitle: string): string {
        // Extract key words from task title, removing common phrases
        const cleaned = taskTitle
            .replace(/^(send an email to|report|notify|inform|alert|update|create|schedule)/gi, "")
            .replace(/to\s+\w+@[\w.]+/gi, "")
            .replace(/^\s+|\s+$/g, "")
            .trim();

        // If we have a cleaned title, use it; otherwise use the original
        if (cleaned.length > 5) {
            return cleaned.split(" ").slice(0, 8).join(" ");
        }

        // Fallback: extract first meaningful part
        const words = taskTitle.split(" ");
        return words.slice(0, 6).join(" ");
    }

    private generateEmailBody(taskTitle: string, taskDescription: string, taskId: string): string {
        const timestamp = new Date().toISOString();

        // Extract key action items from title and description
        const actionMatch = taskTitle.match(/to\s+(.+?)(?:\s+|$)/i);
        const action = actionMatch ? actionMatch[1] : taskTitle;

        return `
Task Notification

Task Title: ${taskTitle}

Details:
• Task ID: ${taskId}
• Created At: ${timestamp}
• Priority: High (Automated)

Description:
${taskDescription || "No additional details provided."}

Action Required:
Please review this task and take appropriate action.

---
This is an automated notification generated by the Task Execution System.
Reply to confirm receipt or contact support if you have questions.
`.trim();
    }

    private extractRequestedTools(task: TaskDocumentLike): Set<RequestedToolName> {
        const text = `${task.title} ${task.description ?? ""}`.toLowerCase();
        const requested = new Set<RequestedToolName>();

        if (/\b(email|mail|notify|message)\b/.test(text)) {
            requested.add("send_email");
        }

        if (/\b(github|issue|ticket|bug)\b/.test(text)) {
            requested.add("create_github_issue");
        }

        if (/\b(meeting|schedule|calendar|invite|sync)\b/.test(text)) {
            requested.add("schedule_meeting");
        }

        return requested;
    }

    private collectCompletedTools(iterationContext: IterationContextEntry[]): Set<string> {
        const completed = new Set<string>();

        for (const entry of iterationContext) {
            if (!entry.result?.adapterSuccess) {
                continue;
            }

            if (typeof entry.decision.toolName === "string" && entry.decision.toolName.length > 0) {
                completed.add(entry.decision.toolName);
            }
        }

        return completed;
    }

    private getDefaultToolInput(toolName: string, task: TaskDocumentLike): Record<string, unknown> {
        if (toolName === "send_email") {
            const recipientEmail = this.extractEmailFromText(task.title) || this.extractEmailFromText(task.description || "");
            const subject = this.generateEmailSubject(task.title);
            const body = this.generateEmailBody(task.title, task.description || "", task._id.toString());

            return {
                ...(recipientEmail ? { to: recipientEmail } : {}),
                subject: subject.length > 0 ? subject : "Task Notification",
                body,
            };
        }
        if (toolName === "schedule_meeting") {
            return {
                summary: task.title,
            };
        }
        if (toolName === "create_github_issue") {
            return {
                title: task.title,
                body: `Task ID: ${task._id.toString()}\n\n${task.description || "No description provided"}`,
            };
        }
        return {};
    }

    private progressForStep(step: "execute" | "observe" | "verify" | "adjust" | "done" | "failed", status: "started" | "completed" | "failed") {
        if (step === "done" || step === "failed") return 100;
        if (step === "execute") return status === "completed" ? 35 : 15;
        if (step === "observe") return status === "completed" ? 55 : 45;
        if (step === "verify") return status === "completed" ? 75 : 70;
        if (step === "adjust") return status === "completed" ? 85 : 80;
        return 0;
    }

    private async appendCheckpoint(
        task: TaskDocumentLike,
        input: {
            step: "execute" | "observe" | "verify" | "adjust" | "done" | "failed";
            status: "started" | "completed" | "failed";
            progress?: number;
            historyDelta?: ExecutionHistoryDelta;
        }
    ) {
        const nextCheckpoints = this.trimCheckpoints([
            ...(task.checkpoints ?? []),
            {
                step: input.step,
                status: input.status,
                timestamp: new Date().toISOString(),
            },
        ]);

        const history = this.getExecutionHistory(task);
        const nextHistory: TaskExecutionHistory = {
            attempts: history.attempts,
            failures: history.failures,
            results: [...history.results],
        };

        if (input.historyDelta?.attempts) {
            nextHistory.attempts += input.historyDelta.attempts;
        }
        if (input.historyDelta?.failures) {
            nextHistory.failures += input.historyDelta.failures;
        }
        if (input.historyDelta?.appendResult) {
            nextHistory.results = this.trimExecutionResults([
                ...nextHistory.results,
                {
                    attempt: input.historyDelta.appendResult.attempt,
                    success: input.historyDelta.appendResult.success,
                    summary: input.historyDelta.appendResult.summary,
                    ...(input.historyDelta.appendResult.error ? { error: input.historyDelta.appendResult.error } : {}),
                    ...(input.historyDelta.appendResult.validationLog
                        ? { validationLog: input.historyDelta.appendResult.validationLog }
                        : {}),
                    timestamp: new Date().toISOString(),
                },
            ]);
        }

        await this.ctx.updateTask(task, {
            progress: typeof input.progress === "number" ? input.progress : this.progressForStep(input.step, input.status),
            checkpoints: nextCheckpoints,
            executionHistory: nextHistory,
        });
    }

    private async emitExecutionUpdate(task: TaskDocumentLike, input: {
        state: TaskExecutionUpdatedPayload["state"];
        summary: string | null;
        error?: string | null;
        phase?: TaskExecutionUpdatedPayload["phase"];
        step?: string | null;
        progress?: number;
        details?: TaskExecutionUpdatedPayload["details"];
        runId?: string | null;
        attempt?: number | null;
    }) {
        if (!this.ctx.onExecutionUpdate) return;

        const runId = input.runId ?? this.ctx.currentRunId ?? null;
        await this.ctx.onExecutionUpdate({
            taskId: task._id.toString(),
            conversationId: task.conversationId.toString(),
            state: input.state,
            actionType: this.ctx.mapToolNameToActionType(input.details?.toolName ?? null),
            summary: input.summary,
            error: input.error ?? null,
            updatedAt: new Date().toISOString(),
            phase: input.phase,
            step: input.step ?? null,
            progress: input.progress,
            details: input.details ?? null,
            ...(runId ? { runId } : {}),
            ...(typeof input.attempt === "number" ? { attempt: input.attempt } : {}),
        });
    }

    private async handleCancellationIfRequested(
        task: TaskDocumentLike,
        runAbortController: AbortController,
        runId: string,
    ): Promise<RunTaskOutcome | null> {
        const fresh = await this.ctx.taskModel.findById(task._id.toString());
        if (!fresh || !isTaskCancellationRequested(fresh)) {
            return null;
        }

        runAbortController.abort();

        const reason = fresh.cancelReason ?? "Task cancelled.";
        const requestedAt = fresh.cancelRequestedAt instanceof Date
            ? fresh.cancelRequestedAt.toISOString()
            : new Date().toISOString();
        const initiatedBy = fresh.cancelRequestedByType ?? "user";

        await finalizeTaskCancellation({
            task: fresh as unknown as import("@semantask/db/models/Task").ITask & { save(): Promise<unknown> },
            reason,
            initiatedBy,
            requestedAt,
            workerId: this.ctx.workerId,
            releaseLease: false,
            source: "agent-runner.handleCancellationIfRequested",
        });

        await this.ctx.emitTaskUpdated(fresh.conversationId.toString(), {
            taskId: fresh._id.toString(),
            conversationId: fresh.conversationId.toString(),
            patch: {
                status: "failed",
                lifecycleState: "failed",
                ...(fresh.cancelRequestedAt instanceof Date ? { cancelRequestedAt: fresh.cancelRequestedAt.toISOString() } : {}),
                ...(typeof fresh.cancelReason === "string" ? { cancelReason: fresh.cancelReason } : {}),
                result: fresh.result,
                progress: 100,
                updatedBy: null,
            },
            previousVersion: Math.max(0, fresh.version - 1),
            newVersion: fresh.version,
            updatedByType: "agent",
            updatedById: null,
        });

        const cancelResult: ActionExecutionResult = {
            summary: "Task cancelled.",
            adapterSuccess: false,
            evidence: { reason: "cancelled" },
            error: reason,
        };

        await this.emitExecutionUpdate(fresh, {
            state: "cancelled",
            summary: "Task cancelled.",
            error: reason,
            phase: "finalize",
            step: "cancelled",
            progress: 100,
        });

        return {
            completed: false,
            retryCount: typeof fresh.retryCount === "number" ? fresh.retryCount : 0,
            maxRetries: typeof fresh.maxRetries === "number" ? fresh.maxRetries : 2,
            result: cancelResult,
            verification: null,
        };
    }

    async runTask(taskId: string, ctx?: RunTaskContext): Promise<RunTaskOutcome> {
        const runId = ctx?.runId ?? `run-${taskId}-${Date.now()}`;
        this.ctx.currentRunId = runId;
        try {
            const preflight = await this.ctx.taskModel.findById(taskId);
            if (preflight && isTaskCancellationRequested(preflight)) {
                const preflightAbort = new AbortController();
                const cancellationOutcome = await this.handleCancellationIfRequested(preflight, preflightAbort, runId);
                if (cancellationOutcome) {
                    return cancellationOutcome;
                }
            }

            if (this.ctx.persistentLoopEnabled) {
                return await this.runTaskPersistent(taskId, runId, ctx);
            }

            const task = await this.ctx.taskModel.findById(taskId);
            if (!task) {
                throw new Error(`Task not found: ${taskId}`);
            }

            this.setUsageContextFromTask(task);

            const action = await this.ctx.getLatestExecutionTaskAction(taskId);
            if (!action) {
                throw new Error(`No execution action found for task: ${taskId}`);
            }

            await this.shadow.startShadowExecutionRun(task, runId);

            const context: LoopContext = {
                task,
                action: {
                    taskId: action.taskId.toString(),
                    conversationId: action.conversationId.toString(),
                    toolName: action.toolName ?? action.actionType,
                    parameters: action.parameters ?? {},
                    messageId: action.messageId ? action.messageId.toString() : null,
                    executionState: action.executionState ?? null,
                },
                retryCount: typeof task.retryCount === "number" ? task.retryCount : 0,
                maxRetries: typeof task.maxRetries === "number" ? task.maxRetries : 2,
                attemptPayload: {
                    taskId: action.taskId.toString(),
                    conversationId: action.conversationId.toString(),
                    toolName: action.toolName ?? action.actionType,
                    parameters: action.parameters ?? {},
                    messageId: action.messageId ? action.messageId.toString() : null,
                    executionState: action.executionState ?? null,
                },
                observed: null,
                verification: null,
            };
            const availableTools = await this.listToolsForUser(task);
            const maxIterations = Math.max(1, Number(process.env.TASK_AGENT_MAX_ITERATIONS || 5));
            let iteration = 0;
            let goalAchieved = false;
            const iterationContext: IterationContextEntry[] = [];
            const runAbortController = new AbortController();
            if (ctx?.abortSignal) {
                if (ctx.abortSignal.aborted) {
                    runAbortController.abort();
                } else {
                    ctx.abortSignal.addEventListener("abort", () => runAbortController.abort(), { once: true });
                }
            }
            const cancelWatcher = this.startCancelWatcher(taskId, runAbortController);
            this.ctx.currentExecutionSignal = runAbortController.signal;

            try {
            logExecution("info", {
                event: "execution.started",
                workerId: this.ctx.workerId,
                runId: this.ctx.currentRunId ?? undefined,
                taskId,
                toolName: context.action.toolName,
                retryCount: context.retryCount,
                maxRetries: context.maxRetries,
                maxIterations,
            });

            await this.ctx.updateTask(task, {
                status: "executing",
                retryCount: context.retryCount,
                maxRetries: context.maxRetries,
            });
            await this.emitExecutionUpdate(task, {
                state: "running",
                summary: "Agent runner started.",
                phase: "reason",
                step: "run_task",
                progress: 10,
                details: {
                    toolName: context.action.toolName,
                },
            });

            await this.shadow.persistShadowExecutionState(task, { type: "PLAN_READY" });

            while (!goalAchieved && iteration < maxIterations && context.retryCount <= context.maxRetries && task.status !== "completed") {
                iteration += 1;

                const latestForCancel = await this.ctx.taskModel.findById(taskId);
                if (latestForCancel) {
                    const cancellationOutcome = await this.handleCancellationIfRequested(
                        latestForCancel,
                        runAbortController,
                        runId,
                    );
                    if (cancellationOutcome) {
                        return cancellationOutcome;
                    }
                }

                await this.shadow.persistShadowExecutionState(task, { type: "ITERATION_START", iteration });
                logExecution("info", {
                    event: "execution.iteration",
                    workerId: this.ctx.workerId,
                    runId: this.ctx.currentRunId ?? undefined,
                    taskId,
                    phase: "reason",
                    attempt: iteration,
                });

                try {
                    let decision: NextActionDecision;
                    try {
                        decision = await this.decideNextAction(task, this.getExecutionHistory(task), availableTools, iterationContext);
                    } catch (err) {
                        const message = err instanceof Error ? err.message : String(err);
                        if (/abort/i.test(message)) {
                            const cancellationOutcome = await this.resolveCancellationBeforeSideEffect(
                                taskId,
                                runAbortController,
                                runId,
                            );
                            if (cancellationOutcome) {
                                return cancellationOutcome;
                            }
                        }
                        if (typeof message === "string" && message.startsWith("LLM_ERROR:")) {
                            // LLM failed — do not execute any tool. Respect retry semantics.
                            context.retryCount += 1;
                            console.error("agent-runner llm:fatal", { taskId, reason: message, retryCount: context.retryCount });

                            const retryResult = await scheduleTaskRetry(task, err, {
                                runId: this.ctx.currentRunId,
                                actionType: this.ctx.mapToolNameToActionType(context.action.toolName),
                                emit: async (payload) => {
                                    await this.ctx.onExecutionUpdate?.(payload);
                                },
                            });
                            await this.shadow.persistShadowExecutionState(task, {
                                type: "ERROR_OCCURRED",
                                reason: message,
                                retryable: retryResult.outcome === "scheduled",
                                category: retryResult.decision.category,
                                retryCount: retryResult.retryCount,
                                maxRetries: context.maxRetries,
                                ...(retryResult.outcome === "scheduled" ? { nextRetryAt: retryResult.nextRetryAt.toISOString() } : {}),
                                finishedAt: new Date().toISOString(),
                            });

                            await this.appendCheckpoint(task, {
                                step: "failed",
                                status: "completed",
                                progress: 100,
                            });

                            return {
                                completed: false,
                                retryCount: typeof task.retryCount === "number" ? task.retryCount : context.retryCount,
                                maxRetries: context.maxRetries,
                                result: context.observed,
                                verification: context.verification,
                            };
                        }

                        throw err;
                    }
                    await this.emitExecutionUpdate(task, {
                        state: "running",
                        summary: decision.reasoning ?? "Selected next action.",
                        phase: "reason",
                        step: "decide_next_action",
                        progress: 20,
                        details: {
                            reasoning: decision.reasoning ?? null,
                            toolName: decision.toolName ?? undefined,
                            toolInput: decision.toolInput,
                        },
                    });
                    if (decision.needsClarification) {
                        await this.shadow.persistShadowExecutionState(task, {
                            type: "CLARIFICATION_REQUIRED",
                            reason: decision.reasoning ?? "Clarification required.",
                            question: decision.clarificationQuestion ?? "Please provide more details.",
                        });
                        await this.ctx.updateTask(task, {
                            status: "waiting_for_input",
                            lifecycleState: "paused",
                            pausedReason: decision.clarificationQuestion ?? decision.reasoning ?? "Clarification required.",
                            blockedReason: decision.clarificationQuestion ?? "Awaiting clarification.",
                            progress: 100,
                            result: {
                                success: false,
                                confidence: 0,
                                evidence: {
                                    needsClarification: true,
                                    clarificationQuestion: decision.clarificationQuestion ?? null,
                                },
                                error: decision.reasoning ?? "Execution paused: clarification required.",
                            },
                        });

                        await this.appendCheckpoint(task, {
                            step: "failed",
                            status: "completed",
                            progress: 100,
                        });
                        await this.emitExecutionUpdate(task, {
                            state: "blocked",
                            summary: "Execution paused; clarification required.",
                            error: null,
                            phase: "reason",
                            step: "needs_clarification",
                            progress: typeof task.progress === "number" ? task.progress : 0,
                            details: {
                                reasoning: decision.reasoning ?? null,
                                toolName: decision.toolName,
                                toolInput: Object.assign({}, decision.toolInput ?? {}, { _clarificationQuestion: decision.clarificationQuestion ?? null }),
                            },
                        });

                        return {
                            completed: false,
                            retryCount: context.retryCount,
                            maxRetries: context.maxRetries,
                            result: context.observed,
                            verification: context.verification,
                        };
                    }

                    if (decision.noAction || decision.goalAchieved) {
                        goalAchieved = true;
                        await this.shadow.persistShadowExecutionState(task, {
                            type: "GOAL_ACHIEVED",
                            finishedAt: new Date().toISOString(),
                            runId: this.ctx.getCurrentRunId(),
                            result: {
                                confidence: context.verification?.confidence ?? 1,
                                summary: decision.reasoning ?? "Goal achieved.",
                                evidence: context.observed?.evidence ?? null,
                            },
                        });
                        await this.ctx.updateTask(task, {
                            status: "completed",
                            progress: 100,
                            result: {
                                success: true,
                                confidence: context.verification?.confidence ?? 1,
                                evidence: {
                                    decision,
                                    execution: context.observed?.evidence ?? null,
                                },
                            },
                        });

                        await this.appendCheckpoint(task, {
                            step: "done",
                            status: "completed",
                            progress: 100,
                        });
                        await this.emitExecutionUpdate(task, {
                            state: "succeeded",
                            summary: decision.reasoning ?? "Goal achieved without additional tool execution.",
                            phase: "finalize",
                            step: "goal_achieved",
                            progress: 100,
                            details: {
                                reasoning: decision.reasoning ?? null,
                                toolName: decision.toolName,
                                toolInput: decision.toolInput,
                                verification: context.verification
                                    ? {
                                        success: context.verification.success,
                                        confidence: context.verification.confidence,
                                    }
                                    : null,
                            },
                        });

                        return {
                            completed: true,
                            retryCount: context.retryCount,
                            maxRetries: context.maxRetries,
                            result: context.observed,
                            verification: context.verification,
                        };
                    }

                    const selectedToolName = decision.toolName ?? "none";

                    const requestedTools = this.extractRequestedTools(task);
                    const completedTools = this.collectCompletedTools(iterationContext);
                    const missingTools = Array.from(requestedTools).filter((toolName) => !completedTools.has(toolName));

                    if (requestedTools.size > 0 && missingTools.length === 0) {
                        await this.shadow.persistShadowExecutionState(task, {
                            type: "GOAL_ACHIEVED",
                            finishedAt: new Date().toISOString(),
                            runId: this.ctx.getCurrentRunId(),
                            result: {
                                confidence: context.verification?.confidence ?? 1,
                                summary: "All requested outcomes are complete.",
                                evidence: context.observed?.evidence ?? null,
                            },
                        });
                        await this.ctx.updateTask(task, {
                            status: "completed",
                            progress: 100,
                            result: {
                                success: true,
                                confidence: context.verification?.confidence ?? 1,
                                evidence: {
                                    decision,
                                    execution: context.observed?.evidence ?? null,
                                    iterationContext,
                                },
                            },
                        });

                        await this.appendCheckpoint(task, {
                            step: "done",
                            status: "completed",
                            progress: 100,
                        });

                        console.log("agent-runner lifecycle:completed", {
                            taskId,
                            confidence: context.verification?.confidence ?? 1,
                        });

                        return {
                            completed: true,
                            retryCount: context.retryCount,
                            maxRetries: context.maxRetries,
                            result: context.observed,
                            verification: context.verification,
                        };
                    }

                    let effectiveToolName = selectedToolName;
                    let effectiveToolInput = decision.toolInput;

                    if (typeof selectedToolName === "string" && completedTools.has(selectedToolName) && missingTools.length > 0) {
                        effectiveToolName = missingTools[0];
                        effectiveToolInput = {};
                    }

                    const selectedTool = this.ctx.toolRegistry.get(effectiveToolName);
                    const mergedInput = {
                        ...this.getDefaultToolInput(effectiveToolName, task),
                        ...(effectiveToolInput ?? {}),
                    };
                    const normalizedInput = normalizeParams(effectiveToolName, mergedInput);
                    const validationError = selectedTool
                        ? validateToolParameters(selectedTool, normalizedInput)
                        : null;

                    if (validationError) {
                        throw new Error(validationError);
                    }

                    context.attemptPayload = {
                        ...context.attemptPayload,
                        toolName: effectiveToolName,
                        parameters: normalizedInput,
                    };
                    context.action = context.attemptPayload;

                    if (decision.reasoning) {
                        console.log("agent-runner step:decide", {
                            taskId,
                            toolName: effectiveToolName,
                            reasoning: decision.reasoning,
                        });
                    }

                    iterationContext.push({
                        iteration,
                        decision: {
                            toolName: effectiveToolName,
                            reasoning: decision.reasoning,
                            noAction: decision.noAction,
                            needsClarification: decision.needsClarification,
                        },
                    });

                    const toolIdempotencyKey = mongoose.connection.readyState === 1
                        ? this.toolExecutor.buildToolIdempotencyKey({
                            taskId,
                            stepId: context.action.stepId ?? context.action.toolName,
                            toolName: context.attemptPayload.toolName,
                            params: context.attemptPayload.parameters,
                        })
                        : null;
                    await this.shadow.persistShadowExecutionState(task, {
                        type: "TOOL_STARTED",
                        stepId: context.action.toolName,
                        toolName: context.attemptPayload.toolName,
                        attempt: context.retryCount + 1,
                        idempotencyKey: toolIdempotencyKey ?? "persistence_unavailable",
                    });

                    await this.appendCheckpoint(task, {
                        step: "execute",
                        status: "started",
                        historyDelta: { attempts: 1 },
                    });
                    await this.emitExecutionUpdate(task, {
                        state: "running",
                        summary: `Executing tool '${context.attemptPayload.toolName}'.`,
                        phase: "tool_execute",
                        step: "execute_tool",
                        progress: 35,
                        details: {
                            reasoning: decision.reasoning ?? null,
                            toolName: context.attemptPayload.toolName,
                            toolInput: context.attemptPayload.parameters,
                        },
                    });

                    const sideEffectCancellation = await this.resolveCancellationBeforeSideEffect(
                        taskId,
                        runAbortController,
                        runId,
                    );
                    if (sideEffectCancellation) {
                        return sideEffectCancellation;
                    }

                    const executed = await this.toolExecutor.execute({
                        ...context.attemptPayload,
                        stepId: context.action.stepId ?? context.action.toolName,
                        attempt: context.retryCount + 1,
                        idempotencyKey: toolIdempotencyKey,
                    }, {
                        userId: this.getTaskUserId(task),
                        organizationId: task.organizationId?.toString?.() ?? null,
                        clarificationReply: ctx?.clarificationReply
                            ?? (typeof task.pausedReason === "string" ? task.pausedReason : null),
                        pendingResolution: this.clarification.getPendingResolution(task),
                    });

                    const clarification = this.clarification.getClarificationPayload(executed);
                    if (clarification) {
                        await this.shadow.persistShadowExecutionState(task, {
                            type: "CLARIFICATION_REQUIRED",
                            reason: "Tool execution requires clarification.",
                            question: clarification.question,
                            pendingResolution: clarification.pendingResolution ?? undefined,
                        });
                        await this.clarification.pauseForClarification(task, clarification.question, context.action.stepId ?? undefined, clarification.pendingResolution);
                        return {
                            completed: false,
                            retryCount: context.retryCount,
                            maxRetries: context.maxRetries,
                            result: executed,
                            verification: null,
                        };
                    }

                    await this.appendCheckpoint(task, {
                        step: "execute",
                        status: "completed",
                    });

                    await this.appendCheckpoint(task, {
                        step: "observe",
                        status: "started",
                    });
                    await this.emitExecutionUpdate(task, {
                        state: "running",
                        summary: "Observing tool execution output.",
                        phase: "observe",
                        step: "observe_result",
                        progress: 55,
                        details: {
                            toolName: context.attemptPayload.toolName,
                            toolOutput: this.ctx.summarizeEvidence(executed.evidence),
                        },
                    });

                    await this.shadow.persistShadowExecutionState(task, { type: "TOOL_OBSERVED" });
                    context.observed = await this.toolExecutor.observe(context, executed);

                    const currentContext = iterationContext[iterationContext.length - 1];
                    if (currentContext) {
                        currentContext.result = {
                            summary: context.observed.summary,
                            adapterSuccess: context.observed.adapterSuccess,
                            error: context.observed.error,
                        };
                    }

                    await this.appendCheckpoint(task, {
                        step: "observe",
                        status: "completed",
                    });

                    await this.appendCheckpoint(task, {
                        step: "verify",
                        status: "started",
                    });
                    await this.emitExecutionUpdate(task, {
                        state: "running",
                        summary: "Verifying execution outcome.",
                        phase: "verify",
                        step: "verify_result",
                        progress: 75,
                        details: {
                            toolName: context.attemptPayload.toolName,
                            toolOutput: this.ctx.summarizeEvidence(context.observed?.evidence),
                        },
                    });

                    await this.shadow.persistShadowExecutionState(task, { type: "TOOL_VERIFIED" });
                    context.verification = await this.toolExecutor.verify(context.observed, context);
                    await this.emitExecutionUpdate(task, {
                        state: context.verification.success ? "running" : "failed",
                        summary: context.verification.success ? "Verification passed." : "Verification failed.",
                        error: context.verification.success ? null : (context.observed?.error ?? "Verification failed"),
                        phase: "verify",
                        step: "verification_completed",
                        progress: context.verification.success ? 85 : 80,
                        details: {
                            toolName: context.attemptPayload.toolName,
                            toolOutput: this.ctx.summarizeEvidence(context.observed?.evidence),
                            verification: {
                                success: context.verification.success,
                                confidence: context.verification.confidence,
                            },
                        },
                    });

                    if (context.verification.success) {
                        await this.shadow.persistShadowExecutionState(task, { type: "STEP_COMPLETED" });
                        await this.appendCheckpoint(task, {
                            step: "verify",
                            status: "completed",
                            historyDelta: {
                                appendResult: {
                                    attempt: context.retryCount + 1,
                                    success: true,
                                    summary: context.observed.summary,
                                    validationLog: context.verification.validationLog,
                                },
                            },
                        });
                    } else {
                        await this.appendCheckpoint(task, {
                            step: "verify",
                            status: "failed",
                            historyDelta: {
                                failures: 1,
                                appendResult: {
                                    attempt: context.retryCount + 1,
                                    success: false,
                                    summary: context.observed.summary,
                                    error: context.observed.error ?? "Verification failed",
                                    validationLog: context.verification.validationLog,
                                },
                            },
                        });
                    }

                    if (context.verification.success) {
                        await this.ctx.updateTask(task, {
                            status: "executing",
                            retryCount: context.retryCount,
                            maxRetries: context.maxRetries,
                            progress: Math.min(95, 35 + (iteration * 10)),
                            result: {
                                success: true,
                                confidence: context.verification.confidence,
                                evidence: {
                                    lastExecution: context.observed.evidence,
                                    validationLog: context.verification.validationLog,
                                    iterationContext,
                                },
                            },
                        });

                        await this.emitExecutionUpdate(task, {
                            state: "running",
                            summary: "Step succeeded. Evaluating whether more actions are needed.",
                            phase: "reason",
                            step: "continue_or_complete",
                            progress: Math.min(95, 35 + (iteration * 10)),
                            details: {
                                toolName: context.attemptPayload.toolName,
                                toolInput: context.attemptPayload.parameters,
                                toolOutput: this.ctx.summarizeEvidence(context.observed.evidence),
                                verification: {
                                    success: context.verification.success,
                                    confidence: context.verification.confidence,
                                },
                            },
                        });

                        console.log("agent-runner lifecycle:step-completed", {
                            taskId,
                            iteration,
                            toolName: context.attemptPayload.toolName,
                            confidence: context.verification.confidence,
                        });

                        continue;
                    }

                    context.retryCount += 1;

                    console.warn("agent-runner lifecycle:continue", {
                        taskId,
                        iteration,
                        reason: context.observed.error ?? "verification failed",
                    });

                    if (context.retryCount > context.maxRetries) {
                        const retryResult = await scheduleTaskRetry(task, new Error(context.observed.error ?? "verification failed"), {
                            runId: this.ctx.currentRunId,
                            actionType: this.ctx.mapToolNameToActionType(context.attemptPayload.toolName),
                            emit: async (payload) => {
                                await this.ctx.onExecutionUpdate?.(payload);
                            },
                        });
                        await this.shadow.persistShadowExecutionState(task, {
                            type: "ERROR_OCCURRED",
                            reason: context.observed.error ?? "verification failed",
                            retryable: retryResult.outcome === "scheduled",
                            category: retryResult.decision.category,
                            retryCount: retryResult.retryCount,
                            maxRetries: context.maxRetries,
                            ...(retryResult.outcome === "scheduled" ? { nextRetryAt: retryResult.nextRetryAt.toISOString() } : {}),
                            finishedAt: new Date().toISOString(),
                        });
                        return {
                            completed: false,
                            retryCount: retryResult.retryCount,
                            maxRetries: context.maxRetries,
                            result: context.observed,
                            verification: context.verification,
                        };
                    }

                    await this.ctx.updateTask(task, {
                        status: "executing",
                        retryCount: context.retryCount,
                        maxRetries: context.maxRetries,
                    });
                    await this.emitExecutionUpdate(task, {
                        state: "running",
                        summary: "Verification failed; preparing next iteration.",
                        error: context.observed.error ?? "verification failed",
                        phase: "reason",
                        step: "retry_iteration",
                        progress: 60,
                        details: {
                            toolName: context.attemptPayload.toolName,
                            toolOutput: context.observed.evidence,
                        },
                    });
                } catch (error) {
                    const reason = error instanceof Error ? error.message : "unknown execution error";

                    if (/abort|timed out|lease lost/i.test(reason)) {
                        const cancellationOutcome = await this.resolveCancellationBeforeSideEffect(
                            taskId,
                            runAbortController,
                            runId,
                        );
                        if (cancellationOutcome) {
                            return cancellationOutcome;
                        }

                        await this.shadow.persistShadowExecutionState(task, {
                            type: "ERROR_OCCURRED",
                            reason,
                            retryable: false,
                            category: "aborted",
                            retryCount: context.retryCount,
                            maxRetries: context.maxRetries,
                            finishedAt: new Date().toISOString(),
                        });
                        await this.ctx.updateTask(task, {
                            status: "failed",
                            retryCount: context.retryCount,
                            maxRetries: context.maxRetries,
                            progress: 100,
                            result: {
                                success: false,
                                confidence: 0,
                                evidence: { reason },
                                error: reason,
                            },
                        });

                        await this.appendCheckpoint(task, {
                            step: "failed",
                            status: "completed",
                            progress: 100,
                        });

                        await this.emitExecutionUpdate(task, {
                            state: "failed",
                            summary: reason,
                            error: reason,
                            phase: "tool_execute",
                            step: "iteration_aborted",
                            progress: 100,
                            details: {
                                toolName: context.attemptPayload.toolName,
                                toolInput: context.attemptPayload.parameters,
                            },
                        });

                        return {
                            completed: false,
                            retryCount: context.retryCount,
                            maxRetries: context.maxRetries,
                            result: context.observed,
                            verification: context.verification,
                        };
                    }

                    // Generic non-LLM error: record observation and increment retry count
                    await this.appendCheckpoint(task, {
                        step: "execute",
                        status: "failed",
                        historyDelta: {
                            failures: 1,
                            appendResult: {
                                attempt: context.retryCount + 1,
                                success: false,
                                summary: "Execution failed before verification",
                                error: reason,
                            },
                        },
                    });

                    context.observed = {
                        summary: "Execution failed before verification",
                        adapterSuccess: false,
                        evidence: {
                            reason,
                            iteration,
                        },
                        error: reason,
                    };

                    context.retryCount += 1;
                    await this.shadow.persistShadowExecutionState(task, {
                        type: "ERROR_OCCURRED",
                        reason,
                        retryable: context.retryCount <= context.maxRetries,
                        category: "iteration_error",
                        retryCount: context.retryCount,
                        maxRetries: context.maxRetries,
                        ...(context.retryCount <= context.maxRetries
                            ? { nextRetryAt: new Date(Date.now() + 1000).toISOString() }
                            : {}),
                        finishedAt: new Date().toISOString(),
                    });

                    console.warn("agent-runner lifecycle:iteration-error", {
                        taskId,
                        reason,
                        retryCount: context.retryCount,
                        maxRetries: context.maxRetries,
                    });

                    if (context.retryCount > context.maxRetries) {
                        const retryResult = await scheduleTaskRetry(task, error, {
                            runId: this.ctx.currentRunId,
                            actionType: this.ctx.mapToolNameToActionType(context.attemptPayload.toolName),
                            emit: async (payload) => {
                                await this.ctx.onExecutionUpdate?.(payload);
                            },
                        });
                        return {
                            completed: false,
                            retryCount: retryResult.retryCount,
                            maxRetries: context.maxRetries,
                            result: context.observed,
                            verification: context.verification,
                        };
                    }

                    await this.ctx.updateTask(task, {
                        status: "executing",
                        retryCount: context.retryCount,
                        maxRetries: context.maxRetries,
                    });
                    await this.emitExecutionUpdate(task, {
                        state: "failed",
                        summary: "Execution iteration failed.",
                        error: reason,
                        phase: "tool_execute",
                        step: "iteration_exception",
                        progress: 50,
                        details: {
                            toolName: context.attemptPayload.toolName,
                            toolInput: context.attemptPayload.parameters,
                        },
                    });
                }
            }

            const exhaustedByRetries = context.retryCount > context.maxRetries;
            const exhaustionReason = exhaustedByRetries
                ? "Retry budget exhausted before goal achievement."
                : "Max iterations reached before goal achievement.";
            await this.shadow.persistShadowExecutionState(task, {
                type: "ERROR_OCCURRED",
                reason: exhaustionReason,
                retryable: false,
                category: exhaustedByRetries ? "retry_budget" : "max_iterations",
                retryCount: context.retryCount,
                maxRetries: context.maxRetries,
                finishedAt: new Date().toISOString(),
            });
            await this.ctx.updateTask(task, {
                status: "failed",
                retryCount: context.retryCount,
                maxRetries: context.maxRetries,
                progress: 100,
                result: {
                    success: false,
                    confidence: context.verification?.confidence ?? 0,
                    evidence: context.observed?.evidence ?? null,
                    error: exhaustionReason,
                },
            });

            await this.appendCheckpoint(task, {
                step: "failed",
                status: "completed",
                progress: 100,
            });
            await this.emitExecutionUpdate(task, {
                state: "failed",
                summary: exhaustionReason,
                error: exhaustionReason,
                phase: "finalize",
                step: exhaustedByRetries ? "retry_budget_exhausted" : "max_iterations_reached",
                progress: 100,
                details: {
                    toolName: context.attemptPayload.toolName,
                    toolInput: context.attemptPayload.parameters,
                    toolOutput: this.ctx.summarizeEvidence(context.observed?.evidence),
                    verification: context.verification
                        ? {
                            success: context.verification.success,
                            confidence: context.verification.confidence,
                        }
                        : null,
                },
            });

            console.log("agent-runner lifecycle:exhausted", {
                taskId,
                retryCount: context.retryCount,
                maxRetries: context.maxRetries,
                maxIterations,
            });

            return {
                completed: false,
                retryCount: context.retryCount,
                maxRetries: context.maxRetries,
                result: context.observed,
                verification: context.verification,
            };
            } finally {
                cancelWatcher.stop();
                this.ctx.currentExecutionSignal = null;
            }
        } finally {
            this.ctx.currentRunId = null;
            this.ctx.currentUsageContext = null;
        }
    }

    private async ensurePlan(task: TaskDocumentLike): Promise<TaskPlanLike> {
        let plan = await this.ctx.getTaskPlanFn(task._id.toString()) as unknown as TaskPlanLike | null;
        if (!plan) {
            await this.transitionLifecycle(task, "planning");
            await this.ctx.createOrRefreshTaskPlanFn(
                {
                    taskId: task._id.toString(),
                    conversationId: task.conversationId.toString(),
                    title: task.title,
                    description: task.description,
                    sourceMessageIds: (task.sourceMessageIds ?? []).map((id) => id.toString()),
                    availableTools: (await this.listToolsForUser(task)).map((tool) => ({
                        name: tool.name,
                        description: tool.description,
                    })),
                },
                { llmRequestFn: this.ctx.llmRequestFn }
            );
            await this.transitionLifecycle(task, "ready");
            plan = await this.ctx.getTaskPlanFn(task._id.toString()) as unknown as TaskPlanLike | null;
        }

        if (!plan) {
            throw new Error(`Failed to load task plan for task: ${task._id.toString()}`);
        }

        return plan;
    }

    private async transitionLifecycle(
        task: TaskDocumentLike,
        nextState: "planning" | "ready" | "executing" | "waiting_for_approval" | "blocked" | "retry_scheduled" | "paused" | "completed" | "failed"
    ) {
        const current = task.lifecycleState ?? "ready";
        if (current === nextState) return;
        this.ctx.assertTransitionFn(current, nextState);

        task.lifecycleState = nextState;
        if (nextState === "completed") {
            task.status = "completed";
        } else if (nextState === "failed") {
            task.status = "failed";
        } else if (nextState === "executing") {
            task.status = "executing";
        } else if (nextState === "waiting_for_approval" || nextState === "blocked") {
            task.status = "partial";
        } else if (nextState === "ready") {
            task.status = "pending";
        }

        await this.ctx.updateTask(task, {
            status: task.status,
            lifecycleState: task.lifecycleState,
        });
    }

    private async pickNextRunnableStep(plan: TaskPlanLike): Promise<PlanStepLike | null> {
        const byId = new Map(plan.steps.map((step) => [step.stepId, step]));

        const runnable = plan.steps
            .filter((step) => step.state === "ready" || step.state === "retry_scheduled")
            .filter((step) => {
                if (step.overrideDependencies) {
                    return true;
                }

                if (!step.dependencies || step.dependencies.length === 0) {
                    return true;
                }

                if (step.fallbackPolicy === "immediate_execution") {
                    return step.dependencies.every((dependencyId) => {
                        const state = byId.get(dependencyId)?.state;
                        return state === "completed" || state === "failed" || state === "skipped";
                    });
                }

                return step.dependencies.every((dependencyId) => byId.get(dependencyId)?.state === "completed");
            })
            .sort((left, right) => left.order - right.order);

        return runnable[0] ?? null;
    }

    private async updatePlanStepState(taskId: string, stepId: string, patch: Partial<PlanStepLike>) {
        if (this.ctx.updatePlanStepStateFn) {
            await this.ctx.updatePlanStepStateFn(taskId, stepId, patch);
            return;
        }

        const setPatch: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(patch)) {
            setPatch[`steps.$.${key}`] = value as unknown;
        }

        await TaskPlanModel.updateOne(
            {
                taskId,
                "steps.stepId": stepId,
            },
            {
                $set: {
                    ...setPatch,
                    activeStepId: stepId,
                },
            }
        ).exec();
    }

    private async rankStepTools(
        task: TaskDocumentLike,
        step: PlanStepLike,
        longTermMemory: Array<Record<string, unknown>>
    ) {
        const historyByTool = new Map<string, number[]>();

        for (const item of longTermMemory) {
            const toolName = typeof item.toolName === "string" ? item.toolName : null;
            if (!toolName) continue;
            const impact = typeof item.successImpact === "number" ? item.successImpact : 0;
            const normalized = Math.max(0, Math.min(1, (impact + 1) / 2));
            const list = historyByTool.get(toolName) ?? [];
            list.push(normalized);
            historyByTool.set(toolName, list);
        }

        const allowedTools = await this.listToolsForUser(task);
        const allowedNames = new Set(allowedTools.map((tool) => tool.name));

        const candidates = (step.toolCandidates.length > 0
            ? step.toolCandidates
            : allowedTools.map((tool) => ({
                toolName: tool.name,
                confidence: 0.5,
                riskLevel: "medium" as const,
            }))
        ).filter((candidate) => allowedNames.has(candidate.toolName) || candidate.toolName === "none");

        const inputs: ToolRankingInput[] = candidates
            .filter((candidate) => candidate.toolName !== "none")
            .map((candidate) => {
                const history = historyByTool.get(candidate.toolName) ?? [];
                const historicalSuccessRate = history.length > 0
                    ? history.reduce((sum, value) => sum + value, 0) / history.length
                    : 0.5;

                return {
                    toolName: candidate.toolName as Exclude<TaskExecutionActionType, "none">,
                    capabilityScore: candidate.confidence,
                    historicalSuccessRate,
                    riskPenalty: candidate.riskLevel === "high" ? 0.7 : candidate.riskLevel === "medium" ? 0.35 : 0.1,
                    recentFailurePenalty: 0,
                };
            });

        return rankTools(inputs);
    }

    private async decideStepAction(input: {
        task: TaskDocumentLike;
        step: PlanStepLike;
        rankedTools: ReturnType<typeof rankTools>;
        shortTermMemory: Array<Record<string, unknown>>;
        longTermMemory: Array<Record<string, unknown>>;
        previousStepOutputs: PreviousStepOutputs;
        clarificationReply?: string | null;
        previousError?: string | null;
        previousParameters?: Record<string, unknown> | null;
        iteration: number;
    }): Promise<NextActionDecision> {
        const ranked = input.rankedTools;

        const model = process.env.TASK_AGENT_MODEL || "gpt-4o-mini";
        const confidenceThreshold = this.getConfidenceThreshold();
        const fenced = buildFencedTaskFields(input.task.title, input.task.description);

        const userPayload = {
            task: {
                id: input.task._id.toString(),
                title: fenced.title,
                description: fenced.description,
            },
            currentStep: input.step,
            rankedTools: ranked,
            memory: {
                shortTerm: input.shortTermMemory.slice(0, 5),
                longTerm: input.longTermMemory.slice(0, 5),
            },
            previousStepOutputs: input.previousStepOutputs,
            clarificationReply: input.clarificationReply ?? null,
            previousError: input.previousError ?? null,
            previousParameters: input.previousParameters ?? null,
            iteration: input.iteration,
        };

        const systemPrompt = [
            "Return one JSON object only with keys: tool, confidence, parameters, reasoning, needsClarification, clarificationQuestion.",
            "No extra text.",
            "For send_email, set parameters.to to the literal recipient as the user wrote it: a name (e.g. \"harsh\") OR an exact email address the user provided. NEVER invent, fabricate, or guess an email address. NEVER use placeholder, example, or reserved domains (example.com, example.org, example.net, *.test, *.invalid, *.localhost, test.com, etc.). If only a name was provided, pass that name as the recipient — the resolver will look it up. If the recipient is unknown, set needsClarification=true with a specific question.",
            fenced.fenceInstruction,
        ].join(" ");

        console.log("agent-runner llm:step-request", {
            runId: this.ctx.currentRunId,
            taskId: input.task._id.toString(),
            stepId: input.step.stepId,
            model,
            rankedToolCount: ranked.length,
            rankedToolNames: ranked.map((entry) => entry.toolName),
            hasClarificationReply: Boolean(input.clarificationReply),
            hasPreviousError: Boolean(input.previousError),
            iteration: input.iteration,
        });

        let res;
        try {
            res = await this.requestLlmResponse(model, JSON.stringify({ systemPrompt, userPayload }));
        } catch (err) {
            console.error("agent-runner llm:step-error", {
                runId: this.ctx.currentRunId,
                taskId: input.task._id.toString(),
                stepId: input.step.stepId,
                errorCode: "llm_request_failed",
                err: err instanceof Error ? err.message : String(err),
            });
            this.rethrowLlmFailure(err);
        }

        const text = String(res.output_text ?? (Array.isArray(res.output) ? res.output.map((o: any) => (o.content ?? []).map((c: any) => c.text || JSON.stringify(c)).join('')).join('\n') : '')).trim();
        if (!text) {
            console.error("agent-runner llm:step-empty", { runId: this.ctx.currentRunId, taskId: input.task._id.toString(), stepId: input.step.stepId });
            throw new Error("LLM_ERROR: empty response from model");
        }

        try {
            const parsedRaw = parseJsonText<unknown>(text).value ?? JSON.parse(text) as unknown;
            const parsed = llmDecisionSchema.safeParse(parsedRaw);
            if (!parsed.success) {
                console.error("agent-runner llm:step-parse-failure", {
                    runId: this.ctx.currentRunId,
                    taskId: input.task._id.toString(),
                    stepId: input.step.stepId,
                    errorCode: "llm_schema_invalid",
                    responseLength: text.length,
                    responseHash: createHash("sha256").update(text).digest("hex").slice(0, 16),
                    issueCount: parsed.error.issues.length,
                });
                throw new Error("LLM_ERROR: response parsing failed");
            }

            const decision = parsed.data;
            if (decision.tool !== null) {
                const matches = ranked.some((r) => r.toolName === decision.tool);
                if (!matches) {
                    throw new Error(`LLM_ERROR: selected tool not in ranked list: ${decision.tool}`);
                }
            }

            const needsClarification = Boolean(decision.needsClarification) || decision.confidence < confidenceThreshold;

            return {
                toolName: decision.tool,
                confidence: decision.confidence,
                toolInput: decision.parameters,
                reasoning: decision.reasoning,
                goalAchieved: Boolean(decision.noAction),
                noAction: Boolean(decision.noAction),
                needsClarification,
                clarificationQuestion: needsClarification
                    ? (decision.clarificationQuestion ?? "Please provide more context.")
                    : decision.clarificationQuestion ?? undefined,
            };
        } catch (err) {
            if (err instanceof Error && err.message.startsWith("LLM_ERROR:")) {
                throw err;
            }
            console.error("agent-runner llm:step-parse-failure", {
                runId: this.ctx.currentRunId,
                taskId: input.task._id.toString(),
                stepId: input.step.stepId,
                errorCode: "llm_parse_failed",
                responseLength: text.length,
                responseHash: createHash("sha256").update(text).digest("hex").slice(0, 16),
                err: err instanceof Error ? err.message : String(err),
            });
            throw new Error("LLM_ERROR: response parsing failed");
        }
    }

    private async runTaskPersistent(taskId: string, runId: string, ctx?: RunTaskContext): Promise<RunTaskOutcome> {
        const task = await this.ctx.taskModel.findById(taskId);
        if (!task) {
            throw new Error(`Task not found: ${taskId}`);
        }

        this.setUsageContextFromTask(task);

        const leaseHeld = Boolean(ctx?.leaseHeld);
        if (!leaseHeld) {
            const lease = await this.ctx.acquireTaskLeaseFn(taskId, this.ctx.workerId);
            if (!lease) {
                return {
                    completed: false,
                    retryCount: typeof task.retryCount === "number" ? task.retryCount : 0,
                    maxRetries: typeof task.maxRetries === "number" ? task.maxRetries : 2,
                    result: null,
                    verification: null,
                };
            }
        }

        const maxIterations = Math.max(1, Number(process.env.TASK_AGENT_MAX_ITERATIONS || 8));
        const iterationTimeoutMs = Math.max(1000, Number(process.env.TASK_AGENT_ITERATION_TIMEOUT_MS || 120000));
        const leaseMs = Math.max(1000, Number(process.env.TASK_LEASE_MS || 30000));
        const watchdogIntervalMs = Math.max(1000, Math.floor(leaseMs / 3));
        let iteration = typeof task.iterationCount === "number" ? task.iterationCount : 0;
        let lastResult: ActionExecutionResult | null = null;
        let lastVerification: VerificationOutcome | null = null;
        const runAbortController = new AbortController();
        if (ctx?.abortSignal) {
            if (ctx.abortSignal.aborted) {
                runAbortController.abort();
            } else {
                ctx.abortSignal.addEventListener("abort", () => runAbortController.abort(), { once: true });
            }
        }
        this.ctx.currentRunId = runId;
        const watchdog = leaseHeld
            ? { stop: () => undefined }
            : this.startLeaseWatchdog(taskId, runAbortController, runId, watchdogIntervalMs);
        const cancelWatcher = this.startCancelWatcher(taskId, runAbortController);

        try {
            await this.shadow.startShadowExecutionRun(task, runId);
            await this.ensurePlan(task);
            await this.transitionLifecycle(task, "ready");
            await this.shadow.persistShadowExecutionState(task, { type: "PLAN_READY" });

            while (iteration < maxIterations) {
                iteration += 1;
                const iterationAbortController = new AbortController();
                const iterationTimeoutHandle = setTimeout(() => iterationAbortController.abort(), iterationTimeoutMs);
                this.ctx.currentExecutionSignal = combineAbortSignals(runAbortController.signal, iterationAbortController.signal) ?? runAbortController.signal;

                try {
                    const leaseAlive = await this.ctx.heartbeatTaskLeaseFn(taskId, this.ctx.workerId);
                    if (!leaseAlive) {
                        console.warn("agent-runner lease:lost", { runId, taskId, workerId: this.ctx.workerId });
                        runAbortController.abort();
                        return {
                            completed: false,
                            retryCount: typeof task.retryCount === "number" ? task.retryCount : 0,
                            maxRetries: typeof task.maxRetries === "number" ? task.maxRetries : 2,
                            result: lastResult,
                            verification: lastVerification,
                        };
                    }

                    const latestTask = await this.ctx.taskModel.findById(taskId);
                    if (!latestTask) {
                        throw new Error(`Task disappeared during execution: ${taskId}`);
                    }

                    const cancellationOutcome = await this.handleCancellationIfRequested(
                        latestTask,
                        runAbortController,
                        runId,
                    );
                    if (cancellationOutcome) {
                        return cancellationOutcome;
                    }

                    await this.shadow.persistShadowExecutionState(latestTask, { type: "ITERATION_START", iteration });

                    const plan = await this.ensurePlan(latestTask);
                    const step = await this.pickNextRunnableStep(plan);

                    if (!step) {
                        const hasFailedStep = plan.steps.some((entry) => entry.state === "failed" || entry.state === "blocked");
                        const hasPending = plan.steps.some((entry) => ["ready", "running", "retry_scheduled", "waiting_for_dependency"].includes(entry.state));

                        if (hasFailedStep) {
                            await this.shadow.persistShadowExecutionState(latestTask, {
                                type: "ERROR_OCCURRED",
                                reason: "A plan step failed or became blocked.",
                                retryable: false,
                                category: "plan_step_failed",
                                retryCount: typeof latestTask.retryCount === "number" ? latestTask.retryCount : 0,
                                maxRetries: typeof latestTask.maxRetries === "number" ? latestTask.maxRetries : 2,
                                finishedAt: new Date().toISOString(),
                            });
                            await this.transitionLifecycle(latestTask, "failed");
                            break;
                        }

                        if (!hasPending) {
                            await this.shadow.persistShadowExecutionState(latestTask, {
                                type: "GOAL_ACHIEVED",
                                finishedAt: new Date().toISOString(),
                                runId: this.ctx.getCurrentRunId(),
                                result: {
                                    confidence: lastVerification?.confidence ?? 1,
                                    summary: lastResult?.summary ?? "Task completed.",
                                    evidence: lastResult?.evidence ?? null,
                                },
                            });
                            await this.transitionLifecycle(latestTask, "completed");
                            break;
                        }

                        await this.shadow.persistShadowExecutionState(latestTask, {
                            type: "BLOCKED",
                            reason: "No runnable steps due to dependency constraints.",
                        });
                        await this.transitionLifecycle(latestTask, "blocked");
                        latestTask.blockedReason = "No runnable steps due to dependency constraints.";
                        await this.ctx.updateTask(latestTask, {
                            status: latestTask.status,
                            lifecycleState: latestTask.lifecycleState,
                        });
                        break;
                    }

                    await this.transitionLifecycle(latestTask, "executing");
                    await this.ctx.updateTask(latestTask, {
                        status: latestTask.status,
                        lifecycleState: latestTask.lifecycleState,
                        currentStepId: step.stepId,
                        iterationCount: iteration,
                    });

                    await this.updatePlanStepState(taskId, step.stepId, {
                        state: "running",
                        startedAt: new Date(),
                        attempts: (step.attempts ?? 0) + 1,
                        selectedToolName: step.selectedToolName ?? null,
                        lastError: null,
                    });

                    const previousStepOutputs = this.buildPreviousStepOutputs(plan);
                    const clarificationReply = (typeof ctx?.clarificationReply === "string" && ctx.clarificationReply.trim().length > 0
                        ? ctx.clarificationReply
                        : null)
                        ?? (typeof latestTask.pausedReason === "string" && latestTask.pausedReason.trim().length > 0
                            ? latestTask.pausedReason
                            : null);
                    if (clarificationReply && latestTask.pausedReason) {
                        await this.ctx.updateTask(latestTask, { pausedReason: null });
                    }

                    const memory = await this.ctx.retrieveMemoryFn({
                        taskId,
                        conversationId: latestTask.conversationId.toString(),
                        toolName: step.selectedToolName ?? undefined,
                        limit: 10,
                    });

                    const rankedTools = await this.rankStepTools(latestTask, step, memory.longTerm as Array<Record<string, unknown>>);

                    let decision: NextActionDecision;
                    try {
                        decision = await this.decideStepAction({
                            task: latestTask,
                            step,
                            rankedTools,
                            shortTermMemory: memory.shortTerm as Array<Record<string, unknown>>,
                            longTermMemory: memory.longTerm as Array<Record<string, unknown>>,
                            previousStepOutputs,
                            clarificationReply,
                            previousError: step.lastError ?? null,
                            previousParameters: (step.input ?? null) as Record<string, unknown> | null,
                            iteration,
                        });
                    } catch (err) {
                        const message = err instanceof Error ? err.message : String(err);
                        if (/abort/i.test(message)) {
                            const cancellationOutcome = await this.resolveCancellationBeforeSideEffect(
                                taskId,
                                runAbortController,
                                runId,
                            );
                            if (cancellationOutcome) {
                                return cancellationOutcome;
                            }
                        }
                        if (typeof message === "string" && message.startsWith("LLM_ERROR:")) {
                            // Do not execute any tool. Respect retry semantics for persistent loop.
                            await this.updatePlanStepState(taskId, step.stepId, {
                                state: "retry_scheduled",
                                lastError: message,
                            });

                            const retryResult = await scheduleTaskRetry(latestTask, err, {
                                runId: this.ctx.currentRunId,
                                actionType: this.ctx.mapToolNameToActionType(step.selectedToolName ?? null),
                                emit: async (payload) => {
                                    await this.ctx.onExecutionUpdate?.(payload);
                                },
                            });
                            await this.shadow.persistShadowExecutionState(latestTask, {
                                type: "ERROR_OCCURRED",
                                reason: message,
                                retryable: retryResult.outcome === "scheduled",
                                category: retryResult.decision.category,
                                retryCount: retryResult.retryCount,
                                maxRetries: typeof latestTask.maxRetries === "number" ? latestTask.maxRetries : 2,
                                ...(retryResult.outcome === "scheduled" ? { nextRetryAt: retryResult.nextRetryAt.toISOString() } : {}),
                                finishedAt: new Date().toISOString(),
                            });

                            console.error("agent-runner llm:step-failure", {
                                taskId,
                                stepId: step.stepId,
                                message,
                                retryOutcome: retryResult.outcome,
                            });

                            await this.appendCheckpoint(latestTask, { step: "failed", status: "completed" });
                            return {
                                completed: false,
                                retryCount: typeof latestTask.retryCount === "number" ? latestTask.retryCount : 0,
                                maxRetries: latestTask.maxRetries ?? 2,
                                result: null,
                                verification: null,
                            };
                        }

                        throw err;
                    }

                    if (decision.needsClarification) {
                        const clarificationQuestion = decision.clarificationQuestion ?? "Please provide more details.";
                        await this.shadow.persistShadowExecutionState(latestTask, {
                            type: "CLARIFICATION_REQUIRED",
                            reason: decision.reasoning ?? "Clarification required.",
                            question: clarificationQuestion,
                        });
                        await this.updatePlanStepState(taskId, step.stepId, {
                            state: "blocked",
                            lastError: clarificationQuestion,
                            output: {
                                summary: "Clarification required",
                                data: { clarificationQuestion },
                            },
                        });

                        await this.clarification.pauseForClarification(latestTask, clarificationQuestion, step.stepId);
                        return {
                            completed: false,
                            retryCount: typeof latestTask.retryCount === "number" ? latestTask.retryCount : 0,
                            maxRetries: typeof latestTask.maxRetries === "number" ? latestTask.maxRetries : 2,
                            result: lastResult,
                            verification: lastVerification,
                        };
                    }

                    if (!decision.toolName || decision.toolName === "none") {
                        await this.updatePlanStepState(taskId, step.stepId, {
                            state: "failed",
                            lastError: "LLM returned no executable tool.",
                        });
                        await this.transitionLifecycle(latestTask, "failed");
                        break;
                    }

                    const selectedTool = this.ctx.toolRegistry.get(decision.toolName);
                    if (!selectedTool) {
                        throw new Error(`No tool registered for name ${decision.toolName}`);
                    }

                    const resolvedInput = resolveStepTemplates(step.input ?? {}, previousStepOutputs);
                    const resolvedDecisionInput = resolveStepTemplates(decision.toolInput, previousStepOutputs);
                    const mergedInput = {
                        ...(resolvedInput && typeof resolvedInput === "object" ? resolvedInput as Record<string, unknown> : {}),
                        ...(resolvedDecisionInput && typeof resolvedDecisionInput === "object" ? resolvedDecisionInput as Record<string, unknown> : {}),
                    };
                    const normalizedInput = normalizeParams(decision.toolName, mergedInput);
                    const validationError = validateToolParameters(selectedTool, normalizedInput);
                    if (validationError) {
                        await this.updatePlanStepState(taskId, step.stepId, {
                            state: (step.attempts ?? 0) + 1 < (step.maxAttempts ?? 3) ? "retry_scheduled" : "failed",
                            lastError: validationError,
                        });

                        if ((step.attempts ?? 0) + 1 < (step.maxAttempts ?? 3)) {
                            await scheduleTaskRetry(latestTask, new Error(validationError), {
                                runId: this.ctx.currentRunId,
                                actionType: this.ctx.mapToolNameToActionType(decision.toolName),
                                emit: async (payload) => {
                                    await this.ctx.onExecutionUpdate?.(payload);
                                },
                            });
                            return {
                                completed: false,
                                retryCount: typeof latestTask.retryCount === "number" ? latestTask.retryCount : 0,
                                maxRetries: typeof latestTask.maxRetries === "number" ? latestTask.maxRetries : 2,
                                result: null,
                                verification: null,
                            };
                        }

                        await this.transitionLifecycle(latestTask, "failed");
                        break;
                    }

                    const selectedToolName = decision.toolName ?? "none";
                    let activeDecision = decision;
                    let activeToolName = selectedToolName;
                    let activeNormalizedInput = normalizedInput;

                    const attemptNumber = (step.attempts ?? 0) + 1;
                    const idempotencyKey = mongoose.connection.readyState === 1
                        ? this.toolExecutor.buildToolIdempotencyKey({
                            taskId,
                            stepId: step.stepId,
                            toolName: activeToolName,
                            params: activeNormalizedInput,
                        })
                        : null;

                    let executionPayload: ExecutionActionRecord = {
                        taskId,
                        conversationId: latestTask.conversationId.toString(),
                        toolName: activeToolName,
                        parameters: activeNormalizedInput,
                        messageId: null,
                        executionState: "running",
                        stepId: step.stepId,
                        attempt: attemptNumber,
                        idempotencyKey,
                    };

                    await this.shadow.persistShadowExecutionState(latestTask, {
                        type: "TOOL_STARTED",
                        stepId: step.stepId,
                        toolName: activeToolName,
                        attempt: attemptNumber,
                        idempotencyKey: idempotencyKey ?? "persistence_unavailable",
                    });

                    await this.updatePlanStepState(taskId, step.stepId, {
                        selectedToolName: activeToolName,
                        input: activeNormalizedInput,
                        lastError: null,
                    });

                    const sideEffectCancellation = await this.resolveCancellationBeforeSideEffect(
                        taskId,
                        runAbortController,
                        runId,
                    );
                    if (sideEffectCancellation) {
                        return sideEffectCancellation;
                    }

                    const executed = await this.toolExecutor.execute(executionPayload, {
                        userId: this.getTaskUserId(latestTask),
                        organizationId: latestTask.organizationId?.toString?.() ?? null,
                        clarificationReply,
                        pendingResolution: this.clarification.getPendingResolution(latestTask),
                    });

                    const clarification = this.clarification.getClarificationPayload(executed);
                    if (clarification) {
                        await this.shadow.persistShadowExecutionState(latestTask, {
                            type: "CLARIFICATION_REQUIRED",
                            reason: "Tool execution requires clarification.",
                            question: clarification.question,
                            pendingResolution: clarification.pendingResolution ?? undefined,
                        });
                        await this.updatePlanStepState(taskId, step.stepId, {
                            state: "blocked",
                            lastError: clarification.question,
                            output: {
                                summary: "Clarification required",
                                data: {
                                    clarificationQuestion: clarification.question,
                                    pendingResolution: clarification.pendingResolution,
                                },
                            },
                        });

                        await this.clarification.pauseForClarification(latestTask, clarification.question, step.stepId, clarification.pendingResolution);
                        return {
                            completed: false,
                            retryCount: typeof latestTask.retryCount === "number" ? latestTask.retryCount : 0,
                            maxRetries: typeof latestTask.maxRetries === "number" ? latestTask.maxRetries : 2,
                            result: executed,
                            verification: null,
                        };
                    }

                    if ((!executed.adapterSuccess || executed.error) && (step.attempts ?? 0) < (step.maxAttempts ?? 3)) {
                        try {
                            const correctedDecision = await this.decideStepAction({
                                task: latestTask,
                                step,
                                rankedTools,
                                shortTermMemory: memory.shortTerm as Array<Record<string, unknown>>,
                                longTermMemory: memory.longTerm as Array<Record<string, unknown>>,
                                previousStepOutputs,
                                clarificationReply,
                                previousError: executed.error ?? "Execution failed",
                                previousParameters: activeNormalizedInput,
                                iteration: iteration + 1,
                            });

                            if (correctedDecision.needsClarification) {
                                const clarificationQuestion = correctedDecision.clarificationQuestion ?? "Please provide more details.";
                                await this.updatePlanStepState(taskId, step.stepId, {
                                    state: "blocked",
                                    lastError: clarificationQuestion,
                                    output: {
                                        summary: "Clarification required",
                                        data: { clarificationQuestion },
                                    },
                                });

                                await this.clarification.pauseForClarification(latestTask, clarificationQuestion, step.stepId);
                                return {
                                    completed: false,
                                    retryCount: typeof latestTask.retryCount === "number" ? latestTask.retryCount : 0,
                                    maxRetries: typeof latestTask.maxRetries === "number" ? latestTask.maxRetries : 2,
                                    result: lastResult,
                                    verification: lastVerification,
                                };
                            }

                            if (correctedDecision.toolName && correctedDecision.toolName !== "none") {
                                const correctedTool = this.ctx.toolRegistry.get(correctedDecision.toolName);
                                if (correctedTool) {
                                    const correctedResolvedInput = resolveStepTemplates(step.input ?? {}, previousStepOutputs);
                                    const correctedResolvedDecisionInput = resolveStepTemplates(correctedDecision.toolInput, previousStepOutputs);
                                    const correctedMergedInput = {
                                        ...(correctedResolvedInput && typeof correctedResolvedInput === "object" ? correctedResolvedInput as Record<string, unknown> : {}),
                                        ...(correctedResolvedDecisionInput && typeof correctedResolvedDecisionInput === "object" ? correctedResolvedDecisionInput as Record<string, unknown> : {}),
                                    };
                                    const correctedNormalizedInput = normalizeParams(correctedDecision.toolName, correctedMergedInput);
                                    const correctedValidationError = validateToolParameters(correctedTool, correctedNormalizedInput);

                                    if (!correctedValidationError) {
                                        // attempts already incremented when the step entered `running`
                                        if ((step.attempts ?? 0) >= (step.maxAttempts ?? 3)) {
                                            // No remaining attempt budget for a corrected re-run.
                                        } else {
                                            activeDecision = correctedDecision;
                                            activeToolName = correctedDecision.toolName;
                                            activeNormalizedInput = correctedNormalizedInput;

                                            await this.updatePlanStepState(taskId, step.stepId, {
                                                state: "retry_scheduled",
                                                selectedToolName: activeToolName,
                                                input: activeNormalizedInput,
                                                attempts: step.attempts ?? 0,
                                                lastError: executed.error ?? "Execution failed",
                                            });

                                            console.log("agent-runner llm:self-heal-scheduled", {
                                                taskId,
                                                stepId: step.stepId,
                                                toolName: activeToolName,
                                                attempts: step.attempts ?? 0,
                                                maxAttempts: step.maxAttempts ?? 3,
                                            });
                                            continue;
                                        }
                                    }
                                }
                            }
                        } catch (retryErr) {
                            console.error("agent-runner llm:self-heal-failed", {
                                taskId,
                                stepId: step.stepId,
                                message: retryErr instanceof Error ? retryErr.message : String(retryErr),
                            });
                        }
                    }

                    await this.shadow.persistShadowExecutionState(latestTask, { type: "TOOL_OBSERVED" });
                    lastResult = await this.toolExecutor.observe({
                        task: latestTask,
                        action: executionPayload,
                        retryCount: typeof latestTask.retryCount === "number" ? latestTask.retryCount : 0,
                        maxRetries: typeof latestTask.maxRetries === "number" ? latestTask.maxRetries : 2,
                        attemptPayload: executionPayload,
                        observed: executed,
                        verification: null,
                    }, executed);

                    await this.shadow.persistShadowExecutionState(latestTask, { type: "TOOL_VERIFIED" });
                    lastVerification = await this.toolExecutor.verify(lastResult, {
                        task: latestTask,
                        action: executionPayload,
                        retryCount: typeof latestTask.retryCount === "number" ? latestTask.retryCount : 0,
                        maxRetries: typeof latestTask.maxRetries === "number" ? latestTask.maxRetries : 2,
                        attemptPayload: executionPayload,
                        observed: lastResult,
                        verification: null,
                    });

                    if (lastVerification.success) {
                        await this.shadow.persistShadowExecutionState(latestTask, { type: "STEP_COMPLETED" });
                        await this.updatePlanStepState(taskId, step.stepId, {
                            state: "completed",
                            completedAt: new Date(),
                            selectedToolName: activeDecision.toolName,
                            output: {
                                summary: lastResult.summary,
                                data: lastResult.evidence,
                                confidence: lastVerification.confidence,
                            },
                        });

                        if (plan.steps.every((entry) => entry.stepId === step.stepId || entry.state === "completed")) {
                            await this.shadow.persistShadowExecutionState(latestTask, {
                                type: "GOAL_ACHIEVED",
                                finishedAt: new Date().toISOString(),
                                runId: this.ctx.getCurrentRunId(),
                                result: {
                                    confidence: lastVerification.confidence,
                                    summary: lastResult.summary,
                                    evidence: lastResult.evidence,
                                },
                            });
                            await this.transitionLifecycle(latestTask, "completed");
                            await this.ctx.updateTask(latestTask, {
                                status: "completed",
                                progress: 100,
                                result: {
                                    success: true,
                                    confidence: lastVerification.confidence,
                                    evidence: {
                                        previousStepOutputs,
                                        finalStepId: step.stepId,
                                        execution: lastResult.evidence,
                                    },
                                },
                            });
                            break;
                        }

                        continue;
                    }

                    const attempted = (step.attempts ?? 0) + 1;

                    if (attempted < (step.maxAttempts ?? 3)) {
                        await this.shadow.persistShadowExecutionState(latestTask, {
                            type: "ERROR_OCCURRED",
                            reason: lastResult.error ?? "Execution failed",
                            retryable: true,
                            category: "verification_failed",
                            retryCount: attempted,
                            maxRetries: step.maxAttempts ?? 3,
                            nextRetryAt: new Date(Date.now() + 1000).toISOString(),
                            finishedAt: new Date().toISOString(),
                        });
                        await this.updatePlanStepState(taskId, step.stepId, {
                            state: "retry_scheduled",
                            selectedToolName: activeToolName,
                            lastError: lastResult.error ?? "Execution failed",
                        });

                        await scheduleTaskRetry(latestTask, new Error(lastResult.error ?? "Execution failed"), {
                            runId: this.ctx.currentRunId,
                            actionType: this.ctx.mapToolNameToActionType(activeToolName),
                            emit: async (payload) => {
                                await this.ctx.onExecutionUpdate?.(payload);
                            },
                        });
                        return {
                            completed: false,
                            retryCount: typeof latestTask.retryCount === "number" ? latestTask.retryCount : 0,
                            maxRetries: typeof latestTask.maxRetries === "number" ? latestTask.maxRetries : 2,
                            result: lastResult,
                            verification: lastVerification,
                        };
                    }

                    await this.updatePlanStepState(taskId, step.stepId, {
                        state: "failed",
                        selectedToolName: activeToolName,
                        lastError: lastResult.error ?? "Verification failed",
                        output: {
                            summary: lastResult.summary,
                            data: lastResult.evidence,
                            confidence: lastVerification.confidence,
                        },
                    });

                    await this.shadow.persistShadowExecutionState(latestTask, {
                        type: "ERROR_OCCURRED",
                        reason: lastResult.error ?? "Verification failed",
                        retryable: false,
                        category: "verification_failed",
                        retryCount: attempted,
                        maxRetries: step.maxAttempts ?? 3,
                        finishedAt: new Date().toISOString(),
                    });
                    await this.transitionLifecycle(latestTask, "failed");
                    await this.appendCheckpoint(latestTask, {
                        step: "adjust",
                        status: "failed",
                    });
                    break;
                } catch (error) {
                    const reason = error instanceof Error ? error.message : String(error);
                    if (/abort/i.test(reason)) {
                        const cancellationOutcome = await this.resolveCancellationBeforeSideEffect(
                            taskId,
                            runAbortController,
                            runId,
                        );
                        if (cancellationOutcome) {
                            return cancellationOutcome;
                        }
                    }

                    throw error;
                } finally {
                    clearTimeout(iterationTimeoutHandle);
                    this.ctx.currentExecutionSignal = runAbortController.signal;
                }
            }

            const provisionalTask = await this.ctx.taskModel.findById(taskId);
            if (!provisionalTask) {
                throw new Error(`Task disappeared before finalization: ${taskId}`);
            }

            const isTerminal =
                ["completed", "failed", "paused", "blocked", "waiting_for_approval", "retry_scheduled"].includes(String(provisionalTask.lifecycleState ?? ""))
                || ["completed", "failed", "waiting_for_input"].includes(String(provisionalTask.status ?? ""));

            if (iteration >= maxIterations && !isTerminal) {
                if (provisionalTask.currentStepId) {
                    await this.updatePlanStepState(taskId, provisionalTask.currentStepId, {
                        state: "failed",
                        lastError: "Persistent iteration budget exhausted.",
                    });
                }

                const retryResult = await scheduleTaskRetry(provisionalTask, new Error("Persistent iteration budget exhausted."), {
                    runId: this.ctx.currentRunId,
                    actionType: this.ctx.mapToolNameToActionType(
                        lastResult && typeof (lastResult.evidence as Record<string, unknown>)?.toolName === "string"
                            ? (lastResult.evidence as Record<string, unknown>).toolName as string
                            : null
                    ),
                    emit: async (payload) => {
                        await this.ctx.onExecutionUpdate?.(payload);
                    },
                });

                if (retryResult.outcome !== "scheduled") {
                    await this.shadow.persistShadowExecutionState(provisionalTask, {
                        type: "ERROR_OCCURRED",
                        reason: "Persistent iteration budget exhausted.",
                        retryable: false,
                        category: "max_iterations",
                        retryCount: retryResult.retryCount,
                        maxRetries: typeof provisionalTask.maxRetries === "number" ? provisionalTask.maxRetries : 2,
                        finishedAt: new Date().toISOString(),
                    });
                    await this.transitionLifecycle(provisionalTask, "failed");
                    await this.ctx.updateTask(provisionalTask, {
                        status: "failed",
                        progress: 100,
                        result: {
                            success: false,
                            confidence: lastVerification?.confidence ?? 0,
                            evidence: lastResult?.evidence ?? null,
                            error: "Persistent iteration budget exhausted.",
                        },
                    });
                }
            }

            const finalTask = await this.ctx.taskModel.findById(taskId);
            if (!finalTask) {
                throw new Error(`Task disappeared before finalization: ${taskId}`);
            }

            const outcome = (finalTask.lifecycleState ?? "ready") === "completed";
            await this.ctx.generateAndStoreReflectionFn({
                taskId,
                conversationId: finalTask.conversationId.toString(),
                runId: null,
                title: finalTask.title,
                outcome: outcome ? "completed" : (finalTask.lifecycleState === "failed" ? "failed" : "partial"),
                executionSummary: lastResult?.summary ?? (outcome ? "Task completed." : "Task failed."),
                toolName: lastResult && typeof (lastResult.evidence as Record<string, unknown>)?.toolName === "string"
                    ? (lastResult.evidence as Record<string, unknown>).toolName as string
                    : null,
            });

            return {
                completed: outcome,
                retryCount: typeof finalTask.retryCount === "number" ? finalTask.retryCount : 0,
                maxRetries: typeof finalTask.maxRetries === "number" ? finalTask.maxRetries : 2,
                result: lastResult,
                verification: lastVerification,
            };
        } finally {
            cancelWatcher.stop();
            watchdog.stop();
            this.ctx.currentExecutionSignal = null;
            if (!leaseHeld) {
                await this.ctx.releaseTaskLeaseFn(taskId, this.ctx.workerId);
            }
        }
    }

    private startLeaseWatchdog(taskId: string, runAbortController: AbortController, runId: string, intervalMs: number) {
        let stopped = false;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const schedule = () => {
            if (stopped || runAbortController.signal.aborted) {
                return;
            }

            timer = setTimeout(async () => {
                if (stopped || runAbortController.signal.aborted) {
                    return;
                }

                try {
                    const lease = await this.ctx.heartbeatTaskLeaseFn(taskId, this.ctx.workerId);
                    if (!lease) {
                        console.warn("agent-runner lease:lost", { runId, taskId, workerId: this.ctx.workerId });
                        runAbortController.abort();
                        return;
                    }
                } catch (error) {
                    console.warn("agent-runner lease:lost", {
                        runId,
                        taskId,
                        workerId: this.ctx.workerId,
                        error: error instanceof Error ? error.message : String(error),
                    });
                    runAbortController.abort();
                    return;
                }

                schedule();
            }, intervalMs);
        };

        schedule();

        return {
            stop: () => {
                stopped = true;
                if (timer) {
                    clearTimeout(timer);
                }
            },
        };
    }
}
