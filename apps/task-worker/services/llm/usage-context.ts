import { AsyncLocalStorage } from "node:async_hooks";

type LLMUsageContext = {
    organizationId?: string | null;
    userId?: string | null;
    taskId?: string | null;
};

const usageContextStorage = new AsyncLocalStorage<LLMUsageContext>();

export function setLLMUsageContext(context: LLMUsageContext | null): void {
    const store = usageContextStorage.getStore();
    if (!store) {
        return;
    }

    if (context === null) {
        store.organizationId = null;
        store.userId = null;
        store.taskId = null;
        return;
    }

    store.organizationId = context.organizationId;
    store.userId = context.userId;
    store.taskId = context.taskId;
}

export function getLLMUsageContext(): LLMUsageContext | null {
    return usageContextStorage.getStore() ?? null;
}

export async function runWithLLMUsageContext<T>(
    context: LLMUsageContext,
    fn: () => Promise<T>
): Promise<T> {
    return usageContextStorage.run({ ...context }, fn);
}
