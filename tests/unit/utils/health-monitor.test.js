/**
 * Unit tests for HealthMonitor (Feature #3, Phase 2)
 */

const HealthMonitor = require('../../../src/utils/health-monitor');
const { createTestHelper } = require('../../helpers/daemon-test-helper');

describe('HealthMonitor - Unit Tests', () => {
  let testHelper;
  let daemon;
  let healthMonitor;

  beforeEach(async () => {
    testHelper = createTestHelper();
    daemon = await testHelper.createDaemon();
    healthMonitor = daemon.healthMonitor;
  });

  afterEach(async () => {
    await testHelper.cleanup();
  });

  describe('Constructor', () => {
    test('should require daemon instance', () => {
      expect(() => new HealthMonitor()).toThrow('Daemon instance required');
    });

    test('should initialize with daemon config', () => {
      expect(healthMonitor.daemon).toBe(daemon);
      expect(healthMonitor.config).toBeDefined();
      expect(healthMonitor.monitoringActive).toBe(false);
    });

    test('should use default config when recovery config missing', async () => {
      const customDaemon = await testHelper.createDaemon();
      customDaemon.recoveryConfig = {};

      const monitor = new HealthMonitor(customDaemon);
      expect(monitor.config.enabled).toBe(false);
      expect(monitor.config.check_interval_ms).toBe(30000);
      expect(monitor.config.max_failures).toBe(3);
    });
  });

  describe('startMonitoring()', () => {
    test('should not start when disabled', async () => {
      await healthMonitor.startMonitoring();
      expect(healthMonitor.monitoringActive).toBe(false);
      expect(healthMonitor.monitoringTimer).toBeNull();
    });

    test('should start when enabled', async () => {
      // Enable health monitoring
      daemon.recoveryConfig.health_monitoring.enabled = true;

      await healthMonitor.startMonitoring();
      expect(healthMonitor.monitoringActive).toBe(true);
      expect(healthMonitor.monitoringTimer).not.toBeNull();
    });

    test('should not start twice', async () => {
      daemon.recoveryConfig.health_monitoring.enabled = true;

      await healthMonitor.startMonitoring();
      const firstTimer = healthMonitor.monitoringTimer;

      await healthMonitor.startMonitoring();
      expect(healthMonitor.monitoringTimer).toBe(firstTimer);
    });
  });

  describe('stopMonitoring()', () => {
    test('should stop active monitoring', async () => {
      daemon.recoveryConfig.health_monitoring.enabled = true;

      await healthMonitor.startMonitoring();
      expect(healthMonitor.monitoringActive).toBe(true);

      healthMonitor.stopMonitoring();
      expect(healthMonitor.monitoringActive).toBe(false);
      expect(healthMonitor.monitoringTimer).toBeNull();
      expect(healthMonitor.healthChecks.size).toBe(0);
    });

    test('should be safe to call when not monitoring', () => {
      expect(() => healthMonitor.stopMonitoring()).not.toThrow();
    });
  });

  describe('checkAllocation()', () => {
    test('should return true for healthy allocation with running process', async () => {
      const allocation = {
        port: 3000,
        process_id: process.pid, // Our own PID - definitely running
        serviceType: 'test'
      };

      // Mock port check to return false (port in use = healthy)
      jest.spyOn(daemon, 'checkPortActuallyAvailable').mockResolvedValue(false);

      const healthy = await healthMonitor.checkAllocation(allocation);
      expect(healthy).toBe(true);
    });

    test('should return false when process not found', async () => {
      const allocation = {
        port: 3000,
        process_id: 99999, // Non-existent PID
        serviceType: 'test'
      };

      const healthy = await healthMonitor.checkAllocation(allocation);
      expect(healthy).toBe(false);
    });

    test('should return false when port not in use', async () => {
      const allocation = {
        port: 3000,
        process_id: process.pid,
        serviceType: 'test'
      };

      // Mock port check to return true (port available = unhealthy)
      jest.spyOn(daemon, 'checkPortActuallyAvailable').mockResolvedValue(true);

      const healthy = await healthMonitor.checkAllocation(allocation);
      expect(healthy).toBe(false);
    });

    test('should consider allocation healthy when process exists but EPERM', async () => {
      const allocation = {
        port: 3000,
        process_id: 1, // System process, likely to get EPERM
        serviceType: 'test'
      };

      // Mock port check as in use
      jest.spyOn(daemon, 'checkPortActuallyAvailable').mockResolvedValue(false);

      // Should be healthy (process exists, port in use)
      const healthy = await healthMonitor.checkAllocation(allocation);
      expect(healthy).toBe(true);
    });
  });

  describe('handleUnhealthyAllocation()', () => {
    test('should increment failure count', async () => {
      const allocation = {
        port: 3000,
        lockId: 'test-lock',
        serviceType: 'test'
      };

      await healthMonitor.handleUnhealthyAllocation(allocation);

      const check = healthMonitor.healthChecks.get(3000);
      expect(check.failures).toBe(1);
    });

    test('should not cleanup before max failures', async () => {
      daemon.recoveryConfig.health_monitoring.max_failures = 3;
      daemon.recoveryConfig.health_monitoring.cleanup_stale_allocations = true;

      const allocation = {
        port: 3000,
        lockId: 'test-lock',
        serviceType: 'test'
      };

      // Fail twice (under max)
      await healthMonitor.handleUnhealthyAllocation(allocation);
      await healthMonitor.handleUnhealthyAllocation(allocation);

      expect(healthMonitor.healthChecks.has(3000)).toBe(true);
      expect(healthMonitor.healthChecks.get(3000).failures).toBe(2);
    });

    test('should cleanup after max failures when enabled', async () => {
      daemon.recoveryConfig.health_monitoring.max_failures = 3;
      daemon.recoveryConfig.health_monitoring.cleanup_stale_allocations = true;

      // Create a real allocation first
      await daemon.allocatePort({
        service_type: 'dev',
        service_name: 'test-service',
        instance_id: 'test-instance'
      });

      const allocation = Array.from(daemon.allocations.values())[0];

      // Mock releasePort to succeed
      jest.spyOn(daemon, 'releasePort').mockResolvedValue({
        success: true,
        port: allocation.port
      });

      // Fail 3 times (reach max)
      await healthMonitor.handleUnhealthyAllocation(allocation);
      await healthMonitor.handleUnhealthyAllocation(allocation);
      const cleaned = await healthMonitor.handleUnhealthyAllocation(allocation);

      expect(cleaned).toBe(true);
      expect(daemon.releasePort).toHaveBeenCalledWith(allocation.port, allocation.lockId);
      expect(healthMonitor.healthChecks.has(allocation.port)).toBe(false);
    });

    test('should not cleanup when disabled', async () => {
      daemon.recoveryConfig.health_monitoring.max_failures = 3;
      daemon.recoveryConfig.health_monitoring.cleanup_stale_allocations = false;

      const allocation = {
        port: 3000,
        lockId: 'test-lock',
        serviceType: 'test'
      };

      // Fail 3 times
      await healthMonitor.handleUnhealthyAllocation(allocation);
      await healthMonitor.handleUnhealthyAllocation(allocation);
      const cleaned = await healthMonitor.handleUnhealthyAllocation(allocation);

      expect(cleaned).toBe(false);
      expect(healthMonitor.healthChecks.has(3000)).toBe(true);
    });
  });

  describe('getStatistics()', () => {
    test('should return monitoring statistics', () => {
      const stats = healthMonitor.getStatistics();

      expect(stats).toHaveProperty('enabled');
      expect(stats).toHaveProperty('active');
      expect(stats).toHaveProperty('check_interval_ms');
      expect(stats).toHaveProperty('max_failures');
      expect(stats).toHaveProperty('total_allocations');
      expect(stats).toHaveProperty('tracked_allocations');
      expect(stats).toHaveProperty('failing_allocations');
      expect(stats).toHaveProperty('failing_details');
    });

    test('should show failing allocations', async () => {
      const allocation = {
        port: 3000,
        lockId: 'test-lock',
        serviceType: 'test'
      };

      await healthMonitor.handleUnhealthyAllocation(allocation);

      const stats = healthMonitor.getStatistics();
      expect(stats.failing_allocations).toBe(1);
      expect(stats.failing_details).toHaveLength(1);
      expect(stats.failing_details[0].port).toBe(3000);
      expect(stats.failing_details[0].failures).toBe(1);
    });
  });

  describe('destroy()', () => {
    test('should cleanup resources', async () => {
      daemon.recoveryConfig.health_monitoring.enabled = true;

      await healthMonitor.startMonitoring();
      expect(healthMonitor.monitoringActive).toBe(true);

      healthMonitor.destroy();
      expect(healthMonitor.monitoringActive).toBe(false);
      expect(healthMonitor.monitoringTimer).toBeNull();
    });
  });

  describe('Integration with Daemon', () => {
    test('should be initialized with daemon', () => {
      expect(daemon.healthMonitor).toBeDefined();
      expect(daemon.healthMonitor).toBeInstanceOf(HealthMonitor);
    });

    test('should use daemon recovery config', () => {
      expect(daemon.healthMonitor.config).toBe(daemon.recoveryConfig.health_monitoring);
    });
  });
});
