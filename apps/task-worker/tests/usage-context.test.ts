import assert from "node:assert/strict";
import { test } from "node:test";
import {
    getLLMUsageContext,
    runWithLLMUsageContext,
    setLLMUsageContext,
} from "../services/llm/usage-context.js";

test("getLLMUsageContext is null outside a store", () => {
    assert.equal(getLLMUsageContext(), null);
});

test("setLLMUsageContext is a no-op outside a store", () => {
    setLLMUsageContext({ taskId: "should-not-stick" });
    assert.equal(getLLMUsageContext(), null);
});

test("runWithLLMUsageContext isolates concurrent contexts", async () => {
    const order: string[] = [];

    await Promise.all([
        runWithLLMUsageContext({ taskId: "a", organizationId: "org-a" }, async () => {
            await new Promise((r) => setTimeout(r, 20));
            order.push(`a:${getLLMUsageContext()?.taskId}`);
            assert.equal(getLLMUsageContext()?.organizationId, "org-a");
        }),
        runWithLLMUsageContext({ taskId: "b", organizationId: "org-b" }, async () => {
            await new Promise((r) => setTimeout(r, 5));
            order.push(`b:${getLLMUsageContext()?.taskId}`);
            assert.equal(getLLMUsageContext()?.organizationId, "org-b");
        }),
    ]);

    assert.deepEqual(order.sort(), ["a:a", "b:b"].sort());
    assert.equal(getLLMUsageContext(), null);
});

test("setLLMUsageContext updates only the current store", async () => {
    await runWithLLMUsageContext({ taskId: "t1" }, async () => {
        assert.equal(getLLMUsageContext()?.taskId, "t1");
        setLLMUsageContext({ taskId: "t2", userId: "u1" });
        assert.equal(getLLMUsageContext()?.taskId, "t2");
        assert.equal(getLLMUsageContext()?.userId, "u1");
        setLLMUsageContext(null);
        assert.equal(getLLMUsageContext()?.taskId, null);
        assert.equal(getLLMUsageContext()?.userId, null);
    });
    assert.equal(getLLMUsageContext(), null);
});
