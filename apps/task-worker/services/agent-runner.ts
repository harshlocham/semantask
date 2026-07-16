import { AgentContext, resolveGetLatestExecutionTaskAction, type AgentContextOptions } from "./agent/context.js";
import { ClarificationHandler } from "./agent/clarification-handler.js";
import { ShadowFsmWriter } from "./agent/shadow-fsm-writer.js";
import { ToolExecutor } from "./agent/tool-executor.js";
import { StepLoop } from "./agent/step-loop.js";
import type { RunTaskContext, RunTaskOutcome } from "./agent/types.js";

export type { RunTaskContext } from "./agent/types.js";

export const __testInternals = {
    resolveGetLatestExecutionTaskAction,
};

/**
 * Facade over the split agent execution collaborators. Holds the shared
 * {@link AgentContext} and composes {@link ToolExecutor}, {@link ShadowFsmWriter},
 * {@link ClarificationHandler}, and {@link StepLoop}. The public surface
 * (constructor options, `runTask`, `resumeTask`) is unchanged from the
 * pre-split monolith.
 */
export class AgentRunner {
    private readonly ctx: AgentContext;
    private readonly clarification: ClarificationHandler;
    private readonly stepLoop: StepLoop;

    constructor(options?: AgentContextOptions) {
        this.ctx = new AgentContext(options);
        const toolExecutor = new ToolExecutor(this.ctx);
        const shadow = new ShadowFsmWriter(this.ctx);
        this.clarification = new ClarificationHandler(this.ctx);
        this.stepLoop = new StepLoop(this.ctx, toolExecutor, shadow, this.clarification);
    }

    async runTask(taskId: string, ctx?: RunTaskContext): Promise<RunTaskOutcome> {
        return this.stepLoop.runTask(taskId, ctx);
    }

    async resumeTask(taskId: string, userReply: string): Promise<RunTaskOutcome> {
        const task = await this.ctx.taskModel.findById(taskId);
        if (!task) {
            throw new Error(`Task not found: ${taskId}`);
        }

        await this.clarification.resume(task, userReply);

        return this.stepLoop.runTask(taskId);
    }
}

export default AgentRunner;
