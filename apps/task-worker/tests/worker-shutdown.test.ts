import "./test-env.js";
import assert from "node:assert/strict";
import test from "node:test";
import { createWorkerShutdown } from "../services/worker-shutdown.js";

type Event = { id: string };

function setup(input: { graceMs?: number; failRelease?: Set<string>; notHeld?: Set<string> } = {}) {
    const released: Array<{ eventId: string; reason: string }> = [];
    const exits: number[] = [];
    const shutdown = createWorkerShutdown({
        workerId: "worker-1",
        graceMs: input.graceMs ?? 60_000,
        release: async (eventId, reason) => {
            if (input.failRelease?.has(eventId)) throw new Error("mongo down");
            if (input.notHeld?.has(eventId)) return false;
            released.push({ eventId, reason });
            return true;
        },
        exit: (code) => {
            exits.push(code);
        },
    });
    const claim = (ids: string[]) => shutdown.claim(Promise.resolve(ids.map((id) => ({ id }))), (event: Event) => event.id);
    return { shutdown, released, exits, claim };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

test("is not requested until a signal arrives", () => {
    const { shutdown, exits } = setup();
    assert.equal(shutdown.isRequested(), false);
    assert.deepEqual(exits, []);
});

test("claim returns the claimed events unchanged", async () => {
    const { claim } = setup();
    assert.deepEqual(await claim(["a", "b"]), [{ id: "a" }, { id: "b" }]);
});

test("releases only the events that did not finish, then exits cleanly", async () => {
    const { shutdown, released, exits, claim } = setup();
    await claim(["a", "b", "c"]);
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
    const { shutdown, released, exits, claim } = setup({ graceMs: 10 });
    await claim(["running"]);
    shutdown.request("SIGTERM");

    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.deepEqual(released.map((entry) => entry.eventId), ["running"]);
    assert.deepEqual(exits, [0]);
});

test("does not wait for the grace period after finishing on time", async () => {
    const { shutdown, released, exits, claim } = setup({ graceMs: 10 });
    await claim(["a"]);
    shutdown.request("SIGTERM");
    shutdown.finished("a");
    await shutdown.finish();

    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.deepEqual(released, []);
    assert.deepEqual(exits, [0]);
});

test("a second signal stops waiting", async () => {
    const { shutdown, released, exits, claim } = setup();
    await claim(["running"]);
    shutdown.request("SIGTERM");
    assert.deepEqual(exits, []);

    shutdown.request("SIGTERM");
    await shutdown.finish();

    assert.deepEqual(released.map((entry) => entry.eventId), ["running"]);
    assert.deepEqual(exits, [0]);
});

test("a shutdown during a claim waits for it and hands back what it claimed", async () => {
    const { shutdown, released, exits } = setup();
    const pending = deferred<Event[]>();
    const claimed = shutdown.claim(pending.promise, (event) => event.id);

    shutdown.request("SIGTERM");
    shutdown.request("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(exits, [], "must not exit while the claim is still running");

    pending.resolve([{ id: "late-1" }, { id: "late-2" }]);
    await claimed;
    await shutdown.finish();

    assert.deepEqual(released.map((entry) => entry.eventId), ["late-1", "late-2"]);
    assert.deepEqual(exits, [0]);
});

test("a failed claim does not block the exit", async () => {
    const { shutdown, released, exits } = setup();
    const pending = deferred<Event[]>();
    const claimed = shutdown.claim(pending.promise, (event) => event.id).catch(() => null);

    shutdown.request("SIGTERM");
    void shutdown.finish();
    pending.reject(new Error("mongo down"));
    await claimed;
    await shutdown.finish();

    assert.deepEqual(released, []);
    assert.deepEqual(exits, [0]);
});

test("an event no longer held is skipped, and the rest are still released", async () => {
    const { shutdown, released, exits, claim } = setup({ notHeld: new Set(["completed"]) });
    await claim(["completed", "other"]);
    shutdown.request("SIGTERM");
    await shutdown.finish();

    assert.deepEqual(released.map((entry) => entry.eventId), ["other"]);
    assert.deepEqual(exits, [0]);
});

test("releases each event and exits once, however often finish is called", async () => {
    const { shutdown, released, exits, claim } = setup();
    await claim(["a"]);
    shutdown.request("SIGTERM");
    await Promise.all([shutdown.finish(), shutdown.finish()]);
    await shutdown.finish();

    assert.equal(released.length, 1);
    assert.deepEqual(exits, [0]);
});

test("still releases the others and exits when one release fails", async () => {
    const { shutdown, released, exits, claim } = setup({ failRelease: new Set(["bad"]) });
    await claim(["bad", "good"]);
    shutdown.request("SIGTERM");
    await shutdown.finish();

    assert.deepEqual(released.map((entry) => entry.eventId), ["good"]);
    assert.deepEqual(exits, [0]);
});
