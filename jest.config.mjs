import nextJest from "next/jest.js";

// next/jest compiles tests with the same SWC config as the app and loads
// .env files the way `next` does.
const createJestConfig = nextJest({ dir: "./" });

/** @type {import("jest").Config} */
const config = {
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  moduleNameMapper: {
    // Server-only modules are imported directly by unit tests.
    "^server-only$": "<rootDir>/tests/mocks/server-only.ts",
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  clearMocks: true,
};

export default createJestConfig(config);
