import type { MessageSemanticType } from "@semantask/types";
import type AgentRunner from "../agent-runner.js";
import type { RunTaskContext, RunTaskOutcome } from "../agent/types.js";
import type { WorkflowTemplate } from "./workflow-template.js";

/**
 * Default workflow: delegates to the existing AgentRunner loop. This is the
 * fallback template used for every semantic type until specialized templates
 * are introduced.
 */
export class DefaultAgentLoopTemplate implements WorkflowTemplate {
    readonly id = "default-agent-loop";

    constructor(private readonly agentRunner: Pick<AgentRunner, "runTask">) {}

    supports(_semanticType?: MessageSemanticType | null): boolean {
        return true;
    }

    run(taskId: string, ctx?: RunTaskContext): Promise<RunTaskOutcome> {
        return this.agentRunner.runTask(taskId, ctx);
    }
}
