import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, inject } from "vitest";

export interface TestDbHandle {
    /** Connection string of the in-memory server. */
    uri: string;
    /**
     * Remove all documents from every collection. Used between tests to reset
     * state while keeping indexes intact (faster than dropping the database).
     */
    clear(): Promise<void>;
    /**
     * Build indexes for all currently-registered models. Required because the
     * in-memory server starts empty and several auth flows depend on the unique
     * `email` / partial-unique `googleSub` indexes to behave correctly.
     */
    ensureIndexes(): Promise<void>;
}

async function clearAllCollections(): Promise<void> {
    const { collections } = mongoose.connection;
    await Promise.all(
        Object.values(collections).map((collection) => collection.deleteMany({}))
    );
}

async function syncRegisteredIndexes(): Promise<void> {
    // Iterate registered models rather than importing each one, so the harness
    // stays decoupled from the model layer. Models register themselves when the
    // module under test imports them, which has already happened by `beforeAll`.
    await Promise.all(
        Object.values(mongoose.models).map((model) => model.syncIndexes())
    );
}

/**
 * Wire the shared in-memory MongoDB instance into a test file's lifecycle.
 *
 * A single replica set is booted once via Vitest `globalSetup`; each file
 * connects in `beforeAll`, truncates between tests, and disconnects in
 * `afterAll` without stopping the shared server.
 *
 * Usage (in an integration test file):
 *   const { db } = useTestDb();
 */
export function useTestDb(): { db: () => TestDbHandle } {
    let handle: TestDbHandle | undefined;

    beforeAll(async () => {
        const uri = inject("testMongoUri");

        if (mongoose.connection.readyState === 0) {
            await mongoose.connect(uri);
        }

        handle = {
            uri,
            clear: clearAllCollections,
            ensureIndexes: syncRegisteredIndexes,
        };

        await handle.ensureIndexes();
    });

    afterEach(async () => {
        if (handle) {
            await handle.clear();
        }
    });

    afterAll(async () => {
        if (mongoose.connection.readyState !== 0) {
            await mongoose.disconnect();
        }
        handle = undefined;
    });

    return {
        db: () => {
            if (!handle) {
                throw new Error(
                    "Test database is not initialized. Ensure useTestDb() is called at the top level of the test file."
                );
            }
            return handle;
        },
    };
}
