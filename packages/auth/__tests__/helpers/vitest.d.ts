declare module "vitest" {
    export interface ProvidedContext {
        testMongoUri: string;
    }
}

export {};
