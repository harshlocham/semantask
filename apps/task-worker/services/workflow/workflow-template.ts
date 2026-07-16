import type { MessageSemanticType } from "@semantask/types";
import type { RunTaskContext, RunTaskOutcome } from "../agent/types.js";

/**
 * A WorkflowTemplate encapsulates a strategy for executing a task. The default
 * template wraps the autonomous/persistent AgentRunner loop; future templates
 * can specialize behavior per semantic intent while sharing the same contract.
 */
export interface WorkflowTemplate {
    /** Stable identifier for the template (used in logs / registry lookups). */
    readonly id: string;
    /** Whether this template can handle the given semantic type. */
    supports(semanticType?: MessageSemanticType | null): boolean;
    /** Execute the task, returning the same outcome shape as `AgentRunner.runTask`. */
    run(taskId: string, ctx?: RunTaskContext): Promise<RunTaskOutcome>;
}
