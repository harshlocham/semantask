import { MongoMemoryServer } from "mongodb-memory-server";
import { TEST_MONGO_BINARY_VERSION } from "./mongo-memory.js";

const mongod = await MongoMemoryServer.create({
    binary: { version: TEST_MONGO_BINARY_VERSION },
});

await mongod.stop();
console.log(`MongoDB ${TEST_MONGO_BINARY_VERSION} binary ready`);
