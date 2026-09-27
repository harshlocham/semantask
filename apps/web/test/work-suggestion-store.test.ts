import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

const listWorkSuggestions = jest.fn();

jest.mock("@/lib/utils/api", () => ({
    listWorkSuggestions: (...args: unknown[]) => listWorkSuggestions(...args),
}));

import useWorkSuggestionStore, {
    __workSuggestionStoreTestUtils,
} from "@/store/work-suggestion-store";

function suggestion(id: string, messageId: string) {
    return {
        _id: id,
        messageId,
        conversationId: "conv-1",
        organizationId: null,
        intentId: null,
        status: "proposed" as const,
        title: `Title ${id}`,
        summary: "",
        confidence: 0.9,
        candidates: {
            assigneeCandidates: [] as string[],
            dueAtCandidate: null,
            priorityCandidate: "" as const,
        },
        dismissReason: null,
        convertedTaskId: null,
        extractorVersion: "v1",
        createdAt: "2026-08-08T10:00:00.000Z",
        updatedAt: "2026-08-08T10:00:00.000Z",
    };
}

describe("work-suggestion-store", () => {
    beforeEach(() => {
        listWorkSuggestions.mockReset();
        __workSuggestionStoreTestUtils.resetInFlight();
        useWorkSuggestionStore.setState({
            suggestionIdByMessageId: {},
            suggestionByMessageId: {},
            loadingByConversation: {},
            errorByConversation: {},
        });
    });

    afterEach(() => {
        __workSuggestionStoreTestUtils.resetInFlight();
    });

    it("aggregates every proposed page before replacing the conversation map", async () => {
        listWorkSuggestions
            .mockResolvedValueOnce({
                items: [suggestion("s1", "m1")],
                pagination: { page: 1, limit: 100, total: 101, totalPages: 2 },
            })
            .mockResolvedValueOnce({
                items: [suggestion("s2", "m2")],
                pagination: { page: 2, limit: 100, total: 101, totalPages: 2 },
            })
            .mockResolvedValueOnce({
                items: [],
                pagination: { page: 1, limit: 100, total: 0, totalPages: 1 },
            });

        await useWorkSuggestionStore.getState().loadConversation("conv-1");

        expect(listWorkSuggestions).toHaveBeenCalledTimes(3);
        expect(listWorkSuggestions).toHaveBeenNthCalledWith(1, {
            conversationId: "conv-1",
            status: "proposed",
            page: 1,
            limit: 100,
        });
        expect(listWorkSuggestions).toHaveBeenNthCalledWith(2, {
            conversationId: "conv-1",
            status: "proposed",
            page: 2,
            limit: 100,
        });
        expect(listWorkSuggestions).toHaveBeenNthCalledWith(3, {
            conversationId: "conv-1",
            status: "converted",
            page: 1,
            limit: 100,
        });
        expect(useWorkSuggestionStore.getState().getSuggestionId("conv-1", "m1")).toBe("s1");
        expect(useWorkSuggestionStore.getState().getSuggestionId("conv-1", "m2")).toBe("s2");
        expect(useWorkSuggestionStore.getState().getSuggestion("conv-1", "m1")?._id).toBe("s1");
    });

    it("schedules a trailing refresh when a caller joins an in-flight request", async () => {
        let resolveFirst!: () => void;
        const firstGate = new Promise<void>((resolve) => {
            resolveFirst = resolve;
        });

        listWorkSuggestions.mockImplementation(async (params: { page?: number }) => {
            if (listWorkSuggestions.mock.calls.length === 1) {
                await firstGate;
                return {
                    items: [suggestion("s1", "m1")],
                    pagination: { page: 1, limit: 100, total: 1, totalPages: 1 },
                };
            }
            return {
                items: [suggestion("s1", "m1"), suggestion("s2", "m2")],
                pagination: { page: params.page ?? 1, limit: 100, total: 2, totalPages: 1 },
            };
        });

        const first = useWorkSuggestionStore.getState().refreshConversation("conv-1");
        const joined = useWorkSuggestionStore.getState().refreshConversation("conv-1");

        resolveFirst();
        await Promise.all([first, joined]);

        expect(listWorkSuggestions.mock.calls.length).toBeGreaterThanOrEqual(2);
        expect(useWorkSuggestionStore.getState().getSuggestionId("conv-1", "m2")).toBe("s2");
    });
});
