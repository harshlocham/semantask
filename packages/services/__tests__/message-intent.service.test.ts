import {
    extractEntitiesFromContent,
    mapSemanticTypeToIntentType,
} from "../message-intent.helpers";

describe("message-intent.service", () => {
    describe("mapSemanticTypeToIntentType", () => {
        test.each([
            ["task", "request"],
            ["incident", "request"],
            ["automation", "request"],
            ["escalation", "request"],
            ["scheduling", "reminder"],
            ["approval", "decision"],
            ["unknown", "info"],
        ] as const)("maps %s → %s", (semanticType, intentType) => {
            expect(mapSemanticTypeToIntentType(semanticType)).toBe(intentType);
        });

        test("maps chat to info by default", () => {
            expect(mapSemanticTypeToIntentType("chat", "hello there")).toBe("info");
        });

        test("maps chat ending with ? to question", () => {
            expect(mapSemanticTypeToIntentType("chat", "how are you?")).toBe("question");
        });
    });

    describe("extractEntitiesFromContent", () => {
        test("extracts action verb and object text", () => {
            const entities = extractEntitiesFromContent("please send a welcome email to the team");
            expect(entities.actionVerb).toBe("send");
            expect(entities.objectText).toContain("welcome email");
            expect(entities.assigneeUserIds).toEqual([]);
            expect(entities.dueAtCandidate).toBeNull();
        });

        test("detects urgent priority", () => {
            const entities = extractEntitiesFromContent("fix the broken deploy ASAP");
            expect(entities.actionVerb).toBe("fix");
            expect(entities.priorityCandidate).toBe("urgent");
        });

        test("returns empty verb when no allowlist match", () => {
            const entities = extractEntitiesFromContent("hi everyone");
            expect(entities.actionVerb).toBe("");
            expect(entities.priorityCandidate).toBe("");
        });
    });
});
