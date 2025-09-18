/**
 * Integration tests for port allocation API endpoints
 */

const request = require('supertest');
const TestDaemonHelper = require('../../helpers/daemon-helper');
const TestPortHelper = require('../../helpers/port-helper');

describe('Port Allocation API', () => {
  let daemonHelper;
  let daemon;
  let app;
  let baseUrl;

  beforeEach(async () => {
    daemonHelper = new TestDaemonHelper();
    const daemonInfo = await daemonHelper.start();
    daemon = daemonInfo.daemon;
    app = daemon.app;
    baseUrl = daemonInfo.baseUrl;
  });

  afterEach(async () => {
    await daemonHelper.cleanup();
  });

  describe('POST /allocate', () => {
    it('should allocate a specific port when available', async () => {
      const testPort = await TestPortHelper.findAvailablePort(10000, 10100);

      const response = await request(app)
        .post('/allocate')
        .send({
          service_type: 'dev',
          preferred_port: testPort,
          service_name: 'test-service',
          instance_id: 'test-instance'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.port).toBe(testPort);
      expect(response.body.lock_id).toBeDefined();
      expect(response.body.message).toContain(`Port ${testPort} allocated`);
    });

    it('should allocate from preferred ports when specific port unavailable', async () => {
      const testPort = await TestPortHelper.findAvailablePort(10000, 10100);

      // Start a test server on the requested port
      await TestPortHelper.withTestServers([testPort], async () => {
        const response = await request(app)
          .post('/allocate')
          .send({
            service_type: 'dev',
            preferred_port: testPort
          })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.port).not.toBe(testPort);
        expect(daemon.serviceTypes.dev.preferred_ports).toContain(response.body.port);
      });
    });

    it('should return error for unknown service type', async () => {
      const response = await request(app)
        .post('/allocate')
        .send({
          service_type: 'unknown',
          preferred_port: 3000
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Unknown service type');
    });

    it('should return error when service_type is missing', async () => {
      const response = await request(app)
        .post('/allocate')
        .send({
          preferred_port: 3000
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('service_type is required');
    });

    it('should track allocation metadata correctly', async () => {
      const testPort = await TestPortHelper.findAvailablePort(10000, 10100);

      const response = await request(app)
        .post('/allocate')
        .send({
          service_type: 'dev',
          preferred_port: testPort,
          service_name: 'integration-test',
          instance_id: 'test-instance-123',
          project_path: '/test/project'
        })
        .expect(200);

      const allocation = daemon.allocations.get(testPort);
      expect(allocation.service_type).toBe('dev');
      expect(allocation.service_name).toBe('integration-test');
      expect(allocation.instance_id).toBe('test-instance-123');
      expect(allocation.project_path).toBe('/test/project');
      expect(allocation.allocated_at).toBeDefined();
    });
  });

  describe('DELETE /allocate/:lockId', () => {
    it('should release allocated port successfully', async () => {
      const testPort = await TestPortHelper.findAvailablePort(10000, 10100);

      // First allocate a port
      const allocateResponse = await request(app)
        .post('/allocate')
        .send({
          service_type: 'dev',
          preferred_port: testPort
        })
        .expect(200);

      const lockId = allocateResponse.body.lock_id;

      // Then release it
      const releaseResponse = await request(app)
        .delete(`/allocate/${lockId}`)
        .expect(200);

      expect(releaseResponse.body.success).toBe(true);
      expect(releaseResponse.body.port).toBe(testPort);
      expect(releaseResponse.body.message).toContain(`Port ${testPort} released`);

      // Verify allocation is removed
      expect(daemon.allocations.has(testPort)).toBe(false);
    });

    it('should return error for invalid lock ID', async () => {
      const response = await request(app)
        .delete('/allocate/invalid-lock-id')
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Lock ID invalid-lock-id not found');
    });
  });

  describe('GET /check/:port', () => {
    it('should report available port correctly', async () => {
      const testPort = await TestPortHelper.findAvailablePort(10000, 10100);

      const response = await request(app)
        .get(`/check/${testPort}`)
        .expect(200);

      expect(response.body.port).toBe(testPort);
      expect(response.body.available).toBe(true);
      expect(response.body.allocated_to).toBeNull();
    });

    it('should report allocated port correctly', async () => {
      const testPort = await TestPortHelper.findAvailablePort(10000, 10100);

      // Allocate the port first
      const allocateResponse = await request(app)
        .post('/allocate')
        .send({
          service_type: 'dev',
          preferred_port: testPort,
          service_name: 'check-test'
        })
        .expect(200);

      // Check the port status
      const checkResponse = await request(app)
        .get(`/check/${testPort}`)
        .expect(200);

      expect(checkResponse.body.port).toBe(testPort);
      expect(checkResponse.body.available).toBe(false);
      expect(checkResponse.body.allocated_to).toBeDefined();
      expect(checkResponse.body.allocated_to.service_name).toBe('check-test');
    });

    it('should report system-occupied port correctly', async () => {
      const testPort = await TestPortHelper.findAvailablePort(10000, 10100);

      await TestPortHelper.withTestServers([testPort], async () => {
        const response = await request(app)
          .get(`/check/${testPort}`)
          .expect(200);

        expect(response.body.port).toBe(testPort);
        expect(response.body.available).toBe(false);
        expect(response.body.allocated_to).toBeNull();
        // system_usage might be null if port scanner can't detect details
      });
    });
  });

  describe('GET /allocations', () => {
    it('should list all current allocations', async () => {
      const testPorts = await TestPortHelper.getRandomPortsInRange(2, 10000, 10100);

      // Allocate multiple ports
      for (const port of testPorts) {
        await request(app)
          .post('/allocate')
          .send({
            service_type: 'dev',
            preferred_port: port,
            service_name: `test-service-${port}`
          })
          .expect(200);
      }

      // List allocations
      const response = await request(app)
        .get('/allocations')
        .expect(200);

      expect(response.body.allocations).toHaveLength(2);
      expect(response.body.allocations.map(a => a.port)).toEqual(
        expect.arrayContaining(testPorts)
      );
    });

    it('should return empty list when no allocations', async () => {
      const response = await request(app)
        .get('/allocations')
        .expect(200);

      expect(response.body.allocations).toHaveLength(0);
    });
  });

  describe('POST /cleanup', () => {
    it('should force cleanup all allocations', async () => {
      const testPort = await TestPortHelper.findAvailablePort(10000, 10100);

      // Allocate a port
      await request(app)
        .post('/allocate')
        .send({
          service_type: 'dev',
          preferred_port: testPort
        })
        .expect(200);

      // Force cleanup
      const response = await request(app)
        .post('/cleanup')
        .send({ force: true })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.cleaned).toBe(1);

      // Verify allocation is removed
      expect(daemon.allocations.has(testPort)).toBe(false);
    });

    it('should clean up stale allocations without force', async () => {
      const testPort = await TestPortHelper.findAvailablePort(10000, 10100);

      // Create old allocation manually
      daemon.allocations.set(testPort, {
        service_type: 'dev',
        lock_id: 'old-lock',
        allocated_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() // 2 hours ago
      });

      const response = await request(app)
        .post('/cleanup')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.cleaned).toBe(1);
    });
  });
});