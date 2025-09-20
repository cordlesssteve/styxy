/**
 * Unit tests for StyxyDaemon class
 */

const StyxyDaemon = require('../../../src/daemon');
const tmp = require('tmp');
const fs = require('fs');
const path = require('path');
const { getTestConfig } = require('../../fixtures/test-configs');

describe('StyxyDaemon', () => {
  let daemon;
  let tmpDir;

  beforeEach(() => {
    tmpDir = tmp.dirSync({ prefix: 'styxy-unit-test-', unsafeCleanup: true });
  });

  afterEach(async () => {
    if (daemon) {
      await daemon.stop();
    }
    if (tmpDir) {
      tmpDir.removeCallback();
    }
  });

  describe('constructor', () => {
    it('should initialize with default options', () => {
      daemon = new StyxyDaemon();

      expect(daemon.port).toBe(9876);
      expect(daemon.configDir).toBe(path.join(process.env.HOME, '.styxy'));
      expect(daemon.allocations).toBeInstanceOf(Map);
      expect(daemon.instances).toBeInstanceOf(Map);
      expect(daemon.serviceTypes).toBeDefined();
      expect(daemon.app).toBeDefined();
    });

    it('should initialize with custom options', () => {
      const options = {
        port: 8888,
        configDir: tmpDir.name
      };

      daemon = new StyxyDaemon(options);

      expect(daemon.port).toBe(8888);
      expect(daemon.configDir).toBe(tmpDir.name);
    });
  });

  describe('loadServiceTypes', () => {
    it('should load service types from config', () => {
      // Create test config file
      const configFile = path.join(tmpDir.name, 'config.json');
      const testConfig = {
        service_types: {
          custom: { preferred_ports: [5000], range: [5000, 5099] }
        }
      };
      fs.writeFileSync(configFile, JSON.stringify(testConfig));

      daemon = new StyxyDaemon({ configDir: tmpDir.name });

      expect(daemon.serviceTypes.custom).toBeDefined();
      expect(daemon.serviceTypes.custom.preferred_ports).toEqual([5000]);
    });

    it('should fall back to default config when no config exists', () => {
      daemon = new StyxyDaemon({ configDir: tmpDir.name });

      expect(daemon.serviceTypes.dev).toBeDefined();
      expect(daemon.serviceTypes.api).toBeDefined();
    });
  });

  describe('allocatePort', () => {
    beforeEach(() => {
      daemon = new StyxyDaemon({ configDir: tmpDir.name });
    });

    it('should allocate preferred port when available', async () => {
      const result = await daemon.allocatePort({
        service_type: 'dev',
        preferred_port: 3000
      });

      expect(result.success).toBe(true);
      expect(result.port).toBe(3000);
      expect(result.lock_id).toBeDefined();
      expect(daemon.allocations.has(3000)).toBe(true);
    });

    it('should reject invalid service type', async () => {
      await expect(daemon.allocatePort({
        service_type: 'invalid'
      })).rejects.toThrow('Invalid service type: invalid');
    });

    it('should require service_type parameter', async () => {
      await expect(daemon.allocatePort({})).rejects.toThrow('service_type is required');
    });

    it('should allocate from service preferred ports when preferred unavailable', async () => {
      // Mock isPortAvailable to simulate port 3000 being unavailable
      const originalIsPortAvailable = daemon.isPortAvailable;
      daemon.isPortAvailable = jest.fn()
        .mockResolvedValueOnce(false) // preferred_port unavailable
        .mockResolvedValueOnce(true);  // first service preferred port available

      const result = await daemon.allocatePort({
        service_type: 'dev',
        preferred_port: 3000
      });

      expect(result.success).toBe(true);
      expect(daemon.serviceTypes.dev.preferred_ports).toContain(result.port);

      // Restore original method
      daemon.isPortAvailable = originalIsPortAvailable;
    });
  });

  describe('releasePort', () => {
    beforeEach(() => {
      daemon = new StyxyDaemon({ configDir: tmpDir.name });
    });

    it('should release allocated port', async () => {
      // Allocate a port first
      const allocation = await daemon.allocatePort({
        service_type: 'dev',
        preferred_port: 3000
      });

      const result = await daemon.releasePort(allocation.lock_id);

      expect(result.success).toBe(true);
      expect(result.port).toBe(3000);
      expect(daemon.allocations.has(3000)).toBe(false);
    });

    it('should throw error for invalid lock ID', async () => {
      await expect(daemon.releasePort('invalid-lock-id'))
        .rejects.toThrow('Lock ID invalid-lock-id not found');
    });
  });

  describe('createAllocation', () => {
    beforeEach(() => {
      daemon = new StyxyDaemon({ configDir: tmpDir.name });
    });

    it('should create allocation with metadata', async () => {
      const metadata = {
        service_type: 'dev',
        service_name: 'test-service',
        instance_id: 'test-instance'
      };

      const result = await daemon.createAllocation(3000, metadata);

      expect(result.success).toBe(true);
      expect(result.port).toBe(3000);
      expect(result.lock_id).toBeDefined();

      const allocation = daemon.allocations.get(3000);
      expect(allocation.service_type).toBe('dev');
      expect(allocation.service_name).toBe('test-service');
      expect(allocation.allocated_at).toBeDefined();
    });
  });

  describe('saveState and loadState', () => {
    beforeEach(() => {
      daemon = new StyxyDaemon({ configDir: tmpDir.name });
    });

    it('should save and load state correctly', async () => {
      // Create test data
      daemon.allocations.set(3000, {
        serviceType: 'dev',
        lockId: '12345678-1234-4567-8901-123456789012',
        allocated_at: new Date().toISOString()
      });

      daemon.instances.set('test-instance', {
        id: 'test-instance',
        lastHeartbeat: new Date().toISOString()
      });

      // Save state
      await daemon.saveState();

      // Verify file exists
      const stateFile = path.join(tmpDir.name, 'daemon.state');
      expect(fs.existsSync(stateFile)).toBe(true);

      // Clear in-memory state
      daemon.allocations.clear();
      daemon.instances.clear();

      // Load state
      await daemon.loadState();

      // Verify state restored - convert to number key for Map comparison
      expect(daemon.allocations.has(3000)).toBe(true);
      expect(daemon.instances.has('test-instance')).toBe(true);
    });
  });

  describe('performCleanup', () => {
    beforeEach(() => {
      daemon = new StyxyDaemon({ configDir: tmpDir.name });
    });

    it('should clean up stale allocations when forced', async () => {
      // Create test allocation
      daemon.allocations.set(3000, {
        service_type: 'dev',
        lock_id: 'test-lock-id',
        allocated_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() // 2 hours ago
      });

      const result = await daemon.performCleanup(true);

      expect(result.success).toBe(true);
      expect(result.cleaned).toBe(1);
      expect(daemon.allocations.size).toBe(0);
    });

    it('should clean up old allocations without force', async () => {
      // Create old allocation (> 1 hour)
      daemon.allocations.set(3000, {
        service_type: 'dev',
        lock_id: 'old-lock-id',
        allocated_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
      });

      // Create recent allocation
      daemon.allocations.set(3001, {
        service_type: 'dev',
        lock_id: 'new-lock-id',
        allocated_at: new Date().toISOString()
      });

      const result = await daemon.performCleanup(false);

      expect(result.success).toBe(true);
      expect(result.cleaned).toBe(1);
      expect(daemon.allocations.has(3000)).toBe(false);
      expect(daemon.allocations.has(3001)).toBe(true);
    });
  });
});