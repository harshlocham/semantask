module.exports = {
    testEnvironment: "node",
    testMatch: ["<rootDir>/__tests__/**/*.test.ts"],
    transform: {
        "^.+\\.(ts|tsx)$": [
            "ts-jest",
            {
                tsconfig: {
                    types: ["jest", "node"],
                    esModuleInterop: true,
                    baseUrl: ".",
                    paths: {
                        "@semantask/types": ["../types/index.ts"],
                        "@semantask/db": ["../db/db.ts"],
                        "@semantask/db/*": ["../db/*"],
                        "@semantask/observability": ["../observability/index.ts"],
                        "@semantask/observability/*": ["../observability/*"],
                    },
                },
            },
        ],
    },
    moduleNameMapper: {
        "^(\\.{1,2}/.*)\\.js$": "$1",
        "^@semantask/types$": "<rootDir>/../types/index.ts",
        "^@semantask/types/(.*)$": "<rootDir>/../types/$1",
        "^@semantask/observability/metrics$": "<rootDir>/../observability/metrics.ts",
        "^@semantask/observability$": "<rootDir>/../observability/index.ts",
        "^@semantask/db$": "<rootDir>/../db/db.ts",
        "^@semantask/db/(.*)$": "<rootDir>/../db/$1",
    },
    clearMocks: true,
};
