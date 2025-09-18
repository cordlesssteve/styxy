/**
 * End-to-end tests for multi-instance coordination scenarios
 */

const TestDaemonHelper = require('../../helpers/daemon-helper');
const TestCliHelper = require('../../helpers/cli-helper');
const TestPortHelper = require('../../helpers/port-helper');

describe('Multi-Instance Coordination', () => {
  let daemonHelper;
  let daemon;
  let cli;

  beforeEach(async () => {
    daemonHelper = new TestDaemonHelper();
    const daemonInfo = await daemonHelper.start();
    daemon = daemonInfo.daemon;
    cli = new TestCliHelper(daemonInfo.port);
  });

  afterEach(async () => {
    await daemonHelper.cleanup();
  });

  describe('concurrent allocations', () => {
    it('should handle multiple simultaneous allocation requests', async () => {
      const testPorts = await TestPortHelper.getRandomPortsInRange(3, 10000, 10100);

      // Simulate multiple instances requesting ports simultaneously
      const promises = testPorts.map((port, index) =>
        cli.allocate('dev', {
          port,
          name: `concurrent-service-${index}`,
          project: `/project/${index}`
        })
      );

      const results = await Promise.all(promises);

      // All allocations should succeed
      results.forEach(result => {
        expect(result.success).toBe(true);
      });

      // Verify all ports are allocated
      testPorts.forEach(port => {
        expect(daemon.allocations.has(port)).toBe(true);
      });

      expect(daemon.allocations.size).toBe(3);
    });

    it('should resolve port conflicts by allocating alternative ports', async () => {
      const preferredPort = await TestPortHelper.findAvailablePort(10000, 10100);

      // Multiple instances requesting the same preferred port
      const promises = [
        cli.allocate('dev', { port: preferredPort, name: 'service-1' }),
        cli.allocate('api', { port: preferredPort, name: 'service-2' }),
        cli.allocate('test', { port: preferredPort, name: 'service-3' })
      ];

      const results = await Promise.all(promises);

      // All allocations should succeed
      results.forEach(result => {
        expect(result.success).toBe(true);
      });

      // Verify different ports were allocated
      const allocatedPorts = Array.from(daemon.allocations.keys());
      expect(allocatedPorts).toHaveLength(3);
      expect(new Set(allocatedPorts).size).toBe(3); // All unique ports

      // At most one should get the preferred port
      const preferredPortAllocations = allocatedPorts.filter(port => port === preferredPort);
      expect(preferredPortAllocations.length).toBeLessThanOrEqual(1);
    });
  });

  describe('service type separation', () => {
    it('should allocate ports from appropriate service ranges', async () => {
      const allocations = await Promise.all([
        cli.allocate('dev'),
        cli.allocate('api'),
        cli.allocate('test'),
        cli.allocate('storybook'),
        cli.allocate('docs')
      ]);

      allocations.forEach(result => {
        expect(result.success).toBe(true);
      });

      // Verify ports are allocated from correct service ranges
      for (const [port, allocation] of daemon.allocations) {
        const serviceConfig = daemon.serviceTypes[allocation.service_type];
        const [rangeStart, rangeEnd] = serviceConfig.range;

        expect(port).toBeGreaterThanOrEqual(rangeStart);
        expect(port).toBeLessThanOrEqual(rangeEnd);
      }
    });
  });

  describe('cleanup scenarios', () => {
    it('should handle cleanup while allocations are active', async () => {
      const testPorts = await TestPortHelper.getRandomPortsInRange(3, 10000, 10100);

      // Allocate some ports
      for (const [index, port] of testPorts.entries()) {
        await cli.allocate('dev', {
          port,
          name: `cleanup-test-${index}`
        });
      }

      // Create one manually old allocation
      const oldPort = testPorts[0];
      const allocation = daemon.allocations.get(oldPort);
      allocation.allocated_at = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2 hours ago
      daemon.allocations.set(oldPort, allocation);

      // Run cleanup
      const result = await cli.cleanup();

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('1 stale allocation');

      // Verify only the old allocation was cleaned up
      expect(daemon.allocations.has(oldPort)).toBe(false);
      expect(daemon.allocations.size).toBe(2);
    });
  });

  describe('port availability checking', () => {
    it('should correctly identify system vs Styxy port usage', async () => {
      const testPorts = await TestPortHelper.getRandomPortsInRange(2, 10000, 10100);
      const [styxyPort, systemPort] = testPorts;

      // Allocate one port through Styxy
      await cli.allocate('dev', { port: styxyPort, name: 'styxy-service' });

      // Occupy another port at system level
      await TestPortHelper.withTestServers([systemPort], async () => {
        // Check both ports
        const styxyCheck = await cli.check(styxyPort);
        const systemCheck = await cli.check(systemPort);

        expect(styxyCheck.success).toBe(true);
        expect(styxyCheck.stdout).toContain('allocated to Styxy');
        expect(styxyCheck.stdout).toContain('styxy-service');

        expect(systemCheck.success).toBe(true);
        expect(systemCheck.stdout).toContain('in use by system');
      });
    });
  });

  describe('state persistence', () => {
    it('should persist allocations across daemon restart', async () => {
      const testPort = await TestPortHelper.findAvailablePort(10000, 10100);

      // Allocate a port
      const allocateResult = await cli.allocate('dev', {
        port: testPort,
        name: 'persistence-test'
      });
      expect(allocateResult.success).toBe(true);

      // Get the daemon's state directory for reuse
      const configDir = daemon.configDir;

      // Stop current daemon
      await daemonHelper.stop();

      // Start new daemon with same config directory
      const daemonInfo = await daemonHelper.start({ configDir });
      daemon = daemonInfo.daemon;
      cli = new TestCliHelper(daemonInfo.port);

      // Verify allocation was restored
      expect(daemon.allocations.has(testPort)).toBe(true);
      const allocation = daemon.allocations.get(testPort);
      expect(allocation.service_name).toBe('persistence-test');

      // Verify through CLI
      const listResult = await cli.list();
      expect(listResult.success).toBe(true);
      expect(listResult.stdout).toContain('persistence-test');
    });
  });

  describe('complex workflow scenarios', () => {
    it('should handle full development workflow', async () => {
      // Simulate a complete development setup
      const workflows = [
        { service: 'dev', name: 'main-app' },
        { service: 'api', name: 'backend-api' },
        { service: 'test', name: 'test-runner' },
        { service: 'storybook', name: 'component-lib' },
        { service: 'docs', name: 'documentation' }
      ];

      const allocations = [];

      // Allocate ports for all services
      for (const workflow of workflows) {
        const result = await cli.allocate(workflow.service, {
          name: workflow.name,
          project: '/project/myapp'
        });

        expect(result.success).toBe(true);
        allocations.push(result);
      }

      // Verify all allocations
      const listResult = await cli.list({ verbose: true });
      expect(listResult.success).toBe(true);

      workflows.forEach(workflow => {
        expect(listResult.stdout).toContain(workflow.name);
      });

      // Simulate stopping some services
      const lockIdMatch = allocations[0].stdout.match(/Lock ID: ([a-f0-9-]+)/);
      if (lockIdMatch) {
        const releaseResult = await cli.release(lockIdMatch[1]);
        expect(releaseResult.success).toBe(true);
      }

      // Verify partial cleanup
      const finalListResult = await cli.list();
      expect(finalListResult.success).toBe(true);
      expect(finalListResult.stdout).toContain('4 allocation'); // One released
    });
  });
});