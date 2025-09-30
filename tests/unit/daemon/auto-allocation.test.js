/**
 * Unit Tests for Auto-Allocation Methods (Feature #2)
 */

const StyxyDaemon = require('../../../src/daemon');
const path = require('path');
const fs = require('fs');

describe('Auto-Allocation Unit Tests', () => {
  let daemon;
  const testConfigDir = path.join(__dirname, '../../fixtures/test-auto-alloc-unit');

  beforeEach(() => {
    // Create test config directory
    if (!fs.existsSync(testConfigDir)) {
      fs.mkdirSync(testConfigDir, { recursive: true, mode: 0o700 });
    }

    // Create test config with auto-allocation enabled
    const userConfig = {
      auto_allocation: {
        enabled: true,
        default_chunk_size: 10,
        placement: 'after',
        min_port: 10000,
        max_port: 65000,
        preserve_gaps: true,
        gap_size: 10
      },
      auto_allocation_rules: {
        'monitoring-*': {
          chunk_size: 20
        },
        'database-*': {
          chunk_size: 5
        },
        'test-*': {
          chunk_size: 15
        }
      }
    };

    fs.writeFileSync(
      path.join(testConfigDir, 'config.json'),
      JSON.stringify(userConfig, null, 2)
    );

    daemon = new StyxyDaemon({ configDir: testConfigDir });
  });

  afterEach(() => {
    // Cleanup daemon timers
    if (daemon) {
      if (daemon.metrics && daemon.metrics.resetTimer) {
        clearInterval(daemon.metrics.resetTimer);
      }
      if (daemon.circuitBreaker && daemon.circuitBreaker.monitoringInterval) {
        clearInterval(daemon.circuitBreaker.monitoringInterval);
      }
      if (daemon.rateLimiter && daemon.rateLimiter.cleanupInterval) {
        clearInterval(daemon.rateLimiter.cleanupInterval);
      }
    }

    // Cleanup
    if (fs.existsSync(testConfigDir)) {
      fs.rmSync(testConfigDir, { recursive: true, force: true });
    }
  });

  describe('getChunkSizeForServiceType', () => {
    test('should return default chunk size for unmatched service type', () => {
      const chunkSize = daemon.getChunkSizeForServiceType('unknown-service');
      expect(chunkSize).toBe(10); // default_chunk_size
    });

    test('should return 20 for monitoring-* pattern', () => {
      const chunkSize = daemon.getChunkSizeForServiceType('monitoring-grafana');
      expect(chunkSize).toBe(20);
    });

    test('should return 20 for any monitoring service', () => {
      expect(daemon.getChunkSizeForServiceType('monitoring-prometheus')).toBe(20);
      expect(daemon.getChunkSizeForServiceType('monitoring-datadog')).toBe(20);
      expect(daemon.getChunkSizeForServiceType('monitoring-newrelic')).toBe(20);
    });

    test('should return 5 for database-* pattern', () => {
      const chunkSize = daemon.getChunkSizeForServiceType('database-redis');
      expect(chunkSize).toBe(5);
    });

    test('should return 15 for test-* pattern', () => {
      const chunkSize = daemon.getChunkSizeForServiceType('test-service');
      expect(chunkSize).toBe(15);
    });

    test('should not match partial patterns', () => {
      const chunkSize = daemon.getChunkSizeForServiceType('my-monitoring');
      expect(chunkSize).toBe(10); // default, not 20
    });
  });

  describe('matchesPattern', () => {
    test('should match exact string without wildcard', () => {
      expect(daemon.matchesPattern('test', 'test')).toBe(true);
      expect(daemon.matchesPattern('test', 'testing')).toBe(false);
    });

    test('should match prefix wildcard pattern', () => {
      expect(daemon.matchesPattern('monitoring-grafana', 'monitoring-*')).toBe(true);
      expect(daemon.matchesPattern('monitoring-prometheus', 'monitoring-*')).toBe(true);
      expect(daemon.matchesPattern('grafana-monitoring', 'monitoring-*')).toBe(false);
    });

    test('should match suffix wildcard pattern', () => {
      expect(daemon.matchesPattern('grafana-service', '*-service')).toBe(true);
      expect(daemon.matchesPattern('prometheus-service', '*-service')).toBe(true);
      expect(daemon.matchesPattern('service-grafana', '*-service')).toBe(false);
    });

    test('should match middle wildcard pattern', () => {
      expect(daemon.matchesPattern('test-foo-service', 'test-*-service')).toBe(true);
      expect(daemon.matchesPattern('test-bar-baz-service', 'test-*-service')).toBe(true);
    });

    test('should match multiple wildcards', () => {
      expect(daemon.matchesPattern('a-b-c-d', 'a-*-c-*')).toBe(true);
      expect(daemon.matchesPattern('a-x-c-y', 'a-*-c-*')).toBe(true);
    });

    test('should handle empty strings', () => {
      expect(daemon.matchesPattern('', '')).toBe(true);
      expect(daemon.matchesPattern('test', '')).toBe(false);
      expect(daemon.matchesPattern('', 'test')).toBe(false);
    });
  });

  describe('handleAutoAllocation', () => {
    test('should throw error when auto-allocation is disabled', async () => {
      daemon.autoAllocationConfig.enabled = false;

      await expect(
        daemon.handleAutoAllocation('new-service', {})
      ).rejects.toThrow('auto-allocation is disabled');
    });

    test('should create new service type configuration', async () => {
      const result = await daemon.handleAutoAllocation('grafana', {
        userAgent: 'test',
        remoteIP: '127.0.0.1'
      });

      expect(result).toBeDefined();
      expect(result.range).toHaveLength(2);
      expect(result.range[0]).toBeGreaterThanOrEqual(10000);
      expect(result.range[1]).toBeGreaterThan(result.range[0]);
    });

    test('should reload service types after auto-allocation', async () => {
      const initialCount = Object.keys(daemon.serviceTypes).length;

      await daemon.handleAutoAllocation('new-test-service', {});

      expect(Object.keys(daemon.serviceTypes).length).toBe(initialCount + 1);
      expect(daemon.serviceTypes['new-test-service']).toBeDefined();
    });

    test('should apply pattern-based chunk size', async () => {
      await daemon.handleAutoAllocation('monitoring-jaeger', {});

      const serviceConfig = daemon.serviceTypes['monitoring-jaeger'];
      const chunkSize = serviceConfig.range[1] - serviceConfig.range[0] + 1;

      expect(chunkSize).toBe(20); // monitoring-* rule
    });

    test('should handle concurrent requests for same service type', async () => {
      // Start two concurrent auto-allocations for the same service
      const promise1 = daemon.handleAutoAllocation('concurrent-service', {});
      const promise2 = daemon.handleAutoAllocation('concurrent-service', {});

      const [result1, result2] = await Promise.all([promise1, promise2]);

      // Both should succeed and return the same configuration
      expect(result1.range).toEqual(result2.range);
    });

    test('should wait for concurrent auto-allocation to complete', async () => {
      const results = [];

      // Start multiple concurrent requests
      const promises = [
        daemon.handleAutoAllocation('wait-service', {}).then(r => results.push('request1')),
        daemon.handleAutoAllocation('wait-service', {}).then(r => results.push('request2')),
        daemon.handleAutoAllocation('wait-service', {}).then(r => results.push('request3'))
      ];

      await Promise.all(promises);

      // All should complete successfully
      expect(results).toHaveLength(3);
      expect(daemon.serviceTypes['wait-service']).toBeDefined();
    });
  });

  describe('Auto-Allocation State Management', () => {
    test('should track auto-allocation in progress', () => {
      expect(daemon.autoAllocationInProgress).toBeDefined();
      expect(daemon.autoAllocationInProgress.size).toBe(0);
    });

    test('should clean up in-progress marker after completion', async () => {
      await daemon.handleAutoAllocation('cleanup-test', {});

      // Should not be in progress anymore
      expect(daemon.autoAllocationInProgress.has('cleanup-test')).toBe(false);
    });

    test('should clean up in-progress marker after error', async () => {
      daemon.autoAllocationConfig.enabled = false;

      try {
        await daemon.handleAutoAllocation('error-test', {});
      } catch (error) {
        // Expected to fail
      }

      // Should not be in progress anymore
      expect(daemon.autoAllocationInProgress.has('error-test')).toBe(false);
    });
  });

  describe('ConfigWriter Integration', () => {
    test('should have ConfigWriter instance', () => {
      expect(daemon.configWriter).toBeDefined();
      expect(daemon.configWriter.addServiceType).toBeDefined();
    });

    test('should write to user config file', async () => {
      await daemon.handleAutoAllocation('write-test', {});

      const userConfigFile = path.join(testConfigDir, 'config.json');
      expect(fs.existsSync(userConfigFile)).toBe(true);

      const config = JSON.parse(fs.readFileSync(userConfigFile, 'utf8'));
      expect(config.service_types).toBeDefined();
      expect(config.service_types['write-test']).toBeDefined();
      expect(config.service_types['write-test'].auto_allocated).toBe(true);
    });

    test('should create backup before modification', async () => {
      await daemon.handleAutoAllocation('backup-test', {});

      const backupDir = path.join(testConfigDir, 'config-backups');
      expect(fs.existsSync(backupDir)).toBe(true);

      const backups = fs.readdirSync(backupDir).filter(f => f.startsWith('config-'));
      expect(backups.length).toBeGreaterThan(0);
    });
  });

  describe('AuditLogger Integration', () => {
    test('should have AuditLogger instance', () => {
      expect(daemon.auditLogger).toBeDefined();
      expect(daemon.auditLogger.log).toBeDefined();
    });

    test('should log auto-allocation event', async () => {
      await daemon.handleAutoAllocation('audit-test', {
        userAgent: 'test-agent',
        remoteIP: '192.168.1.1'
      });

      // Wait for log to be written
      await new Promise(resolve => setTimeout(resolve, 100));

      const auditFile = path.join(testConfigDir, 'audit.log');
      expect(fs.existsSync(auditFile)).toBe(true);

      const content = fs.readFileSync(auditFile, 'utf8');
      expect(content).toContain('AUTO_ALLOCATION');
      expect(content).toContain('audit-test');
    });

    test('should include context in audit log', async () => {
      await daemon.handleAutoAllocation('context-test', {
        userAgent: 'Mozilla/5.0',
        remoteIP: '10.0.0.1'
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      const auditFile = path.join(testConfigDir, 'audit.log');
      const content = fs.readFileSync(auditFile, 'utf8');
      const lines = content.trim().split('\n');
      const lastEvent = JSON.parse(lines[lines.length - 1]);

      expect(lastEvent.action).toBe('AUTO_ALLOCATION');
      expect(lastEvent.serviceType).toBe('context-test');
      expect(lastEvent.userAgent).toBe('Mozilla/5.0');
      expect(lastEvent.remoteIP).toBe('10.0.0.1');
    });
  });

  describe('Metrics Integration', () => {
    test('should increment auto_allocations_total counter', async () => {
      // Get initial count (using correct metric key format)
      const initialMetrics = daemon.metrics.getMetrics();
      const metricKey = 'auto_allocations_total{service_type="metrics-test"}';
      const initialCount = initialMetrics.counters[metricKey] || 0;

      await daemon.handleAutoAllocation('metrics-test', {});

      // Check that count increased
      const finalMetrics = daemon.metrics.getMetrics();
      const finalCount = finalMetrics.counters[metricKey] || 0;

      expect(finalCount).toBe(initialCount + 1);
    });

    test('should increment error counter on allocation failure', async () => {
      // Force an error by making the port range invalid
      const originalConfig = daemon.autoAllocationConfig;
      daemon.autoAllocationConfig = {
        ...originalConfig,
        max_port: 10001, // Very small range that will fail
        min_port: 10000
      };

      // Get initial count (using correct metric key format)
      const initialMetrics = daemon.metrics.getMetrics();
      const metricKey = 'auto_allocation_errors_total{service_type="error-alloc-test"}';
      const initialErrorCount = initialMetrics.counters[metricKey] || 0;

      try {
        await daemon.handleAutoAllocation('error-alloc-test', {});
        fail('Should have thrown an error');
      } catch (error) {
        // Expected to fail due to insufficient port range
      }

      const finalMetrics = daemon.metrics.getMetrics();
      const finalErrorCount = finalMetrics.counters[metricKey] || 0;

      expect(finalErrorCount).toBe(initialErrorCount + 1);

      // Restore original config
      daemon.autoAllocationConfig = originalConfig;
    });
  });
});
