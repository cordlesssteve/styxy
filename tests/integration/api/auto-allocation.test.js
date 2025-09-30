/**
 * Integration Tests for Auto-Allocation Feature (Feature #2)
 *
 * Tests the automatic allocation of port ranges for unknown service types.
 */

const request = require('supertest');
const fs = require('fs');
const path = require('path');
const StyxyDaemon = require('../../../src/daemon');

describe('Auto-Allocation Integration Tests', () => {
  let daemon;
  let app;
  let apiKey;
  const testPort = 9877;
  const testConfigDir = path.join(__dirname, '../../fixtures/test-config-auto-alloc');
  const userConfigFile = path.join(testConfigDir, 'config.json');
  const apiKeyFile = path.join(testConfigDir, 'auth.token');

  beforeAll(async () => {
    // Create test config directory
    if (!fs.existsSync(testConfigDir)) {
      fs.mkdirSync(testConfigDir, { recursive: true, mode: 0o700 });
    }

    // Enable auto-allocation for tests
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
        }
      }
    };

    fs.writeFileSync(userConfigFile, JSON.stringify(userConfig, null, 2));

    // Start daemon with test config
    daemon = new StyxyDaemon({
      port: testPort,
      configDir: testConfigDir
    });

    await daemon.start();
    app = daemon.app;

    // Load API key for authentication
    apiKey = fs.readFileSync(apiKeyFile, 'utf8').trim();
  });

  afterAll(async () => {
    if (daemon) {
      await daemon.stop();
    }

    // Cleanup test config directory
    if (fs.existsSync(testConfigDir)) {
      fs.rmSync(testConfigDir, { recursive: true, force: true });
    }
  });

  describe('Basic Auto-Allocation', () => {
    test('should auto-allocate port range for unknown service type', async () => {
      const response = await request(app)
        .post('/allocate').set('Authorization', `Bearer ${apiKey}`)
        .send({
          service_type: 'grafana',
          service_name: 'monitoring-grafana',
          instance_id: 'test-instance-1'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.port).toBeGreaterThanOrEqual(10000);
      expect(response.body.lock_id).toBeDefined();

      // Verify service type was added to config
      const config = JSON.parse(fs.readFileSync(userConfigFile, 'utf8'));
      expect(config.service_types).toBeDefined();
      expect(config.service_types.grafana).toBeDefined();
      expect(config.service_types.grafana.auto_allocated).toBe(true);
      expect(config.service_types.grafana.port_range).toHaveLength(2);
    });

    test('should reuse auto-allocated range for subsequent requests', async () => {
      // First request - auto-allocate
      const response1 = await request(app)
        .post('/allocate').set('Authorization', `Bearer ${apiKey}`)
        .send({
          service_type: 'jaeger',
          service_name: 'tracing-jaeger',
          instance_id: 'test-instance-2'
        });

      expect(response1.status).toBe(200);
      const port1 = response1.body.port;

      // Second request - should use the auto-allocated range
      const response2 = await request(app)
        .post('/allocate').set('Authorization', `Bearer ${apiKey}`)
        .send({
          service_type: 'jaeger',
          service_name: 'tracing-jaeger-2',
          instance_id: 'test-instance-3'
        });

      expect(response2.status).toBe(200);
      const port2 = response2.body.port;

      // Both ports should be in the same service type range
      const config = JSON.parse(fs.readFileSync(userConfigFile, 'utf8'));
      const [start, end] = config.service_types.jaeger.port_range;

      expect(port1).toBeGreaterThanOrEqual(start);
      expect(port1).toBeLessThanOrEqual(end);
      expect(port2).toBeGreaterThanOrEqual(start);
      expect(port2).toBeLessThanOrEqual(end);
    });
  });

  describe('Pattern-Based Rules', () => {
    test('should apply monitoring-* rule for chunk size', async () => {
      const response = await request(app)
        .post('/allocate').set('Authorization', `Bearer ${apiKey}`)
        .send({
          service_type: 'monitoring-prometheus',
          service_name: 'prometheus',
          instance_id: 'test-instance-4'
        });

      expect(response.status).toBe(200);

      // Verify service type uses chunk size from rule (20 ports)
      const config = JSON.parse(fs.readFileSync(userConfigFile, 'utf8'));
      const [start, end] = config.service_types['monitoring-prometheus'].port_range;
      const chunkSize = end - start + 1;

      expect(chunkSize).toBe(20); // From monitoring-* rule
    });
  });

  describe('Concurrent Auto-Allocation', () => {
    test('should handle concurrent requests for same unknown service type', async () => {
      // Send multiple concurrent requests for the same unknown service type
      const promises = [
        request(app).post('/allocate').set('Authorization', `Bearer ${apiKey}`).send({
          service_type: 'elasticsearch',
          service_name: 'search-1',
          instance_id: 'concurrent-1'
        }),
        request(app).post('/allocate').set('Authorization', `Bearer ${apiKey}`).send({
          service_type: 'elasticsearch',
          service_name: 'search-2',
          instance_id: 'concurrent-2'
        }),
        request(app).post('/allocate').set('Authorization', `Bearer ${apiKey}`).send({
          service_type: 'elasticsearch',
          service_name: 'search-3',
          instance_id: 'concurrent-3'
        })
      ];

      const responses = await Promise.all(promises);

      // All should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      });

      // All ports should be in the same range
      const config = JSON.parse(fs.readFileSync(userConfigFile, 'utf8'));
      const [start, end] = config.service_types.elasticsearch.port_range;

      responses.forEach(response => {
        const port = response.body.port;
        expect(port).toBeGreaterThanOrEqual(start);
        expect(port).toBeLessThanOrEqual(end);
      });

      // Service type should only be auto-allocated once
      expect(config.service_types.elasticsearch.auto_allocated).toBe(true);
    });
  });

  describe('Audit Logging', () => {
    test('should log auto-allocation events to audit log', async () => {
      const auditFile = path.join(testConfigDir, 'audit.log');

      // Perform an auto-allocation
      await request(app)
        .post('/allocate').set('Authorization', `Bearer ${apiKey}`)
        .send({
          service_type: 'clickhouse',
          service_name: 'analytics',
          instance_id: 'audit-test-1'
        });

      // Wait for audit log to be written
      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify audit log exists and contains the event
      expect(fs.existsSync(auditFile)).toBe(true);

      const auditContent = fs.readFileSync(auditFile, 'utf8');
      const auditLines = auditContent.trim().split('\n');
      const auditEvents = auditLines.map(line => JSON.parse(line));

      // Find the AUTO_ALLOCATION event
      const autoAllocEvent = auditEvents.find(
        event => event.action === 'AUTO_ALLOCATION' && event.serviceType === 'clickhouse'
      );

      expect(autoAllocEvent).toBeDefined();
      expect(autoAllocEvent.range).toHaveLength(2);
      expect(autoAllocEvent.chunkSize).toBe(10); // Default chunk size
      expect(autoAllocEvent.placement).toBe('after');
    });
  });
});
