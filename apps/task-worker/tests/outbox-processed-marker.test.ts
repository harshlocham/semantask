import "./test-env.js";
import assert from "node:assert/strict";
import test from "node:test";
import {
    processedMarkerKey,
    processOutboxEventOnce,
    type ProcessedMarkerStore,
} from "../services/outbox-processed-marker.js";
import { ExecutionLeaseBusyError } from "../services/lease.service.js";

const DEDUPE_KEY = "message.created:507f1f77bcf86cd799439011";

/** A promise that never settles. The caller is frozen here, as if the process died. */
const processDied = () => new Promise<void>(() => {});

/** Lets a frozen run reach its await before the test inspects what it persisted. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function memoryStore(initial: Record<string, string> = {}) {
    const values = new Map(Object.entries(initial));
    const ttls = new Map<string, number>();
    const store: ProcessedMarkerStore = {
        get: async (key) => values.get(key) ?? null,
        set: async (key, value, _mode, seconds) => {
            values.set(key, value);
            ttls.set(key, seconds);
        },
    };
    return { store, values, ttls };
}

function run(
    store: ProcessedMarkerStore | null,
    handlers: { handle?: () => Promise<void>; complete?: () => Promise<void> } = {}
) {
    const calls = { handle: 0, complete: 0 };
    const result = processOutboxEventOnce({
        store,
        dedupeKey: DEDUPE_KEY,
        workerId: "worker-1",
        handle: async () => {
            calls.handle += 1;
            await handlers.handle?.();
        },
        complete: async () => {
            calls.complete += 1;
            await handlers.complete?.();
        },
    });
    return { calls, result };
}

test("crash mid-processing, then reclaim: the handler runs again and the event completes", async () => {
    const { store, values } = memoryStore();

    const crashed = run(store, { handle: processDied });
    await settle();

    assert.equal(crashed.calls.handle, 1);
    assert.equal(crashed.calls.complete, 0);
    assert.equal(values.size, 0, "a crash mid-handler must leave no marker");

    const reclaimed = run(store);
    await reclaimed.result;

    assert.equal(reclaimed.calls.handle, 1);
    assert.equal(reclaimed.calls.complete, 1);
    assert.equal(values.has(processedMarkerKey(DEDUPE_KEY)), true);
});

test("crash after the marker, then reclaim: the event completes without re-running the handler", async () => {
    const { store } = memoryStore();

    const crashed = run(store, { complete: processDied });
    await settle();

    assert.equal(crashed.calls.handle, 1);
    assert.equal(crashed.calls.complete, 1);

    const reclaimed = run(store);
    await reclaimed.result;

    assert.equal(reclaimed.calls.handle, 0);
    assert.equal(reclaimed.calls.complete, 1);
});

test("crash after the handler but before the marker, then reclaim: the handler runs twice", async () => {
    const { store, values } = memoryStore();
    const dyingStore: ProcessedMarkerStore = { get: store.get, set: processDied };

    const crashed = run(dyingStore);
    await settle();

    assert.equal(crashed.calls.handle, 1);
    assert.equal(values.size, 0);

    const reclaimed = run(store);
    await reclaimed.result;

    assert.equal(reclaimed.calls.handle, 1);
    assert.equal(reclaimed.calls.complete, 1);
});

test("a key from the old write-before-processing format does not skip the handler", async () => {
    const { store } = memoryStore({ [`task-worker:processed:${DEDUPE_KEY}`]: "dead-worker" });

    const { calls, result } = run(store);
    await result;

    assert.equal(calls.handle, 1);
    assert.equal(calls.complete, 1);
});

test("a handler error leaves no marker and does not complete, so the retry processes the event", async () => {
    const { store, values } = memoryStore();
    const failure = new Error("LLM classifier failed");

    const failed = run(store, { handle: () => Promise.reject(failure) });
    await assert.rejects(failed.result, failure);

    assert.equal(failed.calls.complete, 0);
    assert.equal(values.size, 0);

    const retried = run(store);
    await retried.result;

    assert.equal(retried.calls.handle, 1);
    assert.equal(retried.calls.complete, 1);
});

test("lease contention rethrows the same error type and leaves no marker, so the event defers", async () => {
    const { store, values } = memoryStore();

    const { calls, result } = run(store, {
        handle: () => Promise.reject(new ExecutionLeaseBusyError("task-1")),
    });

    await assert.rejects(result, ExecutionLeaseBusyError);
    assert.equal(calls.complete, 0);
    assert.equal(values.size, 0);
});

test("an event with a marker completes without running the handler", async () => {
    const { store } = memoryStore({ [processedMarkerKey(DEDUPE_KEY)]: "worker-2" });

    const { calls, result } = run(store);
    await result;

    assert.equal(calls.handle, 0);
    assert.equal(calls.complete, 1);
});

test("a marker write failure still completes the event", async () => {
    const { store } = memoryStore();
    const failingStore: ProcessedMarkerStore = {
        get: store.get,
        set: () => Promise.reject(new Error("redis down")),
    };

    const { calls, result } = run(failingStore);
    await result;

    assert.equal(calls.handle, 1);
    assert.equal(calls.complete, 1);
});

test("a marker read failure leaves the event for retry", async () => {
    const failure = new Error("redis down");
    const failingStore: ProcessedMarkerStore = {
        get: () => Promise.reject(failure),
        set: async () => undefined,
    };

    const { calls, result } = run(failingStore);

    await assert.rejects(result, failure);
    assert.equal(calls.handle, 0);
    assert.equal(calls.complete, 0);
});

test("without Redis the handler runs and the event completes", async () => {
    const { calls, result } = run(null);
    await result;

    assert.equal(calls.handle, 1);
    assert.equal(calls.complete, 1);
});

test("the marker expires after 7 days", async () => {
    const { store, ttls } = memoryStore();

    await run(store).result;

    assert.equal(ttls.get(processedMarkerKey(DEDUPE_KEY)), 7 * 24 * 60 * 60);
});
