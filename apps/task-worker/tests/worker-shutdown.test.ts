import "./test-env.js";
import assert from "node:assert/strict";
import test from "node:test";
import { createWorkerShutdown } from "../services/worker-shutdown.js";

function setup(input: { graceMs?: number; failRelease?: Set<string> } = {}) {
    const released: Array<{ eventId: string; reason: string }> = [];
    const exits: number[] = [];
    const shutdown = createWorkerShutdown({
        workerId: "worker-1",
        graceMs: input.graceMs ?? 60_000,
        release: async (eventId, reason) => {
            if (input.failRelease?.has(eventId)) throw new Error("mongo down");
            released.push({ eventId, reason });
        },
        exit: (code) => {
            exits.push(code);
        },
    });
    return { shutdown, released, exits };
}

test("is not requested until a signal arrives", () => {
    const { shutdown, exits } = setup();
    assert.equal(shutdown.isRequested(), false);
    assert.deepEqual(exits, []);
});

test("releases only the events that did not finish, then exits cleanly", async () => {
    const { shutdown, released, exits } = setup();
    shutdown.track(["a", "b", "c"]);
    shutdown.finished("a");

    shutdown.request("SIGTERM");
    assert.equal(shutdown.isRequested(), true);
    await shutdown.finish();

    assert.deepEqual(released, [
        { eventId: "b", reason: "worker_shutdown" },
        { eventId: "c", reason: "worker_shutdown" },
    ]);
    assert.deepEqual(exits, [0]);
});

test("releases nothing when the worker is idle", async () => {
    const { shutdown, released, exits } = setup();
    shutdown.request("SIGTERM");
    await shutdown.finish();

    assert.deepEqual(released, []);
    assert.deepEqual(exits, [0]);
});

test("a handler that outlasts the grace period is released without finishing", async () => {
    const { shutdown, released, exits } = setup({ graceMs: 10 });
    shutdown.track(["running"]);
    shutdown.request("SIGTERM");

    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.deepEqual(released.map((entry) => entry.eventId), ["running"]);
    assert.deepEqual(exits, [0]);
});

test("does not wait for the grace period after finishing on time", async () => {
    const { shutdown, released, exits } = setup({ graceMs: 10 });
    shutdown.track(["a"]);
    shutdown.request("SIGTERM");
    shutdown.finished("a");
    await shutdown.finish();

    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.deepEqual(released, []);
    assert.deepEqual(exits, [0]);
});

test("a second signal stops waiting", async () => {
    const { shutdown, released, exits } = setup();
    shutdown.track(["running"]);
    shutdown.request("SIGTERM");
    assert.deepEqual(exits, []);

    shutdown.request("SIGTERM");
    await shutdown.finish();

    assert.deepEqual(released.map((entry) => entry.eventId), ["running"]);
    assert.deepEqual(exits, [0]);
});

test("releases each event and exits once, however often finish is called", async () => {
    const { shutdown, released, exits } = setup();
    shutdown.track(["a"]);
    shutdown.request("SIGTERM");
    await Promise.all([shutdown.finish(), shutdown.finish()]);
    await shutdown.finish();

    assert.equal(released.length, 1);
    assert.deepEqual(exits, [0]);
});

test("still releases the others and exits when one release fails", async () => {
    const { shutdown, released, exits } = setup({ failRelease: new Set(["bad"]) });
    shutdown.track(["bad", "good"]);
    shutdown.request("SIGTERM");
    await shutdown.finish();

    assert.deepEqual(released.map((entry) => entry.eventId), ["good"]);
    assert.deepEqual(exits, [0]);
});
