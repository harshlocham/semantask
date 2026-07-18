type LLMUsageContext = {
    organizationId?: string | null;
    userId?: string | null;
    taskId?: string | null;
};

let activeContext: LLMUsageContext | null = null;

export function setLLMUsageContext(context: LLMUsageContext | null): void {
    activeContext = context;
}

export function getLLMUsageContext(): LLMUsageContext | null {
    return activeContext;
}

export async function runWithLLMUsageContext<T>(
    context: LLMUsageContext,
    fn: () => Promise<T>
): Promise<T> {
    const previous = activeContext;
    activeContext = context;
    try {
        return await fn();
    } finally {
        activeContext = previous;
    }
}
