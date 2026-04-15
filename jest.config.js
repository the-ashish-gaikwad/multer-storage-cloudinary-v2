"use strict";

module.exports = {
  testEnvironment: "node",
  testMatch: ["**/*.test.js", "**/?(*.)+(spec|test).js"],
  collectCoverageFrom: ["index.js"],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 90,
      lines: 90,
      statements: 90,
    },
  },
};
