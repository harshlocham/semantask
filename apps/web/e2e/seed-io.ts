import { readFileSync } from "node:fs";
import path from "node:path";

export const E2E_SEED_PATH = path.join(__dirname, ".seed.json");

export type E2eSeed = {
    conversationId: string;
    taskTitle: string;
};

export function readE2eSeed(): E2eSeed {
    return JSON.parse(readFileSync(E2E_SEED_PATH, "utf8")) as E2eSeed;
}
