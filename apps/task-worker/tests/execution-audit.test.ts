import assert from "node:assert/strict";
import { test } from "node:test";
import { hashExecutionParams } from "@semantask/services/execution-audit.service";

test("hashExecutionParams is stable regardless of key order", () => {
    const a = hashExecutionParams({ to: "a@example.com", subject: "Hi" });
    const b = hashExecutionParams({ subject: "Hi", to: "a@example.com" });
    assert.equal(a, b);
    assert.equal(a.length, 64);
});

test("hashExecutionParams changes when values change", () => {
    const a = hashExecutionParams({ to: "a@example.com" });
    const b = hashExecutionParams({ to: "b@example.com" });
    assert.notEqual(a, b);
});
