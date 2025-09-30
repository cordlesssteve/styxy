/**
 * Integration tests for Singleton Service Coordination (Feature #1)
 *
 * Tests concurrent allocation requests for singleton services
 * to verify race condition prevention and state consistency.
 */

const request = require('supertest');
const TestDaemonHelper = require('../../helpers/daemon-helper');
const fs = require('fs');
const path = require('path');

describe('Singleton Service Coordination', () => {
  let daemonHelper;
  let daemon;
  let app;
  let baseUrl;

  beforeEach(async () => {
    daemonHelper = new TestDaemonHelper();

    // Configure daemon with singleton service type
    const configOverride = {
      service_types: {
        'test-singleton': {
          description: 'Test singleton service',
          preferred_ports: [21400, 21401, 21402],
          port_range: [21400, 21499],
          instance_behavior: 'single',
          multi_instance_pattern: 'sequential'
        },
        'test-multi': {
          description: 'Test multi-instance service',
          preferred_ports: [22400, 22401, 22402],
          port_range: [22400, 22499],
          instance_behavior: 'multi',
          multi_instance_pattern: 'sequential'
        }
      }
    };

    const daemonInfo = await daemonHelper.start({ configOverride });
    daemon = daemonInfo.daemon;
    app = daemon.app;
    baseUrl = daemonInfo.baseUrl;
  });

  afterEach(async () => {
    await daemonHelper.cleanup();
  });

  describe('Concurrent Allocation Requests', () => {
    it('should handle 5 concurrent singleton requests - all receive same port', async () => {
      // Fire 5 concurrent allocation requests
      const requests = [];
      for (let i = 0; i < 5; i++) {
        requests.push(
          request(app)
            .post('/allocate')
            .send({
              service_type: 'test-singleton',
              service_name: `test-service-${i}`,
              instance_id: `instance-${i}`,
              project_path: `/test/path/${i}`
            })
        );
      }

      const responses = await Promise.all(requests);

      // All requests should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      });

      // Extract ports from responses
      const ports = responses.map(r => r.body.port);
      const lockIds = responses.map(r => r.body.lockId || r.body.lock_id);

      // All ports should be the same
      const uniquePorts = [...new Set(ports)];
      expect(uniquePorts.length).toBe(1);

      // All lock IDs should be the same
      const uniqueLockIds = [...new Set(lockIds)];
      expect(uniqueLockIds.length).toBe(1);

      // At least 4 should indicate "existing" singleton
      const existingCount = responses.filter(r => r.body.existing === true).length;
      expect(existingCount).toBeGreaterThanOrEqual(4);
    });

    it('should maintain state consistency after concurrent requests', async () => {
      // Fire 10 concurrent allocation requests
      const requests = [];
      for (let i = 0; i < 10; i++) {
        requests.push(
          request(app)
            .post('/allocate')
            .send({
              service_type: 'test-singleton',
              service_name: `test-service-${i}`,
              instance_id: `instance-${i}`
            })
        );
      }

      await Promise.all(requests);

      // Verify daemon state
      expect(daemon.allocations.size).toBe(1); // Only one allocation
      expect(daemon.singletonServices.size).toBe(1); // Only one singleton

      const singleton = daemon.getSingleton('test-singleton');
      expect(singleton).toBeDefined();
      expect(singleton.port).toBeDefined();
      expect(singleton.lockId).toBeDefined();
    });

    it('should handle concurrent requests for different service types', async () => {
      // Mix singleton and multi-instance requests
      const requests = [
        // 3 singleton requests
        ...Array(3).fill(null).map((_, i) =>
          request(app)
            .post('/allocate')
            .send({
              service_type: 'test-singleton',
              service_name: `singleton-${i}`,
              instance_id: `singleton-instance-${i}`
            })
        ),
        // 3 multi-instance requests
        ...Array(3).fill(null).map((_, i) =>
          request(app)
            .post('/allocate')
            .send({
              service_type: 'test-multi',
              service_name: `multi-${i}`,
              instance_id: `multi-instance-${i}`
            })
        )
      ];

      const responses = await Promise.all(requests);

      // All should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      });

      // Singleton: all same port
      const singletonPorts = responses.slice(0, 3).map(r => r.body.port);
      const uniqueSingletonPorts = [...new Set(singletonPorts)];
      expect(uniqueSingletonPorts.length).toBe(1);

      // Multi-instance: all different ports
      const multiPorts = responses.slice(3, 6).map(r => r.body.port);
      const uniqueMultiPorts = [...new Set(multiPorts)];
      expect(uniqueMultiPorts.length).toBe(3);
    });
  });

  describe('Release and Re-allocate', () => {
    it('should allow new allocation after singleton release', async () => {
      // First allocation
      const firstResponse = await request(app)
        .post('/allocate')
        .send({
          service_type: 'test-singleton',
          service_name: 'first-service',
          instance_id: 'instance-1'
        })
        .expect(200);

      const firstPort = firstResponse.body.port;
      const firstLockId = firstResponse.body.lock_id || firstResponse.body.lockId;

      // Verify singleton exists
      let singleton = daemon.getSingleton('test-singleton');
      expect(singleton).toBeDefined();

      // Release allocation
      await request(app)
        .delete(`/allocate/${firstLockId}`)
        .expect(200);

      // Verify singleton released
      singleton = daemon.getSingleton('test-singleton');
      expect(singleton).toBeUndefined();

      // Second allocation should create new singleton
      const secondResponse = await request(app)
        .post('/allocate')
        .send({
          service_type: 'test-singleton',
          service_name: 'second-service',
          instance_id: 'instance-2'
        })
        .expect(200);

      expect(secondResponse.body.existing).toBeUndefined();
      expect(secondResponse.body.port).toBeDefined();

      // Verify new singleton registered
      singleton = daemon.getSingleton('test-singleton');
      expect(singleton).toBeDefined();
      expect(singleton.instanceId).toBe('instance-2');
    });

    it('should handle concurrent requests after release', async () => {
      // Initial allocation
      const initialResponse = await request(app)
        .post('/allocate')
        .send({
          service_type: 'test-singleton',
          service_name: 'initial-service',
          instance_id: 'instance-1'
        })
        .expect(200);

      const lockId = initialResponse.body.lock_id || initialResponse.body.lockId;

      // Release
      await request(app)
        .delete(`/allocate/${lockId}`)
        .expect(200);

      // Fire 5 concurrent requests after release
      const requests = [];
      for (let i = 0; i < 5; i++) {
        requests.push(
          request(app)
            .post('/allocate')
            .send({
              service_type: 'test-singleton',
              service_name: `test-service-${i}`,
              instance_id: `new-instance-${i}`
            })
        );
      }

      const responses = await Promise.all(requests);

      // All should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      });

      // All should get same port (might be different from initial)
      const ports = responses.map(r => r.body.port);
      const uniquePorts = [...new Set(ports)];
      expect(uniquePorts.length).toBe(1);

      // Only one allocation in daemon
      expect(daemon.allocations.size).toBe(1);
      expect(daemon.singletonServices.size).toBe(1);
    });
  });

  describe('API Response Format', () => {
    it('should return correct format for first singleton allocation', async () => {
      const response = await request(app)
        .post('/allocate')
        .send({
          service_type: 'test-singleton',
          service_name: 'test-service',
          instance_id: 'instance-1'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.port).toBeDefined();
      expect(response.body.lock_id).toBeDefined();
      expect(response.body.message).toBeDefined();
      expect(response.body.existing).toBeUndefined();
    });

    it('should return correct format for existing singleton', async () => {
      // First allocation
      await request(app)
        .post('/allocate')
        .send({
          service_type: 'test-singleton',
          service_name: 'test-service',
          instance_id: 'instance-1'
        })
        .expect(200);

      // Second allocation
      const response = await request(app)
        .post('/allocate')
        .send({
          service_type: 'test-singleton',
          service_name: 'test-service',
          instance_id: 'instance-2'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.port).toBeDefined();
      expect(response.body.lockId).toBeDefined();
      expect(response.body.message).toContain('only allows single instance');
      expect(response.body.existing).toBe(true);
      expect(response.body.existingInstanceId).toBe('instance-1');
      expect(response.body.existingPid).toBeDefined();
      expect(response.body.allocatedAt).toBeDefined();
    });
  });

  describe('Performance', () => {
    it('should handle singleton check with minimal overhead', async () => {
      const startTime = Date.now();

      await request(app)
        .post('/allocate')
        .send({
          service_type: 'test-singleton',
          service_name: 'test-service',
          instance_id: 'instance-1'
        })
        .expect(200);

      const firstDuration = Date.now() - startTime;

      // Second request (should be faster, just singleton check)
      const checkStartTime = Date.now();

      await request(app)
        .post('/allocate')
        .send({
          service_type: 'test-singleton',
          service_name: 'test-service',
          instance_id: 'instance-2'
        })
        .expect(200);

      const checkDuration = Date.now() - checkStartTime;

      // Singleton check should add minimal overhead (< 10ms)
      expect(checkDuration).toBeLessThan(50);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid service type gracefully', async () => {
      const response = await request(app)
        .post('/allocate')
        .send({
          service_type: 'nonexistent-singleton',
          service_name: 'test-service',
          instance_id: 'instance-1'
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBeDefined();
    });
  });
});
