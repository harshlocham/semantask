export const E2E_PASSWORD = "E2ePassw0rd!";

export const ALICE = {
    username: "Alice",
    email: "alice@e2e.semantask.test",
    password: E2E_PASSWORD,
} as const;

export const BOB = {
    username: "Bob",
    email: "bob@e2e.semantask.test",
    password: E2E_PASSWORD,
} as const;

export const E2E_ORG = {
    name: "E2E Acme",
    slug: "e2e-acme",
} as const;
