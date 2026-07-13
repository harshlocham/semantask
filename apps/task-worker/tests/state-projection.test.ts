import "./test-env.js";
import assert from "node:assert/strict";
import test from "node:test";
import type { ExecutionState } from "@semantask/types";
import {
    applyLifecycleProjection,
    getTaskStateProjectionMode,
    type ProjectableTask,
} from "../services/state-projection.js";

const reasoning: ExecutionState = {
    kind: "reasoning",
    iteration: 1,
    runId: "run-1",
    workerId: "worker-1",
    leaseExpiresAt: "2026-07-01T00:05:00.000Z",
};

const succeeded: ExecutionState = {
    kind: "succeeded",
    finishedAt: "2026-07-01T00:00:00.000Z",
    runId: "run-1",
    result: { confidence: 1, summary: "done", evidence: null },
};

function withMode(mode: string | undefined, fn: () => void): void {
    const previous = process.env.TASK_STATE_PROJECTION_MODE;
    if (mode === undefined) {
        delete process.env.TASK_STATE_PROJECTION_MODE;
    } else {
        process.env.TASK_STATE_PROJECTION_MODE = mode;
    }
    try {
        fn();
    } finally {
        if (previous === undefined) {
            delete process.env.TASK_STATE_PROJECTION_MODE;
        } else {
            process.env.TASK_STATE_PROJECTION_MODE = previous;
        }
    }
}

function makeTask(overrides?: Partial<ProjectableTask>): ProjectableTask {
    return {
        _id: { toString: () => "task-1" },
        lifecycleState: "ready",
        status: "pending",
        executionState: reasoning,
        ...overrides,
    };
}

test("getTaskStateProjectionMode defaults to off", () => {
    withMode(undefined, () => {
        assert.equal(getTaskStateProjectionMode(), "off");
    });
    withMode("SHADOW", () => {
        assert.equal(getTaskStateProjectionMode(), "shadow");
    });
    withMode("enforce", () => {
        assert.equal(getTaskStateProjectionMode(), "enforce");
    });
});

test("applyLifecycleProjection off mode is a no-op", () => {
    withMode("off", () => {
        const task = makeTask();
        applyLifecycleProjection(task, "test");
        assert.equal(task.lifecycleState, "ready");
        assert.equal(task.status, "pending");
    });
});

test("applyLifecycleProjection shadow mode does not overwrite fields", () => {
    withMode("shadow", () => {
        const task = makeTask();
        applyLifecycleProjection(task, "test");
        assert.equal(task.lifecycleState, "ready");
        assert.equal(task.status, "pending");
    });
});

test("applyLifecycleProjection enforce mode writes projected lifecycle and status", () => {
    withMode("enforce", () => {
        const task = makeTask();
        applyLifecycleProjection(task, "test");
        assert.equal(task.lifecycleState, "executing");
        assert.equal(task.status, "executing");
    });
});

test("applyLifecycleProjection enforce projects succeeded to completed", () => {
    withMode("enforce", () => {
        const task = makeTask({
            lifecycleState: "executing",
            status: "executing",
            executionState: succeeded,
        });
        applyLifecycleProjection(task, "test");
        assert.equal(task.lifecycleState, "completed");
        assert.equal(task.status, "completed");
    });
});

test("applyLifecycleProjection treatOffAs enforce preserves policy-shadow alignment", () => {
    withMode("off", () => {
        const task = makeTask();
        applyLifecycleProjection(task, "policy_shadow", { treatOffAs: "enforce" });
        assert.equal(task.lifecycleState, "executing");
        assert.equal(task.status, "executing");
    });
});

test("applyLifecycleProjection skips invalid executionState", () => {
    withMode("enforce", () => {
        const task = makeTask({ executionState: { kind: "not_a_state" } });
        applyLifecycleProjection(task, "test");
        assert.equal(task.lifecycleState, "ready");
        assert.equal(task.status, "pending");
    });
});
