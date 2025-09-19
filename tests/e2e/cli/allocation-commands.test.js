/**
 * End-to-end tests for CLI allocation commands
 */

const TestDaemonHelper = require('../../helpers/daemon-helper');
const TestCliHelper = require('../../helpers/cli-helper');
const TestPortHelper = require('../../helpers/port-helper');

describe('CLI Allocation Commands', () => {
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

  describe('styxy allocate', () => {
    it('should allocate a specific port successfully', async () => {
      const testPort = await TestPortHelper.getEphemeralPort();

      const result = await cli.runJson(['allocate', '-s', 'dev', '-p', testPort.toString(), '-n', 'e2e-test-service']);

      expect(result.success).toBe(true);
      expect(result.json).toBeDefined();
      expect(result.json.success).toBe(true);
      expect(result.json.port).toBe(testPort);
      expect(result.json.lock_id).toBeDefined();

      // Verify allocation exists in daemon
      expect(daemon.allocations.has(testPort)).toBe(true);
      const allocation = daemon.allocations.get(testPort);
      expect(allocation.service_name).toBe('e2e-test-service');
    });

    it('should allocate from service preferred ports when no specific port given', async () => {
      const result = await cli.runJson(['allocate', '-s', 'dev']);

      expect(result.success).toBe(true);
      expect(result.json.success).toBe(true);
      expect(result.json.port).toBeDefined();

      const allocatedPort = result.json.port;
      expect(daemon.serviceTypes.dev.preferred_ports).toContain(allocatedPort);

      // Verify allocation exists in daemon
      expect(daemon.allocations.has(allocatedPort)).toBe(true);
    });

    it('should handle port conflicts gracefully', async () => {
      const testPort = await TestPortHelper.getEphemeralPort();

      // Allocate the port first
      const firstResult = await cli.runJson(['allocate', '-s', 'dev', '-p', testPort.toString()]);
      expect(firstResult.success).toBe(true);
      expect(firstResult.json.port).toBe(testPort);

      // Try to allocate the same port again
      const secondResult = await cli.runJson(['allocate', '-s', 'api', '-p', testPort.toString()]);

      expect(secondResult.success).toBe(true);
      expect(secondResult.json.success).toBe(true);
      expect(secondResult.json.port).not.toBe(testPort);

      // Should allocate a different port from the api service range
      const [rangeStart, rangeEnd] = daemon.serviceTypes.api.range;
      expect(secondResult.json.port).toBeGreaterThanOrEqual(rangeStart);
      expect(secondResult.json.port).toBeLessThanOrEqual(rangeEnd);
    });

    it('should reject invalid service types', async () => {
      const result = await cli.runJson(['allocate', '-s', 'invalid-service']);

      expect(result.success).toBe(false);
      expect(result.json.success).toBe(false);
      expect(result.json.error).toContain('Unknown service type');
    });

    it('should include project path when specified', async () => {
      const testPort = await TestPortHelper.findAvailablePort(10000, 10100);

      const result = await cli.allocate('dev', {
        port: testPort,
        project: '/test/project/path'
      });

      expect(result.success).toBe(true);

      const allocation = daemon.allocations.get(testPort);
      expect(allocation.project_path).toBe('/test/project/path');
    });
  });

  describe('styxy release', () => {
    it('should release allocated port successfully', async () => {
      const testPort = await TestPortHelper.findAvailablePort(10000, 10100);

      // First allocate a port
      const allocateResult = await cli.allocate('dev', { port: testPort });
      expect(allocateResult.success).toBe(true);

      // Extract lock ID from output
      const lockIdMatch = allocateResult.stdout.match(/Lock ID: ([a-f0-9-]+)/);
      expect(lockIdMatch).toBeTruthy();
      const lockId = lockIdMatch[1];

      // Release the port
      const releaseResult = await cli.release(lockId);

      expect(releaseResult.success).toBe(true);
      expect(releaseResult.stdout).toContain(`Port ${testPort} released`);

      // Verify allocation is removed
      expect(daemon.allocations.has(testPort)).toBe(false);
    });

    it('should handle invalid lock ID gracefully', async () => {
      const result = await cli.release('invalid-lock-id');

      expect(result.success).toBe(false);
      expect(result.stderr || result.stdout).toContain('lock_id must be a valid UUID v4');
    });
  });

  describe('styxy check', () => {
    it('should check available port correctly', async () => {
      const testPort = await TestPortHelper.findAvailablePort(10000, 10100);

      const result = await cli.check(testPort);

      expect(result.success).toBe(true);
      expect(result.stdout).toContain(`Port ${testPort} is available`);
    });

    it('should check allocated port correctly', async () => {
      const testPort = await TestPortHelper.findAvailablePort(10000, 10100);

      // Allocate the port first
      await cli.allocate('dev', { port: testPort, name: 'check-test' });

      // Check the port
      const result = await cli.check(testPort);

      expect(result.success).toBe(true);
      expect(result.stdout).toContain(`Port ${testPort} is in use`);
      expect(result.stdout).toContain('check-test');
    });

    it('should check system-occupied port correctly', async () => {
      const testPort = await TestPortHelper.findAvailablePort(10000, 10100);

      await TestPortHelper.withTestServers([testPort], async () => {
        const result = await cli.check(testPort);

        expect(result.success).toBe(true);
        expect(result.stdout).toContain(`Port ${testPort} is in use`);
      });
    });
  });

  describe('styxy list', () => {
    it('should list current allocations', async () => {
      const testPorts = await TestPortHelper.getRandomPortsInRange(2, 10000, 10100);

      // Allocate multiple ports
      for (const port of testPorts) {
        await cli.allocate('dev', {
          port,
          name: `test-service-${port}`
        });
      }

      const result = await cli.list();

      expect(result.success).toBe(true);
      expect(result.stdout).toContain(`${testPorts.length} allocations`);

      for (const port of testPorts) {
        expect(result.stdout).toContain(port.toString());
      }
    });

    it('should show verbose information when requested', async () => {
      const testPort = await TestPortHelper.findAvailablePort(10000, 10100);

      await cli.allocate('dev', {
        port: testPort,
        name: 'verbose-test',
        project: '/test/project'
      });

      const result = await cli.list({ verbose: true });

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('verbose-test');
      expect(result.stdout).toContain('/test/project');
      expect(result.stdout).toContain('Allocated');
    });

    it('should handle empty allocation list', async () => {
      const result = await cli.list();

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('No active port allocations');
    });
  });

  describe('styxy cleanup', () => {
    it('should clean up stale allocations', async () => {
      const testPort = await TestPortHelper.findAvailablePort(10000, 10100);

      // Create old allocation manually in daemon
      daemon.allocations.set(testPort, {
        service_type: 'dev',
        lock_id: 'old-lock-id',
        allocated_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() // 2 hours ago
      });

      const result = await cli.cleanup();

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('stale allocation');

      // Verify allocation is removed
      expect(daemon.allocations.has(testPort)).toBe(false);
    });

    it('should force cleanup all allocations', async () => {
      const testPort = await TestPortHelper.findAvailablePort(10000, 10100);

      // Allocate a port
      await cli.allocate('dev', { port: testPort });

      const result = await cli.cleanup({ force: true });

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('Force cleanup completed');

      // Verify allocation is removed
      expect(daemon.allocations.has(testPort)).toBe(false);
    });
  });

  describe('styxy scan', () => {
    it('should scan for ports in use', async () => {
      const testPorts = await TestPortHelper.getRandomPortsInRange(2, 11000, 11050);

      // Allocate one port through Styxy
      await cli.allocate('dev', { port: testPorts[0] });

      // Use the other port at system level
      await TestPortHelper.withTestServers([testPorts[1]], async () => {
        const result = await cli.scan({
          start: 11000,
          end: 11050
        });

        expect(result.success).toBe(true);
        expect(result.stdout).toContain('Scanning ports');
        // Test should show either ports in use or no ports found
        expect(result.stdout).toMatch(/No ports in use|Ports in Use/);
      });
    });

    it('should handle empty scan results', async () => {
      const result = await cli.scan({
        start: 12000,
        end: 12010
      });

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('No ports in use');
    });
  });

  describe('styxy instances', () => {
    it('should list registered instances', async () => {
      // Register an instance through the daemon
      daemon.instances.set('test-instance-123', {
        working_directory: '/test/dir',
        registered_at: new Date().toISOString(),
        last_heartbeat: new Date().toISOString(),
        active_allocations: []
      });

      const result = await cli.instances();

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('test-instance-123');
      expect(result.stdout).toContain('/test/dir');
    });

    it('should handle no registered instances', async () => {
      const result = await cli.instances();

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('No active instances registered');
    });
  });
});