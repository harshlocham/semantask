import type { PendingResolution } from "../entity-resolution.service.js";
import type { AgentContext } from "./context.js";
import type { ActionExecutionResult, TaskDocumentLike } from "./types.js";

/**
 * Owns the clarification lifecycle: pausing a task while awaiting user input,
 * reading any pending resolution off a task, extracting a clarification request
 * from a tool result, and resuming a paused task with the user's reply.
 */
export class ClarificationHandler {
    constructor(private readonly ctx: AgentContext) {}

    async pauseForClarification(task: TaskDocumentLike, clarificationQuestion: string, stepId?: string, clarificationContext?: unknown) {
        await this.ctx.updateTask(task, {
            status: "waiting_for_input",
            lifecycleState: "paused",
            pausedReason: clarificationQuestion,
            blockedReason: stepId ? `Awaiting clarification for ${stepId}` : "Awaiting clarification",
            result: {
                success: false,
                confidence: 0,
                evidence: {
                    needsClarification: true,
                    clarificationQuestion,
                    stepId: stepId ?? null,
                    pendingResolution: clarificationContext ?? null,
                },
                error: clarificationQuestion,
            },
        });
    }

    getPendingResolution(task: TaskDocumentLike): PendingResolution | null {
        const evidence = task.result?.evidence;
        if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
            return null;
        }

        const pending = (evidence as Record<string, unknown>).pendingResolution;
        if (!pending || typeof pending !== "object" || Array.isArray(pending)) {
            return null;
        }

        const candidate = pending as Partial<PendingResolution>;
        if (candidate.toolName !== "send_email") {
            return null;
        }

        if (!candidate.parametersSnapshot || typeof candidate.parametersSnapshot !== "object" || Array.isArray(candidate.parametersSnapshot)) {
            return null;
        }

        if (!Array.isArray(candidate.ambiguities) || candidate.ambiguities.length === 0) {
            return null;
        }

        return candidate as PendingResolution;
    }

    getClarificationPayload(result: ActionExecutionResult): { question: string; pendingResolution: PendingResolution | null } | null {
        if (!result.evidence || typeof result.evidence !== "object" || Array.isArray(result.evidence)) {
            return null;
        }

        const evidence = result.evidence as Record<string, unknown>;
        const needsClarification = evidence.needsClarification === true;
        if (!needsClarification) {
            return null;
        }

        const question = typeof evidence.clarificationQuestion === "string"
            ? evidence.clarificationQuestion
            : "Please clarify the recipient.";

        const pendingResolution = evidence.pendingResolution && typeof evidence.pendingResolution === "object" && !Array.isArray(evidence.pendingResolution)
            ? evidence.pendingResolution as PendingResolution
            : null;

        return {
            question,
            pendingResolution,
        };
    }

    /**
     * Marks a paused task ready to resume with the user's reply. Mirrors the
     * pre-split `resumeTask` persistence step; the caller re-runs the loop.
     */
    async resume(task: TaskDocumentLike, _userReply: string) {
        await this.ctx.updateTask(task, {
            status: "executing",
            lifecycleState: "ready",
            pausedReason: null,
            blockedReason: null,
        });
    }
}
