import "./test-env.js";
import assert from "node:assert/strict";
import test from "node:test";
import TaskModel from "@semantask/db/models/Task";
import type { TaskExecutionUpdatedPayload } from "@semantask/types";
import {
    getStuckHeartbeatCutoffMs,
    getStuckRemediationMode,
    remediateStuckTask,
    STUCK_ERROR_MESSAGE,
    type StuckTaskSnapshot,
} from "../services/stuck-task-detector.js";
import { DEFAULT_LEASE_MS, getLeaseRenewalIntervalMs } from "../services/task-lease.js";

function createStuckTask(overrides?: Partial<StuckTaskSnapshot>): StuckTaskSnapshot {
    return {
        _id: { toString: () => "task-stuck-1" },
        conversationId: { toString: () => "conv-stuck-1" },
        executionRunId: "run-stuck-1",
        leaseOwner: "dead-worker",
        lastHeartbeatAt: new Date("2026-07-07T10:00:00.000Z"),
        retryCount: 0,
        maxRetries: 2,
        version: 3,
        status: "executing",
        lifecycleState: "executing",
        progress: 40,
        cancelRequestedAt: null,
        ...overrides,
    };
}

function restoreEnvVar(key: string, value: string | undefined) {
    if (value === undefined) {
        delete process.env[key];
        return;
    }

    process.env[key] = value;
}

test("getStuckRemediationMode defaults to log", () => {
    const previous = process.env.TASK_STUCK_REMEDIATION;
    delete process.env.TASK_STUCK_REMEDIATION;
    assert.equal(getStuckRemediationMode(), "log");
    restoreEnvVar("TASK_STUCK_REMEDIATION", previous);
});

test("getStuckRemediationMode accepts fail and retry", () => {
    const previous = process.env.TASK_STUCK_REMEDIATION;
    process.env.TASK_STUCK_REMEDIATION = "fail";
    assert.equal(getStuckRemediationMode(), "fail");
    process.env.TASK_STUCK_REMEDIATION = "retry";
    assert.equal(getStuckRemediationMode(), "retry");
    restoreEnvVar("TASK_STUCK_REMEDIATION", previous);
});

test("getStuckHeartbeatCutoffMs defaults to 2x lease renewal interval", () => {
    const previousHeartbeat = process.env.TASK_STUCK_HEARTBEAT_MS;
    delete process.env.TASK_STUCK_HEARTBEAT_MS;
    assert.equal(getStuckHeartbeatCutoffMs(), 2 * getLeaseRenewalIntervalMs(DEFAULT_LEASE_MS));
    restoreEnvVar("TASK_STUCK_HEARTBEAT_MS", previousHeartbeat);
});

test("remediateStuckTask log mode only emits detection", async () => {
    const task = createStuckTask();
    const cutoff = new Date("2026-07-07T10:05:00.000Z");
    const outcome = await remediateStuckTask(task, "worker-1", "log", cutoff);
    assert.equal(outcome, "logged");
});

test("remediateStuckTask skips tasks with cancellation requested", async () => {
    const task = createStuckTask({ cancelRequestedAt: new Date() });
    const cutoff = new Date("2026-07-07T10:05:00.000Z");
    const outcome = await remediateStuckTask(task, "worker-1", "fail", cutoff);
    assert.equal(outcome, "skipped");
});

test("remediateStuckTask fail mode updates task and emits hooks", async () => {
    const updates: Array<Record<string, unknown>> = [];
    const executionUpdates: TaskExecutionUpdatedPayload[] = [];

    const originalFindOneAndUpdate = TaskModel.findOneAndUpdate;
    (TaskModel as unknown as { findOneAndUpdate: typeof TaskModel.findOneAndUpdate }).findOneAndUpdate = ((
        filter: Record<string, unknown>,
        update: Record<string, unknown>,
    ) => ({
        exec: async () => {
            updates.push({ filter, update });
            return {
                _id: { toString: () => "task-stuck-1" },
                conversationId: { toString: () => "conv-stuck-1" },
                executionRunId: "run-stuck-1",
                version: 4,
                status: "failed",
                lifecycleState: "failed",
                progress: 100,
                result: (update.$set as Record<string, unknown>).result,
                cancelRequestedAt: null,
                cancelReason: null,
            };
        },
    })) as typeof TaskModel.findOneAndUpdate;

    try {
        const outcome = await remediateStuckTask(
            createStuckTask(),
            "worker-1",
            "fail",
            new Date("2026-07-07T10:05:00.000Z"),
            {
                onTaskUpdated: async () => undefined,
                onExecutionUpdate: async (payload) => {
                    executionUpdates.push(payload);
                },
            },
        );

        assert.equal(outcome, "failed");
        assert.equal(updates.length, 1);
        assert.equal((updates[0]?.update as { $set: { status: string } }).$set.status, "failed");
        assert.equal(executionUpdates.length, 1);
        assert.equal(executionUpdates[0]?.error, STUCK_ERROR_MESSAGE);
    } finally {
        (TaskModel as unknown as { findOneAndUpdate: typeof TaskModel.findOneAndUpdate }).findOneAndUpdate = originalFindOneAndUpdate;
    }
});
