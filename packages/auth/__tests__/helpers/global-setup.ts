import type { TestProject } from "vitest/node";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { TEST_MONGO_REPL_SET_OPTIONS } from "./mongo-memory.js";

let server: MongoMemoryReplSet | undefined;

export default async function globalSetup(project: TestProject): Promise<() => Promise<void>> {
    server = await MongoMemoryReplSet.create(TEST_MONGO_REPL_SET_OPTIONS);
    project.provide("testMongoUri", server.getUri());

    return async () => {
        if (server) {
            await server.stop();
            server = undefined;
        }
    };
}
