import { describe, expect, it } from "@jest/globals";
import {
    extractAssigneeUserIds,
    extractEntitiesFromContent,
    parseDueAtCandidate,
} from "../message-intent.helpers";

const NOW = new Date("2026-08-08T15:00:00.000Z"); // Saturday

describe("message-intent heuristics", () => {
    describe("parseDueAtCandidate", () => {
        it("parses tomorrow relative to now", () => {
            const due = parseDueAtCandidate("remind me tomorrow", NOW);
            expect(due?.toISOString()).toBe("2026-08-09T00:00:00.000Z");
        });

        it("parses today", () => {
            const due = parseDueAtCandidate("finish this today", NOW);
            expect(due?.toISOString()).toBe("2026-08-08T00:00:00.000Z");
        });

        it("parses in N days", () => {
            const due = parseDueAtCandidate("follow up in 3 days", NOW);
            expect(due?.toISOString()).toBe("2026-08-11T00:00:00.000Z");
        });

        it("parses weekday names", () => {
            const due = parseDueAtCandidate("please call John on Friday", NOW);
            expect(due?.toISOString()).toBe("2026-08-14T00:00:00.000Z");
        });

        it("parses ISO dates", () => {
            const due = parseDueAtCandidate("due 2026-09-01 for launch", NOW);
            expect(due?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
        });

        it("returns null when no due phrase", () => {
            expect(parseDueAtCandidate("send a welcome email", NOW)).toBeNull();
        });
    });

    describe("extractAssigneeUserIds", () => {
        const participants = [
            { userId: "u1", username: "alice", email: "alice@example.com" },
            { userId: "u2", username: "bob", email: "bob@example.com" },
        ];

        it("matches @username mentions", () => {
            expect(extractAssigneeUserIds("please ask @alice to review", participants))
                .toEqual(["u1"]);
        });

        it("matches email tokens", () => {
            expect(extractAssigneeUserIds("cc bob@example.com on this", participants))
                .toEqual(["u2"]);
        });

        it("returns empty without participants", () => {
            expect(extractAssigneeUserIds("@alice please help", [])).toEqual([]);
        });
    });

    describe("extractEntitiesFromContent", () => {
        it("fills assignee and due together", () => {
            const entities = extractEntitiesFromContent(
                "please send the deck to @alice tomorrow",
                {
                    participants: [{ userId: "u1", username: "alice", email: "alice@example.com" }],
                    now: NOW,
                }
            );
            expect(entities.actionVerb).toBe("send");
            expect(entities.assigneeUserIds).toEqual(["u1"]);
            expect(entities.dueAtCandidate?.toISOString()).toBe("2026-08-09T00:00:00.000Z");
        });
    });
});
