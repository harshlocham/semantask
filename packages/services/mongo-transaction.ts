/** True when MongoDB rejected a multi-document transaction (standalone / no replica set). */
export function isMongoTransactionUnsupported(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes("Transaction numbers are only allowed")
        || message.includes("replica set")
        || message.includes("standalone");
}
