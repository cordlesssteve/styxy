/**
 * Unit tests for Singleton Service Allocation (Feature #1)
 *
 * Tests the single-instance service configuration that prevents
 * multiple allocations for services that cannot support concurrency.
 */

const StyxyDaemon = require('../../../src/daemon');
const tmp = require('tmp');
const fs = require('fs');
const path = require('path');

describe('Singleton Service Allocation', () => {
  let daemon;
  let tmpDir;

  beforeEach(() => {
    tmpDir = tmp.dirSync({ prefix: 'styxy-singleton-test-', unsafeCleanup: true });

    // Create config with singleton service type in the daemon's config directory
    const configFile = path.join(tmpDir.name, 'config.json');

    const testConfig = {
      service_types: {
        'test-singleton': {
          description: 'Test singleton service',
          preferred_ports: [11400, 11401],
          port_range: [11400, 11499],
          instance_behavior: 'single',
          multi_instance_pattern: 'sequential',
          examples: ['Test service']
        },
        'test-multi': {
          description: 'Test multi-instance service',
          preferred_ports: [12400, 12401],
          port_range: [12400, 12499],
          instance_behavior: 'multi',
          multi_instance_pattern: 'sequential',
          examples: ['Test multi service']
        }
      }
    };

    fs.writeFileSync(configFile, JSON.stringify(testConfig));

    daemon = new StyxyDaemon({ configDir: tmpDir.name, port: 19876 });
  });

  afterEach(async () => {
    if (daemon) {
      await daemon.stop();
    }
    if (tmpDir) {
      tmpDir.removeCallback();
    }
  });

  describe('First Allocation', () => {
    it('should create singleton on first allocation', async () => {
      const result = await daemon.allocatePort({
        service_type: 'test-singleton',
        service_name: 'test-service',
        instance_id: 'instance-1',
        project_path: '/test/path'
      });

      expect(result.success).toBe(true);
      expect(result.port).toBeDefined();
      expect(result.lock_id).toBeDefined();
      expect(result.existing).toBeUndefined();

      // Verify singleton registered
      const singleton = daemon.getSingleton('test-singleton');
      expect(singleton).toBeDefined();
      expect(singleton.port).toBe(result.port);
      expect(singleton.lockId).toBe(result.lock_id);
      expect(singleton.instanceId).toBe('instance-1');
    });

    it('should allocate preferred port for singleton', async () => {
      const result = await daemon.allocatePort({
        service_type: 'test-singleton',
        service_name: 'test-service',
        instance_id: 'instance-1',
        project_path: '/test/path'
      });

      expect(result.port).toBe(11400); // First preferred port
    });
  });

  describe('Second Allocation (Existing Singleton)', () => {
    let firstAllocation;

    beforeEach(async () => {
      firstAllocation = await daemon.allocatePort({
        service_type: 'test-singleton',
        service_name: 'test-service',
        instance_id: 'instance-1',
        project_path: '/test/path'
      });
    });

    it('should return existing singleton allocation', async () => {
      const result = await daemon.allocatePort({
        service_type: 'test-singleton',
        service_name: 'different-service',
        instance_id: 'instance-2',
        project_path: '/different/path'
      });

      expect(result.port).toBe(firstAllocation.port);
      expect(result.lockId).toBe(firstAllocation.lock_id);
      expect(result.existing).toBe(true);
      expect(result.message).toContain('only allows single instance');
    });

    it('should include existing instance metadata', async () => {
      const result = await daemon.allocatePort({
        service_type: 'test-singleton',
        service_name: 'different-service',
        instance_id: 'instance-2',
        project_path: '/different/path'
      });

      expect(result.existingInstanceId).toBe('instance-1');
      expect(result.existingPid).toBeDefined();
      expect(result.allocatedAt).toBeDefined();
    });

    it('should not create new allocation for second request', async () => {
      const initialAllocations = daemon.allocations.size;

      await daemon.allocatePort({
        service_type: 'test-singleton',
        service_name: 'different-service',
        instance_id: 'instance-2',
        project_path: '/different/path'
      });

      expect(daemon.allocations.size).toBe(initialAllocations);
    });
  });

  describe('Release and Re-allocate', () => {
    it('should allow new allocation after release', async () => {
      // First allocation
      const firstResult = await daemon.allocatePort({
        service_type: 'test-singleton',
        service_name: 'test-service',
        instance_id: 'instance-1',
        project_path: '/test/path'
      });

      expect(firstResult.existing).toBeUndefined();
      const firstPort = firstResult.port;
      const firstLockId = firstResult.lock_id;

      // Release
      await daemon.releasePort(firstLockId);

      // Verify singleton released
      const singleton = daemon.getSingleton('test-singleton');
      expect(singleton).toBeUndefined();

      // Second allocation should create new singleton
      const secondResult = await daemon.allocatePort({
        service_type: 'test-singleton',
        service_name: 'test-service-2',
        instance_id: 'instance-2',
        project_path: '/test/path2'
      });

      expect(secondResult.existing).toBeUndefined();
      expect(secondResult.port).toBeDefined();
      expect(secondResult.lock_id).not.toBe(firstLockId);

      // Verify new singleton registered
      const newSingleton = daemon.getSingleton('test-singleton');
      expect(newSingleton).toBeDefined();
      expect(newSingleton.instanceId).toBe('instance-2');
    });
  });

  describe('Multi-instance Services (Unaffected)', () => {
    it('should allow multiple allocations for multi-instance services', async () => {
      const firstResult = await daemon.allocatePort({
        service_type: 'test-multi',
        service_name: 'test-service',
        instance_id: 'instance-1',
        project_path: '/test/path'
      });

      const secondResult = await daemon.allocatePort({
        service_type: 'test-multi',
        service_name: 'test-service',
        instance_id: 'instance-2',
        project_path: '/test/path'
      });

      expect(firstResult.success).toBe(true);
      expect(secondResult.success).toBe(true);
      expect(firstResult.port).not.toBe(secondResult.port);
      expect(firstResult.existing).toBeUndefined();
      expect(secondResult.existing).toBeUndefined();
    });

    it('should not register multi-instance services as singletons', async () => {
      await daemon.allocatePort({
        service_type: 'test-multi',
        service_name: 'test-service',
        instance_id: 'instance-1',
        project_path: '/test/path'
      });

      const singleton = daemon.getSingleton('test-multi');
      expect(singleton).toBeUndefined();
    });
  });

  describe('State Persistence', () => {
    it('should persist singleton state on save', async () => {
      const result = await daemon.allocatePort({
        service_type: 'test-singleton',
        service_name: 'test-service',
        instance_id: 'instance-1',
        project_path: '/test/path'
      });

      await daemon.saveState();

      // Read state file
      const stateFile = path.join(tmpDir.name, 'daemon.state');
      const stateContent = fs.readFileSync(stateFile, 'utf8');
      const state = JSON.parse(stateContent);

      expect(state.singletonServices).toBeDefined();
      expect(state.singletonServices.length).toBe(1);
      expect(state.singletonServices[0].serviceType).toBe('test-singleton');
      expect(state.singletonServices[0].port).toBe(result.port);
    });

    it('should restore singleton state on load', async () => {
      // Create and save singleton
      const result = await daemon.allocatePort({
        service_type: 'test-singleton',
        service_name: 'test-service',
        instance_id: 'instance-1',
        project_path: '/test/path'
      });

      await daemon.saveState();

      // Create new daemon instance (simulating restart)
      const daemon2 = new StyxyDaemon({ configDir: tmpDir.name, port: 19877 });
      await daemon2.loadState();

      // Verify singleton restored
      const singleton = daemon2.getSingleton('test-singleton');
      expect(singleton).toBeDefined();
      expect(singleton.port).toBe(result.port);
      expect(singleton.instanceId).toBe('instance-1');

      await daemon2.stop();
    });
  });

  describe('Cleanup Integration', () => {
    it('should release singleton on cleanup', async () => {
      const result = await daemon.allocatePort({
        service_type: 'test-singleton',
        service_name: 'test-service',
        instance_id: 'instance-1',
        project_path: '/test/path'
      });

      // Manually mark allocation as stale (simulate dead process)
      const allocation = daemon.allocations.get(result.port);
      allocation.allocated_at = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago
      allocation.process_id = 99999; // Non-existent PID

      // Run cleanup
      await daemon.cleanupStaleAllocations();

      // Verify singleton released
      const singleton = daemon.getSingleton('test-singleton');
      expect(singleton).toBeUndefined();

      // Verify new allocation can be created
      const newResult = await daemon.allocatePort({
        service_type: 'test-singleton',
        service_name: 'test-service-2',
        instance_id: 'instance-2',
        project_path: '/test/path2'
      });

      expect(newResult.existing).toBeUndefined();
      expect(newResult.success).toBe(true);
    });
  });

  describe('Singleton Methods', () => {
    describe('registerSingleton', () => {
      it('should register singleton with all metadata', () => {
        daemon.registerSingleton('test-singleton', {
          port: 11400,
          lockId: 'test-lock-id',
          instanceId: 'test-instance',
          pid: 12345
        });

        const singleton = daemon.getSingleton('test-singleton');
        expect(singleton.serviceType).toBe('test-singleton');
        expect(singleton.port).toBe(11400);
        expect(singleton.lockId).toBe('test-lock-id');
        expect(singleton.instanceId).toBe('test-instance');
        expect(singleton.pid).toBe(12345);
        expect(singleton.allocatedAt).toBeDefined();
      });

      it('should throw error if service type missing', () => {
        expect(() => {
          daemon.registerSingleton('', { port: 11400 });
        }).toThrow();
      });
    });

    describe('getSingleton', () => {
      it('should return undefined for non-existent singleton', () => {
        const singleton = daemon.getSingleton('nonexistent');
        expect(singleton).toBeUndefined();
      });

      it('should return singleton if exists', () => {
        daemon.registerSingleton('test-singleton', {
          port: 11400,
          lockId: 'test-lock-id',
          instanceId: 'test-instance',
          pid: 12345
        });

        const singleton = daemon.getSingleton('test-singleton');
        expect(singleton).toBeDefined();
      });
    });

    describe('releaseSingleton', () => {
      it('should release existing singleton', () => {
        daemon.registerSingleton('test-singleton', {
          port: 11400,
          lockId: 'test-lock-id',
          instanceId: 'test-instance',
          pid: 12345
        });

        const result = daemon.releaseSingleton('test-singleton');
        expect(result).toBe(true);

        const singleton = daemon.getSingleton('test-singleton');
        expect(singleton).toBeUndefined();
      });

      it('should return false for non-existent singleton', () => {
        const result = daemon.releaseSingleton('nonexistent');
        expect(result).toBe(false);
      });
    });
  });
});
