/**
 * Simple focused tests for port conflict detection
 */

const { createTestHelper } = require('../../helpers/daemon-test-helper');

describe('Port Conflict Detection - Simple Tests', () => {
  let testHelper;
  let daemon;

  beforeEach(async () => {
    testHelper = createTestHelper();
    daemon = await testHelper.createDaemon();
  });

  afterEach(async () => {
    await testHelper.cleanup();
  });

  describe('checkPortActuallyAvailable()', () => {
    test('returns true for available port', async () => {
      const available = await daemon.checkPortActuallyAvailable(54321);
      expect(available).toBe(true);
    });

    test('returns false for port in use', async () => {
      const port = 54322;
      const server = await testHelper.createExternalServer(port);

      const available = await daemon.checkPortActuallyAvailable(port);
      expect(available).toBe(false);

      testHelper.closeExternalServer(server);
    });
  });

  describe('Recovery Configuration', () => {
    test('loads recovery config correctly', () => {
      expect(daemon.recoveryConfig).toBeDefined();
      expect(daemon.recoveryConfig.port_conflict.enabled).toBe(true);
      expect(daemon.recoveryConfig.port_conflict.check_availability).toBe(true);
    });
  });
});
