/**
 * Minimal test to verify daemon can be created and destroyed without hanging
 */

const { createTestHelper } = require('../../helpers/daemon-test-helper');

describe('Daemon Lifecycle - Minimal Test', () => {
  let testHelper;

  beforeEach(() => {
    testHelper = createTestHelper();
  });

  afterEach(async () => {
    await testHelper.cleanup();
  });

  test('should create and cleanup daemon without hanging', async () => {
    const daemon = await testHelper.createDaemon();

    expect(daemon).toBeDefined();
    expect(daemon.recoveryConfig).toBeDefined();

    // Cleanup happens in afterEach
  }, 10000); // 10 second timeout

  test('should create multiple daemons and cleanup all', async () => {
    const daemon1 = await testHelper.createDaemon({ port: 9960 });
    const daemon2 = await testHelper.createDaemon({ port: 9961 });

    expect(daemon1.port).toBe(9960);
    expect(daemon2.port).toBe(9961);

    // Cleanup happens in afterEach
  }, 10000);
});
