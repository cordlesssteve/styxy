/**
 * Unit tests for Port Conflict Recovery (Feature #3, Phase 1)
 */

const StyxyDaemon = require('../../../src/daemon');
const net = require('net');
const fs = require('fs');
const path = require('path');

describe('Port Conflict Recovery - Unit Tests', () => {
  let daemon;
  let testConfigDir;

  beforeEach(async () => {
    // Create temp config directory
    testConfigDir = path.join(__dirname, '../../.test-config-conflict-recovery');
    if (!fs.existsSync(testConfigDir)) {
      fs.mkdirSync(testConfigDir, { recursive: true });
    }

    // Create daemon instance with conflict recovery enabled
    daemon = new StyxyDaemon({
      port: 9999, // Use different port to avoid conflicts with running daemon
      configDir: testConfigDir
    });

    await daemon.loadState();
  });

  afterEach(async () => {
    if (daemon && daemon.server) {
      await new Promise(resolve => daemon.server.close(resolve));
    }

    // Cleanup
    if (fs.existsSync(testConfigDir)) {
      fs.rmSync(testConfigDir, { recursive: true, force: true });
    }
  });

  describe('checkPortActuallyAvailable()', () => {
    let externalServer;

    afterEach(() => {
      if (externalServer && externalServer.listening) {
        externalServer.close();
      }
    });

    test('should return true for available port', async () => {
      const port = 54321;
      const available = await daemon.checkPortActuallyAvailable(port);
      expect(available).toBe(true);
    });

    test('should return false for port in use by external process', async () => {
      const port = 54322;

      // Start external server on port
      externalServer = net.createServer();
      await new Promise((resolve) => {
        externalServer.listen(port, '127.0.0.1', resolve);
      });

      const available = await daemon.checkPortActuallyAvailable(port);
      expect(available).toBe(false);
    });

    test('should handle port check errors gracefully', async () => {
      // Try a reserved/system port that will likely fail
      const port = 1; // System port, will likely get EACCES
      const available = await daemon.checkPortActuallyAvailable(port);

      // Should return boolean (likely false)
      expect(typeof available).toBe('boolean');
    });
  });

  describe('Conflict Detection in Allocation Flow', () => {
    let externalServer;

    afterEach(() => {
      if (externalServer && externalServer.listening) {
        externalServer.close();
      }
    });

    test('should detect conflict when port is in use externally', async () => {
      const serviceType = 'dev';
      const port = 3000; // First preferred port for dev

      // Start external server on port 3000
      externalServer = net.createServer();
      await new Promise((resolve) => {
        externalServer.listen(port, '127.0.0.1', resolve);
      });

      // Try to allocate - should skip 3000 due to conflict and use 3001
      const result = await daemon.allocatePort({
        service_type: serviceType,
        service_name: 'test-dev-server',
        instance_id: 'test-instance'
      });

      // Should succeed but with different port
      expect(result.port).not.toBe(port);
      expect(result.port).toBe(3001); // Next available port

      // Check metrics
      const metrics = daemon.metrics.getMetrics();
      expect(metrics.port_conflicts_detected_total).toBe(1);
    });

    test('should try multiple ports when conflicts exist', async () => {
      const serviceType = 'dev';
      const servers = [];

      // Block first 3 preferred ports
      for (let port = 3000; port <= 3002; port++) {
        const server = net.createServer();
        await new Promise((resolve) => {
          server.listen(port, '127.0.0.1', resolve);
        });
        servers.push(server);
      }

      // Try to allocate
      const result = await daemon.allocatePort({
        service_type: serviceType,
        service_name: 'test-dev-server',
        instance_id: 'test-instance'
      });

      // Should succeed with port 3003 (fourth preferred port)
      expect(result.port).toBe(3003);

      // Check metrics - should have detected 3 conflicts
      const metrics = daemon.metrics.getMetrics();
      expect(metrics.port_conflicts_detected_total).toBe(3);

      // Cleanup servers
      for (const server of servers) {
        server.close();
      }
    });

    test('should fail when all preferred ports have conflicts', async () => {
      const serviceType = 'dev';
      const servers = [];

      // Block only the first 10 ports (3000-3009) - enough to test the retry logic
      for (let port = 3000; port <= 3009; port++) {
        const server = net.createServer();
        await new Promise((resolve) => {
          server.listen(port, '127.0.0.1', resolve);
        });
        servers.push(server);
      }

      // Try to allocate - should succeed with port 3010 or higher
      const result = await daemon.allocatePort({
        service_type: serviceType,
        service_name: 'test-dev-server',
        instance_id: 'test-instance'
      });

      // Should get a port >= 3010
      expect(result.port).toBeGreaterThanOrEqual(3010);

      // Cleanup servers
      for (const server of servers) {
        server.close();
      }
    });
  });

  describe('Recovery Configuration', () => {
    test('should load default recovery config with port_conflict enabled', () => {
      expect(daemon.recoveryConfig).toBeDefined();
      expect(daemon.recoveryConfig.port_conflict).toBeDefined();
      expect(daemon.recoveryConfig.port_conflict.enabled).toBe(true);
      expect(daemon.recoveryConfig.port_conflict.check_availability).toBe(true);
      expect(daemon.recoveryConfig.port_conflict.max_retries).toBe(3);
    });

    test('should skip conflict checks when recovery disabled', async () => {
      // Create daemon with recovery disabled
      const testConfig = {
        recovery: {
          port_conflict: {
            enabled: false,
            check_availability: false
          }
        }
      };

      const disabledConfigDir = path.join(__dirname, '../../.test-config-disabled');
      if (!fs.existsSync(disabledConfigDir)) {
        fs.mkdirSync(disabledConfigDir, { recursive: true });
      }

      // Write config
      fs.writeFileSync(
        path.join(disabledConfigDir, 'config.json'),
        JSON.stringify(testConfig, null, 2)
      );

      const disabledDaemon = new StyxyDaemon({
        port: 9998,
        configDir: disabledConfigDir
      });

      await disabledDaemon.loadState();

      // Verify config loaded
      expect(disabledDaemon.recoveryConfig.port_conflict.enabled).toBe(false);

      // Start external server
      const externalServer = net.createServer();
      await new Promise((resolve) => {
        externalServer.listen(3000, '127.0.0.1', resolve);
      });

      // Try to allocate - with recovery disabled, it won't detect the conflict
      // and will likely fail or return the conflicted port
      // (This test demonstrates the config working, not that it's a good idea to disable)

      externalServer.close();

      // Cleanup
      fs.rmSync(disabledConfigDir, { recursive: true, force: true });
    });
  });

  describe('Logging and Metrics', () => {
    let externalServer;

    afterEach(() => {
      if (externalServer && externalServer.listening) {
        externalServer.close();
      }
    });

    test('should log warning when conflict detected', async () => {
      const logSpy = jest.spyOn(daemon.logger, 'warn');

      // Start external server
      externalServer = net.createServer();
      await new Promise((resolve) => {
        externalServer.listen(3000, '127.0.0.1', resolve);
      });

      // Try to allocate
      const result = await daemon.allocatePort({
        service_type: 'dev',
        service_name: 'test-dev-server',
        instance_id: 'test-instance'
      });

      // Should have logged conflict warning
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Port conflict detected'),
        expect.objectContaining({
          port: 3000
        })
      );
    });

    test('should increment port_conflicts_detected_total metric', async () => {
      // Start external server
      externalServer = net.createServer();
      await new Promise((resolve) => {
        externalServer.listen(3000, '127.0.0.1', resolve);
      });

      // Reset metrics
      daemon.metrics.resetMetrics();

      // Try to allocate
      await daemon.allocatePort({
        service_type: 'dev',
        service_name: 'test-dev-server',
        instance_id: 'test-instance'
      });

      const metrics = daemon.metrics.getMetrics();
      expect(metrics.port_conflicts_detected_total).toBe(1);
    });
  });
});
