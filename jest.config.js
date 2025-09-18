module.exports = {
  testEnvironment: 'node',
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/**/*.test.js',
    '!**/node_modules/**'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  testMatch: [
    '<rootDir>/tests/**/*.test.js',
    '<rootDir>/tests/**/*.spec.js'
  ],
  setupFilesAfterEnv: ['<rootDir>/tests/helpers/setup.js'],
  testTimeout: 30000, // 30 seconds for daemon tests
  maxWorkers: 1, // Run tests sequentially to avoid port conflicts
  forceExit: true, // Ensure Jest exits after tests complete
  detectOpenHandles: true, // Help detect async operations that prevent exit
  verbose: true,
  projects: [
    {
      displayName: 'unit',
      testMatch: ['<rootDir>/tests/unit/**/*.test.js']
    },
    {
      displayName: 'integration',
      testMatch: ['<rootDir>/tests/integration/**/*.test.js']
    },
    {
      displayName: 'e2e',
      testMatch: ['<rootDir>/tests/e2e/**/*.test.js']
    }
  ]
};