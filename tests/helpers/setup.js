/**
 * Global test setup
 */

const tmp = require('tmp');
const path = require('path');

// Set test environment variables
process.env.NODE_ENV = 'test';

// Create temporary directory for test state
const testTmpDir = tmp.dirSync({ prefix: 'styxy-test-', unsafeCleanup: true });
process.env.STYXY_TEST_DIR = testTmpDir.name;

// Cleanup after all tests
afterAll(() => {
  try {
    testTmpDir.removeCallback();
  } catch (error) {
    console.warn('Failed to cleanup test directory:', error.message);
  }
});

// Global test timeout
jest.setTimeout(30000);