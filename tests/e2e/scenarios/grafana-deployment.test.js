/**
 * E2E Test: Grafana Deployment Scenario (Feature #2)
 *
 * Real-world scenario: User wants to deploy Grafana for monitoring,
 * but it's not in the predefined service types. Auto-allocation should
 * automatically allocate a port range for it.
 */

const request = require('supertest');
const fs = require('fs');
const path = require('path');
const StyxyDaemon = require('../../../src/daemon');

describe('E2E: Grafana Deployment Scenario', () => {
  let daemon;
  let app;
  let apiKey;
  const testPort = 9878;
  const testConfigDir = path.join(__dirname, '../../fixtures/test-grafana-e2e');
  const userConfigFile = path.join(testConfigDir, 'config.json');
  const apiKeyFile = path.join(testConfigDir, 'auth.token');

  beforeAll(async () => {
    // Create test config directory
    if (!fs.existsSync(testConfigDir)) {
      fs.mkdirSync(testConfigDir, { recursive: true, mode: 0o700 });
    }

    // Enable auto-allocation for Grafana scenario
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
          chunk_size: 20  // Monitoring tools get 20 ports
        }
      }
    };

    fs.writeFileSync(userConfigFile, JSON.stringify(userConfig, null, 2));

    // Start daemon
    daemon = new StyxyDaemon({
      port: testPort,
      configDir: testConfigDir
    });

    await daemon.start();
    app = daemon.app;

    // Load API key
    apiKey = fs.readFileSync(apiKeyFile, 'utf8').trim();
  });

  afterAll(async () => {
    if (daemon) {
      await daemon.stop();
    }

    // Cleanup
    if (fs.existsSync(testConfigDir)) {
      fs.rmSync(testConfigDir, { recursive: true, force: true });
    }
  });

  describe('Scenario: First-time Grafana deployment', () => {
    test('Step 1: User requests Grafana port (unknown service type)', async () => {
      const response = await request(app)
        .post('/allocate')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          service_type: 'grafana',
          service_name: 'grafana-main',
          instance_id: 'production'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Should have auto-allocated
      expect(response.body.auto_allocated).toBe(true);
      expect(response.body.allocated_range).toHaveLength(2);
      expect(response.body.chunk_size).toBe(10); // default chunk size
      expect(response.body.port).toBeGreaterThanOrEqual(10000);

      // Store for next test
      this.grafanaPort = response.body.port;
      this.grafanaLockId = response.body.lock_id;
      this.grafanaRange = response.body.allocated_range;
    });

    test('Step 2: Verify Grafana service type was added to config', () => {
      const config = JSON.parse(fs.readFileSync(userConfigFile, 'utf8'));

      expect(config.service_types).toBeDefined();
      expect(config.service_types.grafana).toBeDefined();
      expect(config.service_types.grafana.auto_allocated).toBe(true);
      expect(config.service_types.grafana.port_range).toEqual(this.grafanaRange);
      expect(config.service_types.grafana.description).toContain('Auto-allocated');
    });

    test('Step 3: Second Grafana instance uses the allocated range', async () => {
      const response = await request(app)
        .post('/allocate')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          service_type: 'grafana',
          service_name: 'grafana-dev',
          instance_id: 'development'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Should NOT auto-allocate again (range already exists)
      expect(response.body.auto_allocated).toBeUndefined();

      // Should be in the same range
      expect(response.body.port).toBeGreaterThanOrEqual(this.grafanaRange[0]);
      expect(response.body.port).toBeLessThanOrEqual(this.grafanaRange[1]);
      expect(response.body.port).not.toBe(this.grafanaPort); // Different port
    });

    test('Step 4: Multiple Grafana instances can coexist', async () => {
      const instances = ['staging', 'testing', 'backup'];
      const ports = [];

      for (const instance of instances) {
        const response = await request(app)
          .post('/allocate')
          .set('Authorization', `Bearer ${apiKey}`)
          .send({
            service_type: 'grafana',
            service_name: `grafana-${instance}`,
            instance_id: instance
          });

        expect(response.status).toBe(200);
        ports.push(response.body.port);
      }

      // All ports should be unique
      const uniquePorts = new Set(ports);
      expect(uniquePorts.size).toBe(ports.length);

      // All should be in the allocated range
      ports.forEach(port => {
        expect(port).toBeGreaterThanOrEqual(this.grafanaRange[0]);
        expect(port).toBeLessThanOrEqual(this.grafanaRange[1]);
      });
    });
  });

  describe('Scenario: Adding Prometheus to existing Grafana setup', () => {
    test('Step 1: Allocate Prometheus (monitoring-* pattern)', async () => {
      const response = await request(app)
        .post('/allocate')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          service_type: 'monitoring-prometheus',
          service_name: 'prometheus-main',
          instance_id: 'production'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Should auto-allocate with monitoring-* rule (20 ports)
      expect(response.body.auto_allocated).toBe(true);
      expect(response.body.chunk_size).toBe(20);

      this.prometheusRange = response.body.allocated_range;
    });

    test('Step 2: Prometheus and Grafana ranges do not overlap', () => {
      const grafanaStart = this.grafanaRange[0];
      const grafanaEnd = this.grafanaRange[1];
      const prometheusStart = this.prometheusRange[0];
      const prometheusEnd = this.prometheusRange[1];

      // Check no overlap
      const noOverlap = (grafanaEnd < prometheusStart) || (prometheusEnd < grafanaStart);
      expect(noOverlap).toBe(true);
    });

    test('Step 3: Gap is preserved between ranges', () => {
      const grafanaEnd = this.grafanaRange[1];
      const prometheusStart = this.prometheusRange[0];

      if (grafanaEnd < prometheusStart) {
        const gap = prometheusStart - grafanaEnd - 1;
        expect(gap).toBeGreaterThanOrEqual(10); // preserve_gaps with gap_size 10
      }
    });
  });

  describe('Scenario: Audit trail verification', () => {
    test('Should have audit log entries for all auto-allocations', async () => {
      const auditFile = path.join(testConfigDir, 'audit.log');

      // Wait for audit logs to flush
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(fs.existsSync(auditFile)).toBe(true);

      const content = fs.readFileSync(auditFile, 'utf8');
      const lines = content.trim().split('\n');
      const events = lines.map(line => JSON.parse(line));

      // Should have at least 2 AUTO_ALLOCATION events (grafana, prometheus)
      const autoAllocEvents = events.filter(e => e.action === 'AUTO_ALLOCATION');
      expect(autoAllocEvents.length).toBeGreaterThanOrEqual(2);

      // Verify Grafana event
      const grafanaEvent = autoAllocEvents.find(e => e.serviceType === 'grafana');
      expect(grafanaEvent).toBeDefined();
      expect(grafanaEvent.range).toEqual(this.grafanaRange);
      expect(grafanaEvent.chunkSize).toBe(10);

      // Verify Prometheus event
      const prometheusEvent = autoAllocEvents.find(e => e.serviceType === 'monitoring-prometheus');
      expect(prometheusEvent).toBeDefined();
      expect(prometheusEvent.range).toEqual(this.prometheusRange);
      expect(prometheusEvent.chunkSize).toBe(20);
    });
  });

  describe('Scenario: Config backup verification', () => {
    test('Should have created backups before each auto-allocation', () => {
      const backupDir = path.join(testConfigDir, 'config-backups');
      expect(fs.existsSync(backupDir)).toBe(true);

      const backups = fs.readdirSync(backupDir)
        .filter(f => f.startsWith('config-') && f.endsWith('.json'));

      // Should have at least 2 backups (one for each auto-allocation)
      expect(backups.length).toBeGreaterThanOrEqual(2);

      // Each backup should be valid JSON
      backups.forEach(backupFile => {
        const backupPath = path.join(backupDir, backupFile);
        const content = fs.readFileSync(backupPath, 'utf8');
        expect(() => JSON.parse(content)).not.toThrow();
      });
    });
  });

  describe('Scenario: Daemon restart persistence', () => {
    test('Auto-allocated service types persist after daemon restart', async () => {
      // Stop daemon
      await daemon.stop();

      // Start new daemon with same config
      daemon = new StyxyDaemon({
        port: testPort,
        configDir: testConfigDir
      });

      await daemon.start();
      app = daemon.app;

      // Reload API key
      apiKey = fs.readFileSync(apiKeyFile, 'utf8').trim();

      // Try to allocate Grafana again
      const response = await request(app)
        .post('/allocate')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          service_type: 'grafana',
          service_name: 'grafana-after-restart',
          instance_id: 'test'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Should NOT auto-allocate (already exists from before restart)
      expect(response.body.auto_allocated).toBeUndefined();

      // Should use the same range
      expect(response.body.port).toBeGreaterThanOrEqual(this.grafanaRange[0]);
      expect(response.body.port).toBeLessThanOrEqual(this.grafanaRange[1]);
    });
  });
});
