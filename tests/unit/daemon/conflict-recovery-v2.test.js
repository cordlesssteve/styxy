/**
 * Unit tests for Port Conflict Recovery (Feature #3, Phase 1)
 * Using improved test helper for proper cleanup
 */

const { createTestHelper } = require('../../helpers/daemon-test-helper');
const net = require('net');

describe('Port Conflict Recovery - Unit Tests (v2)', () => {
  let testHelper;
  let daemon;

  beforeEach(async () => {
    testHelper = createTestHelper();
    daemon = await testHelper.createDaemon({
      port: 9950 // Use consistent test port
    });
  });

  afterEach(async () => {
    await testHelper.cleanup();
  });

  describe('checkPortActuallyAvailable()', () => {
    test('should return true for available port', async () => {
      const port = 54321;
      const available = await daemon.checkPortActuallyAvailable(port);
      expect(available).toBe(true);
    });

    test('should return false for port in use by external process', async () => {
      const port = 54322;

      // Start external server on port
      const externalServer = await testHelper.createExternalServer(port);

      const available = await daemon.checkPortActuallyAvailable(port);
      expect(available).toBe(false);

      // Cleanup
      testHelper.closeExternalServer(externalServer);
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
    test('should detect conflict when port is in use externally', async () => {
      const serviceType = 'dev';
      const port = 3000; // First preferred port for dev

      // Start external server on port 3000
      const externalServer = await testHelper.createExternalServer(port);

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

      // Cleanup
      testHelper.closeExternalServer(externalServer);
    });

    test('should try multiple ports when conflicts exist', async () => {
      const serviceType = 'dev';
      const servers = [];

      try {
        // Block first 3 preferred ports
        for (let port = 3000; port <= 3002; port++) {
          const server = await testHelper.createExternalServer(port);
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
      } finally {
        // Cleanup servers
        for (const server of servers) {
          testHelper.closeExternalServer(server);
        }
      }
    });

    test('should eventually find available port when many conflicts', async () => {
      const serviceType = 'dev';
      const servers = [];

      try {
        // Block first 10 ports (3000-3009)
        for (let port = 3000; port <= 3009; port++) {
          const server = await testHelper.createExternalServer(port);
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

        // Check metrics
        const metrics = daemon.metrics.getMetrics();
        expect(metrics.port_conflicts_detected_total).toBeGreaterThanOrEqual(10);
      } finally {
        // Cleanup servers
        for (const server of servers) {
          testHelper.closeExternalServer(server);
        }
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

    test('should respect user config for recovery settings', async () => {
      // Create a daemon with custom recovery config
      const customConfigDir = testHelper.createTestConfigDir();
      const fs = require('fs');
      const path = require('path');

      // Write custom config
      const customConfig = {
        recovery: {
          port_conflict: {
            enabled: false,
            check_availability: false
          }
        }
      };

      fs.writeFileSync(
        path.join(customConfigDir, 'config.json'),
        JSON.stringify(customConfig, null, 2)
      );

      const customDaemon = await testHelper.createDaemon({
        configDir: customConfigDir,
        port: 9951
      });

      // Verify config loaded
      expect(customDaemon.recoveryConfig.port_conflict.enabled).toBe(false);
      expect(customDaemon.recoveryConfig.port_conflict.check_availability).toBe(false);
    });
  });

  describe('Logging and Metrics', () => {
    test('should log warning when conflict detected', async () => {
      const logSpy = jest.spyOn(daemon.logger, 'warn');

      // Start external server
      const externalServer = await testHelper.createExternalServer(3000);

      // Try to allocate
      await daemon.allocatePort({
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

      // Cleanup
      testHelper.closeExternalServer(externalServer);
    });

    test('should increment port_conflicts_detected_total metric', async () => {
      // Start external server
      const externalServer = await testHelper.createExternalServer(3000);

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

      // Cleanup
      testHelper.closeExternalServer(externalServer);
    });
  });

  describe('Integration with Existing Allocation Logic', () => {
    test('should work with singleton services', async () => {
      const serviceType = 'ai'; // ai is configured as singleton

      // Block first port
      const externalServer = await testHelper.createExternalServer(11430);

      // Allocate - should get next port
      const result1 = await daemon.allocatePort({
        service_type: serviceType,
        service_name: 'test-ai-service',
        instance_id: 'instance-1'
      });

      expect(result1.port).toBe(11431);

      // Second allocation should return same port (singleton behavior)
      const result2 = await daemon.allocatePort({
        service_type: serviceType,
        service_name: 'test-ai-service-2',
        instance_id: 'instance-2'
      });

      expect(result2.port).toBe(11431);
      expect(result2.existing).toBe(true);

      // Cleanup
      testHelper.closeExternalServer(externalServer);
    });

    test('should work with auto-allocation', async () => {
      const serviceType = 'unknown-service-type-test';

      // Try to allocate unknown service type
      // Auto-allocation should kick in
      const result = await daemon.allocatePort({
        service_type: serviceType,
        service_name: 'test-service',
        instance_id: 'test-instance'
      });

      // Should succeed
      expect(result.port).toBeDefined();
      expect(result.auto_allocated).toBe(true);

      // Verify service type was added
      expect(daemon.serviceTypes[serviceType]).toBeDefined();
    });
  });
});
