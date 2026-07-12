import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { getToolRbacMode, isHighRiskToolName } from "@semantask/services/tool-grant.service";

afterEach(() => {
    delete process.env.TASK_TOOL_RBAC;
});

test("isHighRiskToolName recognizes the three autonomous tools", () => {
    assert.equal(isHighRiskToolName("send_email"), true);
    assert.equal(isHighRiskToolName("schedule_meeting"), true);
    assert.equal(isHighRiskToolName("create_github_issue"), true);
    assert.equal(isHighRiskToolName("none"), false);
});

test("getToolRbacMode defaults to off", () => {
    delete process.env.TASK_TOOL_RBAC;
    assert.equal(getToolRbacMode(), "off");
});

test("getToolRbacMode accepts enforce", () => {
    process.env.TASK_TOOL_RBAC = "enforce";
    assert.equal(getToolRbacMode(), "enforce");
});
