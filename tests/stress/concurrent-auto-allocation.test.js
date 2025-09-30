/**
 * Stress Test: Concurrent Auto-Allocation (Feature #2)
 *
 * Tests system behavior under heavy concurrent load with multiple
 * unknown service types being allocated simultaneously.
 */

const request = require('supertest');
const fs = require('fs');
const path = require('path');
const StyxyDaemon = require('../../src/daemon');

describe('Stress Test: Concurrent Auto-Allocation', () => {
  let daemon;
  let app;
  let apiKey;
  const testPort = 9879;
  const testConfigDir = path.join(__dirname, '../fixtures/test-stress-auto-alloc');
  const userConfigFile = path.join(testConfigDir, 'config.json');
  const apiKeyFile = path.join(testConfigDir, 'auth.token');

  beforeAll(async () => {
    // Create test config directory
    if (!fs.existsSync(testConfigDir)) {
      fs.mkdirSync(testConfigDir, { recursive: true, mode: 0o700 });
    }

    // Enable auto-allocation
    const userConfig = {
      auto_allocation: {
        enabled: true,
        default_chunk_size: 10,
        placement: 'after',
        min_port: 10000,
        max_port: 65000,
        preserve_gaps: true,
        gap_size: 10
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

  describe('10 Concurrent Unknown Services', () => {
    test('should handle 10 different unknown service types concurrently', async () => {
      const serviceTypes = [
        'clickhouse',
        'influxdb',
        'timescaledb',
        'cockroachdb',
        'cassandra',
        'scylladb',
        'yugabytedb',
        'neo4j',
        'arangodb',
        'dgraph'
      ];

      const startTime = Date.now();

      // Send all requests concurrently
      const promises = serviceTypes.map(serviceType =>
        request(app)
          .post('/allocate')
          .set('Authorization', `Bearer ${apiKey}`)
          .send({
            service_type: serviceType,
            service_name: `${serviceType}-instance`,
            instance_id: 'concurrent-test'
          })
      );

      const responses = await Promise.all(promises);
      const endTime = Date.now();
      const duration = endTime - startTime;

      // All requests should succeed
      responses.forEach((response, index) => {
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.port).toBeDefined();
      });

      // Performance check: Should complete in reasonable time (< 5 seconds)
      expect(duration).toBeLessThan(5000);

      console.log(`✅ Allocated 10 concurrent services in ${duration}ms`);
    }, 10000); // 10 second timeout

    test('all allocated ranges should not overlap', async () => {
      const config = JSON.parse(fs.readFileSync(userConfigFile, 'utf8'));
      const serviceTypes = config.service_types;

      const ranges = Object.entries(serviceTypes)
        .filter(([_, config]) => config.auto_allocated)
        .map(([name, config]) => ({
          name,
          start: config.port_range[0],
          end: config.port_range[1]
        }));

      // Check all pairs for overlaps
      for (let i = 0; i < ranges.length; i++) {
        for (let j = i + 1; j < ranges.length; j++) {
          const a = ranges[i];
          const b = ranges[j];

          const noOverlap = (a.end < b.start) || (b.end < a.start);

          if (!noOverlap) {
            fail(`Range overlap detected: ${a.name} (${a.start}-${a.end}) overlaps with ${b.name} (${b.start}-${b.end})`);
          }
        }
      }

      console.log(`✅ Verified ${ranges.length} ranges with no overlaps`);
    });

    test('gaps should be preserved between ranges', async () => {
      const config = JSON.parse(fs.readFileSync(userConfigFile, 'utf8'));
      const serviceTypes = config.service_types;

      const ranges = Object.entries(serviceTypes)
        .filter(([_, config]) => config.auto_allocated)
        .map(([name, config]) => ({
          name,
          start: config.port_range[0],
          end: config.port_range[1]
        }))
        .sort((a, b) => a.start - b.start);

      // Check gaps between consecutive ranges
      let gapViolations = 0;
      for (let i = 0; i < ranges.length - 1; i++) {
        const current = ranges[i];
        const next = ranges[i + 1];
        const gap = next.start - current.end - 1;

        if (gap < 10) {
          console.warn(`⚠️  Gap between ${current.name} and ${next.name}: ${gap} ports (expected >= 10)`);
          gapViolations++;
        }
      }

      expect(gapViolations).toBe(0);
      console.log(`✅ All gaps between ranges are >= 10 ports`);
    });
  });

  describe('30 Concurrent Requests for Same Service Type', () => {
    test('should handle burst of requests for same unknown service', async () => {
      const serviceType = 'burst-test-service';
      const requestCount = 30;

      const startTime = Date.now();

      // Send all requests concurrently
      const promises = Array.from({ length: requestCount }, (_, i) =>
        request(app)
          .post('/allocate')
          .set('Authorization', `Bearer ${apiKey}`)
          .send({
            service_type: serviceType,
            service_name: `burst-instance-${i}`,
            instance_id: `burst-${i}`
          })
      );

      const responses = await Promise.all(promises);
      const endTime = Date.now();
      const duration = endTime - startTime;

      // All requests should succeed
      responses.forEach((response, index) => {
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.port).toBeDefined();
      });

      // Only the first request should have auto_allocated flag
      const autoAllocatedCount = responses.filter(r => r.body.auto_allocated).length;
      expect(autoAllocatedCount).toBe(1);

      // All ports should be unique
      const ports = responses.map(r => r.body.port);
      const uniquePorts = new Set(ports);
      expect(uniquePorts.size).toBe(requestCount);

      // Service type should only be allocated once in config
      const config = JSON.parse(fs.readFileSync(userConfigFile, 'utf8'));
      expect(config.service_types[serviceType]).toBeDefined();
      expect(config.service_types[serviceType].auto_allocated).toBe(true);

      console.log(`✅ Handled ${requestCount} concurrent requests in ${duration}ms`);
      console.log(`   Average: ${(duration / requestCount).toFixed(2)}ms per request`);
    }, 15000); // 15 second timeout
  });

  describe('Mixed: Known and Unknown Services', () => {
    test('should handle mix of known and unknown services concurrently', async () => {
      const requests = [
        // Known service types (from CORE config)
        { service_type: 'dev', service_name: 'react-app', instance_id: 'mixed-1' },
        { service_type: 'api', service_name: 'express-api', instance_id: 'mixed-2' },
        { service_type: 'database', service_name: 'postgres', instance_id: 'mixed-3' },

        // Unknown service types (will auto-allocate)
        { service_type: 'vector-db', service_name: 'milvus', instance_id: 'mixed-4' },
        { service_type: 'feature-store', service_name: 'feast', instance_id: 'mixed-5' },
        { service_type: 'mlflow', service_name: 'experiment-tracking', instance_id: 'mixed-6' },
        { service_type: 'airflow', service_name: 'workflow-orchestration', instance_id: 'mixed-7' }
      ];

      const promises = requests.map(req =>
        request(app)
          .post('/allocate')
          .set('Authorization', `Bearer ${apiKey}`)
          .send(req)
      );

      const responses = await Promise.all(promises);

      // All should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      });

      // Known services should not have auto_allocated flag
      expect(responses[0].body.auto_allocated).toBeUndefined(); // dev
      expect(responses[1].body.auto_allocated).toBeUndefined(); // api
      expect(responses[2].body.auto_allocated).toBeUndefined(); // database

      // Unknown services should have auto_allocated flag
      expect(responses[3].body.auto_allocated).toBe(true); // vector-db
      expect(responses[4].body.auto_allocated).toBe(true); // feature-store
      expect(responses[5].body.auto_allocated).toBe(true); // mlflow
      expect(responses[6].body.auto_allocated).toBe(true); // airflow

      console.log('✅ Successfully handled mixed known/unknown services');
    });
  });

  describe('Resource Usage Verification', () => {
    test('should maintain reasonable memory usage', () => {
      const memUsage = process.memoryUsage();
      const heapUsedMB = memUsage.heapUsed / 1024 / 1024;

      // Should not exceed 200MB for stress test
      expect(heapUsedMB).toBeLessThan(200);

      console.log(`📊 Memory usage: ${heapUsedMB.toFixed(2)} MB`);
    });

    test('should have reasonable allocation count', () => {
      const allocations = daemon.allocations.size;
      console.log(`📊 Total allocations: ${allocations}`);

      // Should have allocated many ports
      expect(allocations).toBeGreaterThan(30);
    });

    test('should have reasonable config file size', () => {
      const stats = fs.statSync(userConfigFile);
      const sizeMB = stats.size / 1024 / 1024;

      // Config file should not be unreasonably large
      expect(sizeMB).toBeLessThan(1); // Less than 1MB

      console.log(`📊 Config file size: ${(stats.size / 1024).toFixed(2)} KB`);
    });
  });

  describe('Audit Log Verification', () => {
    test('should have logged all auto-allocation events', async () => {
      const auditFile = path.join(testConfigDir, 'audit.log');

      // Wait for logs to flush
      await new Promise(resolve => setTimeout(resolve, 500));

      expect(fs.existsSync(auditFile)).toBe(true);

      const content = fs.readFileSync(auditFile, 'utf8');
      const lines = content.trim().split('\n');
      const events = lines.map(line => JSON.parse(line));

      const autoAllocEvents = events.filter(e => e.action === 'AUTO_ALLOCATION');

      // Should have many auto-allocation events
      expect(autoAllocEvents.length).toBeGreaterThan(10);

      console.log(`📊 Auto-allocation events logged: ${autoAllocEvents.length}`);
    });
  });
});
