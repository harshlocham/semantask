/**
 * Migrates ToolGrant unique index to include organizationId.
 *
 * Old: { userId, toolName, conversationId } partial unique (revokedAt null)
 * New: { userId, toolName, conversationId, organizationId } partial unique
 *
 * Usage (from repo root, with MONGODB_URI set):
 *   pnpm --filter @semantask/db exec node ./scripts/migrate-tool-grant-index.mjs
 */
import mongoose from "mongoose";

const INDEX_NAME = "uniq_active_tool_grant";

async function main() {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        throw new Error("MONGODB_URI is required");
    }

    await mongoose.connect(uri);
    const collection = mongoose.connection.collection("toolgrants");
    const existing = await collection.indexes();
    const current = existing.find((idx) => idx.name === INDEX_NAME);

    if (current) {
        const keys = Object.keys(current.key || {});
        const hasOrg = keys.includes("organizationId");
        if (!hasOrg) {
            console.log(`Dropping legacy ${INDEX_NAME} without organizationId...`);
            await collection.dropIndex(INDEX_NAME);
        } else {
            console.log(`${INDEX_NAME} already includes organizationId; skipping drop.`);
        }
    } else {
        console.log(`${INDEX_NAME} not found; will create via syncIndexes.`);
    }

    // Ensure models are registered, then sync.
    await import("../models/ToolGrant.js");
    const ToolGrant = mongoose.models.ToolGrant;
    if (!ToolGrant) {
        throw new Error("ToolGrant model failed to load");
    }

    await ToolGrant.syncIndexes();
    console.log("ToolGrant indexes synced.");
    await mongoose.disconnect();
}

main().catch(async (error) => {
    console.error(error);
    try {
        await mongoose.disconnect();
    } catch {
        // ignore
    }
    process.exit(1);
});
