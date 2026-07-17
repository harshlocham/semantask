import assert from "node:assert/strict";
import test from "node:test";
import { intersectPresenceAudience } from "../server/socket/services/presence-peers.js";

test("intersectPresenceAudience keeps only active mutual peers", () => {
    const peers = ["a", "b", "c", "self"];
    const active = ["a", "c", "self", "stranger"];

    assert.deepEqual(
        intersectPresenceAudience(peers, active, "self"),
        ["a", "c"]
    );
});

test("intersectPresenceAudience excludes self even when listed in both", () => {
    assert.deepEqual(
        intersectPresenceAudience(["self", "peer"], ["self", "peer"], "self"),
        ["peer"]
    );
});

test("intersectPresenceAudience returns empty when no overlap", () => {
    assert.deepEqual(
        intersectPresenceAudience(["a", "b"], ["c", "d"], "self"),
        []
    );
});
