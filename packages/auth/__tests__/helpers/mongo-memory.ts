/** MongoDB version pinned for mongodb-memory-server (keep in sync with CI cache key). */
export const TEST_MONGO_BINARY_VERSION = "7.0.37";

export const TEST_MONGO_REPL_SET_OPTIONS = {
    binary: { version: TEST_MONGO_BINARY_VERSION },
    replSet: { count: 1, storageEngine: "wiredTiger" as const },
};
