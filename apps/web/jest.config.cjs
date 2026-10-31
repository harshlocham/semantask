module.exports = {
  testEnvironment: "node",
  testMatch: ["<rootDir>/test/**/*.test.ts", "<rootDir>/test/**/*.test.tsx"],
  setupFilesAfterEnv: ["<rootDir>/test/setup-jest-dom.ts"],
  transform: {
    "^.+\\.(ts|tsx)$": [
      "ts-jest",
      {
        tsconfig: {
          jsx: "react-jsx",
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          module: "commonjs",
          moduleResolution: "node",
          types: ["jest", "node"],
        },
      },
    ],
  },
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
    "^@/lib/Db/(.*)$": "<rootDir>/../../packages/db/$1",
    "^@/lib/services/(.*)$": "<rootDir>/../../packages/services/$1",
    "^@/lib/repositories/(.*)$": "<rootDir>/../../packages/services/repositories/$1",
    "^@/server/normalizers/(.*)$": "<rootDir>/../../packages/services/normalizers/$1",
    "^@/lib/hooks/(.*)$": "<rootDir>/hooks/$1",
    "^@/lib/socket/(.*)$": "<rootDir>/hooks/$1",
    "^@/models/(.*)$": "<rootDir>/../../packages/db/models/$1",
    "^@/(.*)$": "<rootDir>/$1",
    "^@semantask/types$": "<rootDir>/../../packages/types/index.ts",
    "^@semantask/types/(.*)$": "<rootDir>/../../packages/types/$1",
    "^@semantask/services/(.*)$": "<rootDir>/../../packages/services/$1",
    "^@semantask/db$": "<rootDir>/../../packages/db/dist/db.js",
    "^@semantask/db/(.*)$": "<rootDir>/../../packages/db/$1",
    "^@semantask/observability/(.*)$": "<rootDir>/../../packages/observability/$1",
    "^next/link$": "<rootDir>/test/mocks/next-link.tsx",
  },
  clearMocks: true,
};
