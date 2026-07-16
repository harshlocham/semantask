import assert from "node:assert/strict";
import test from "node:test";
import type { MessageSemanticType } from "@semantask/types";
import { WorkflowRegistry } from "../services/workflow/workflow-registry.js";
import type { WorkflowTemplate } from "../services/workflow/workflow-template.js";
import type { RunTaskContext, RunTaskOutcome } from "../services/agent/types.js";

function makeOutcome(completed: boolean): RunTaskOutcome {
    return {
        completed,
        retryCount: 0,
        maxRetries: 2,
        result: null,
        verification: null,
    };
}

function makeTemplate(
    id: string,
    supports: (semanticType?: MessageSemanticType | null) => boolean,
    calls: string[]
): WorkflowTemplate {
    return {
        id,
        supports,
        async run(_taskId: string, _ctx?: RunTaskContext) {
            calls.push(id);
            return makeOutcome(true);
        },
    };
}

test("workflow-registry: falls back to default template when nothing matches", async () => {
    const calls: string[] = [];
    const defaultTemplate = makeTemplate("default", () => true, calls);
    const registry = new WorkflowRegistry(defaultTemplate);

    const resolved = registry.resolve("task_request" as MessageSemanticType);
    assert.equal(resolved.id, "default");

    await resolved.run("task-1");
    assert.deepEqual(calls, ["default"]);
});

test("workflow-registry: falls back to default when semanticType is undefined", () => {
    const calls: string[] = [];
    const defaultTemplate = makeTemplate("default", () => true, calls);
    const registry = new WorkflowRegistry(defaultTemplate);

    assert.equal(registry.resolve().id, "default");
    assert.equal(registry.resolve(null).id, "default");
});

test("workflow-registry: prefers the first registered template that supports the type", () => {
    const calls: string[] = [];
    const defaultTemplate = makeTemplate("default", () => true, calls);
    const specialized = makeTemplate(
        "specialized",
        (semanticType) => semanticType === ("task_request" as MessageSemanticType),
        calls
    );
    const registry = new WorkflowRegistry(defaultTemplate).register(specialized);

    assert.equal(registry.resolve("task_request" as MessageSemanticType).id, "specialized");
    // A type the specialized template does not claim falls through to the default.
    assert.equal(registry.resolve("chit_chat" as MessageSemanticType).id, "default");
});
