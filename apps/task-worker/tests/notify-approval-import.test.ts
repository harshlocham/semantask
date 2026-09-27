import assert from "node:assert/strict";
import test from "node:test";

test("worker can resolve notifyApprovalRequired from services", async () => {
    const mod = await import("@semantask/services/notify-approval.service");
    assert.equal(typeof mod.notifyApprovalRequired, "function");
});
