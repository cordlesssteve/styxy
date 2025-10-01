/**
 * Unit tests for SystemRecovery (Feature #3, Phase 3)
 */

const SystemRecovery = require('../../../src/utils/system-recovery');
const { createTestHelper } = require('../../helpers/daemon-test-helper');
const fs = require('fs');
const path = require('path');

describe('SystemRecovery - Unit Tests', () => {
  let testHelper;
  let daemon;
  let systemRecovery;

  beforeEach(async () => {
    testHelper = createTestHelper();
    daemon = await testHelper.createDaemon();
    systemRecovery = daemon.systemRecovery;
  });

  afterEach(async () => {
    await testHelper.cleanup();
  });

  describe('Constructor', () => {
    test('should require daemon instance', () => {
      expect(() => new SystemRecovery()).toThrow('Daemon instance required');
    });

    test('should initialize with daemon config', () => {
      expect(systemRecovery.daemon).toBe(daemon);
      expect(systemRecovery.config).toBeDefined();
    });

    test('should use default config when recovery config missing', async () => {
      const customDaemon = await testHelper.createDaemon();
      customDaemon.recoveryConfig = {};

      const recovery = new SystemRecovery(customDaemon);
      expect(recovery.config.enabled).toBe(false);
      expect(recovery.config.run_on_startup).toBe(false);
      expect(recovery.config.backup_corrupted_state).toBe(true);
    });
  });

  describe('performRecoveryOnStartup()', () => {
    test('should skip when disabled', async () => {
      const result = await systemRecovery.performRecoveryOnStartup();
      expect(result.skipped).toBe(true);
    });

    test('should run all recovery steps when enabled', async () => {
      daemon.recoveryConfig.system_recovery.enabled = true;
      daemon.recoveryConfig.system_recovery.run_on_startup = true;

      const result = await systemRecovery.performRecoveryOnStartup();

      expect(result.skipped).toBeUndefined();
      expect(result.success).toBeDefined();
      expect(result.failed).toBeDefined();
      expect(result.warnings).toBeDefined();
      expect(result.success.length).toBeGreaterThan(0);
    });
  });

  describe('validateStateFile()', () => {
    test('should handle missing state file', async () => {
      // Remove state file
      if (fs.existsSync(daemon.stateFile)) {
        fs.unlinkSync(daemon.stateFile);
      }

      const result = await systemRecovery.validateStateFile();
      expect(result.created).toBe(true);
      expect(result.valid).toBe(true);
    });

    test('should validate correct state file', async () => {
      // Create valid state
      const validState = {
        allocations: [],
        singletonServices: {},
        version: '1.0'
      };
      fs.writeFileSync(daemon.stateFile, JSON.stringify(validState));

      const result = await systemRecovery.validateStateFile();
      expect(result.valid).toBe(true);
      expect(result.allocationCount).toBe(0);
    });

    test('should detect corrupted state file', async () => {
      // Create invalid state (missing allocations)
      const invalidState = { singletonServices: {} };
      fs.writeFileSync(daemon.stateFile, JSON.stringify(invalidState));

      await expect(systemRecovery.validateStateFile()).rejects.toThrow(/corrupted/);
    });

    test('should detect invalid JSON', async () => {
      fs.writeFileSync(daemon.stateFile, 'invalid json {');

      await expect(systemRecovery.validateStateFile()).rejects.toThrow(/corrupted/);
    });
  });

  describe('validateConfigFile()', () => {
    test('should handle missing user config', async () => {
      const result = await systemRecovery.validateConfigFile();
      expect(result.valid).toBe(true);
      expect(result.user_config).toBe(false);
    });

    test('should validate correct config file', async () => {
      const userConfigPath = path.join(daemon.configDir, 'config.json');
      const validConfig = {
        service_types: { test: { range: [3000, 3099] } },
        auto_allocation: { enabled: false }
      };
      fs.writeFileSync(userConfigPath, JSON.stringify(validConfig));

      const result = await systemRecovery.validateConfigFile();
      expect(result.valid).toBe(true);
      expect(result.has_service_types).toBe(true);
    });

    test('should detect invalid config structure', async () => {
      const userConfigPath = path.join(daemon.configDir, 'config.json');
      const invalidConfig = {
        service_types: 'invalid' // Should be object
      };
      fs.writeFileSync(userConfigPath, JSON.stringify(invalidConfig));

      await expect(systemRecovery.validateConfigFile()).rejects.toThrow(/invalid/i);
    });
  });

  describe('cleanOrphanedAllocations()', () => {
    test('should clean allocations with dead processes', async () => {
      // Create allocation with non-existent PID
      const allocation = {
        port: 3000,
        lockId: 'test-lock',
        process_id: 99999, // Non-existent
        serviceType: 'test',
        allocated_at: new Date().toISOString()
      };
      daemon.allocations.set(3000, allocation);

      // Mock releasePort to succeed
      const releaseSpy = jest.spyOn(daemon, 'releasePort').mockResolvedValue({
        success: true,
        port: 3000
      });

      const result = await systemRecovery.cleanOrphanedAllocations();
      expect(result.cleaned).toBe(1);
      expect(releaseSpy).toHaveBeenCalledWith(3000, 'test-lock');
    });

    test('should clean allocations with available ports', async () => {
      // Create allocation
      const allocation = {
        port: 3000,
        lockId: 'test-lock',
        process_id: process.pid, // Running process
        serviceType: 'test',
        allocated_at: new Date().toISOString()
      };
      daemon.allocations.set(3000, allocation);

      // Mock port check to return true (port available = orphaned)
      jest.spyOn(daemon, 'checkPortActuallyAvailable').mockResolvedValue(true);

      // Mock releasePort to succeed
      jest.spyOn(daemon, 'releasePort').mockResolvedValue({
        success: true,
        port: 3000
      });

      const result = await systemRecovery.cleanOrphanedAllocations();
      expect(result.cleaned).toBe(1);
    });

    test('should not clean healthy allocations', async () => {
      // Create allocation with our PID and mock port in use
      const allocation = {
        port: 3000,
        lockId: 'test-lock',
        process_id: process.pid,
        serviceType: 'test',
        allocated_at: new Date().toISOString()
      };
      daemon.allocations.set(3000, allocation);

      // Mock port check to return false (port in use = healthy)
      jest.spyOn(daemon, 'checkPortActuallyAvailable').mockResolvedValue(false);

      const result = await systemRecovery.cleanOrphanedAllocations();
      expect(result.cleaned).toBe(0);
      expect(daemon.allocations.has(3000)).toBe(true);
    });
  });

  describe('verifySingletonIntegrity()', () => {
    test('should remove duplicate singleton allocations', async () => {
      // Configure ai as singleton
      daemon.serviceTypes.ai = {
        range: [11430, 11499],
        preferred_ports: [11430],
        instance_behavior: 'single'
      };

      // Create two allocations for same singleton type
      const allocation1 = {
        port: 11430,
        lockId: 'lock-1',
        serviceType: 'ai',
        allocated_at: new Date(Date.now() - 1000).toISOString()
      };
      const allocation2 = {
        port: 11431,
        lockId: 'lock-2',
        serviceType: 'ai',
        allocated_at: new Date().toISOString() // Newer
      };

      daemon.allocations.set(11430, allocation1);
      daemon.allocations.set(11431, allocation2);

      // Mock releasePort to succeed
      const releaseSpy = jest.spyOn(daemon, 'releasePort').mockResolvedValue({
        success: true
      });

      const result = await systemRecovery.verifySingletonIntegrity();
      expect(result.fixed).toBe(1);
      // Should have released the older allocation
      expect(releaseSpy).toHaveBeenCalledWith(11430, 'lock-1');
    });

    test('should not affect multi-instance services', async () => {
      // dev is multi-instance
      const allocation1 = {
        port: 3000,
        lockId: 'lock-1',
        serviceType: 'dev',
        allocated_at: new Date().toISOString()
      };
      const allocation2 = {
        port: 3001,
        lockId: 'lock-2',
        serviceType: 'dev',
        allocated_at: new Date().toISOString()
      };

      daemon.allocations.set(3000, allocation1);
      daemon.allocations.set(3001, allocation2);

      const result = await systemRecovery.verifySingletonIntegrity();
      expect(result.fixed).toBe(0);
      expect(daemon.allocations.has(3000)).toBe(true);
      expect(daemon.allocations.has(3001)).toBe(true);
    });
  });

  describe('getSingletonServiceTypes()', () => {
    test('should return list of singleton service types', () => {
      // Configure ai as singleton
      daemon.serviceTypes.ai = {
        range: [11430, 11499],
        instance_behavior: 'single'
      };

      const singletonTypes = systemRecovery.getSingletonServiceTypes();
      expect(singletonTypes).toContain('ai');
    });

    test('should not include multi-instance types', () => {
      const singletonTypes = systemRecovery.getSingletonServiceTypes();
      expect(singletonTypes).not.toContain('dev');
    });
  });

  describe('rebuildIndices()', () => {
    test('should rebuild indices successfully', async () => {
      const result = await systemRecovery.rebuildIndices();
      expect(result.rebuilt).toBe(true);
      expect(result.allocations).toBeDefined();
      expect(result.instances).toBeDefined();
      expect(result.singletons).toBeDefined();
    });
  });

  describe('repairStateFile()', () => {
    test('should backup corrupted state before repair', async () => {
      daemon.recoveryConfig.system_recovery.backup_corrupted_state = true;

      // Create corrupted state
      fs.writeFileSync(daemon.stateFile, 'corrupted');

      const error = new Error('Corrupted');
      const repaired = await systemRecovery.repairStateFile(error);

      expect(repaired).toBe(true);

      // Check for backup file
      const backupFiles = fs.readdirSync(daemon.configDir)
        .filter(f => f.startsWith('daemon.state.corrupt'));
      expect(backupFiles.length).toBeGreaterThan(0);
    });

    test('should initialize new state after corruption', async () => {
      // Create corrupted state
      fs.writeFileSync(daemon.stateFile, 'corrupted');

      const error = new Error('Corrupted');
      await systemRecovery.repairStateFile(error);

      // Verify new state is valid
      const stateData = JSON.parse(fs.readFileSync(daemon.stateFile, 'utf8'));
      expect(stateData.allocations).toEqual([]);
      expect(stateData.singletonServices).toEqual({});
    });
  });

  describe('getStatistics()', () => {
    test('should return recovery statistics', () => {
      const stats = systemRecovery.getStatistics();

      expect(stats).toHaveProperty('enabled');
      expect(stats).toHaveProperty('run_on_startup');
      expect(stats).toHaveProperty('backup_corrupted_state');
      expect(stats).toHaveProperty('max_recovery_attempts');
    });
  });

  describe('Integration with Daemon', () => {
    test('should be initialized with daemon', () => {
      expect(daemon.systemRecovery).toBeDefined();
      expect(daemon.systemRecovery).toBeInstanceOf(SystemRecovery);
    });

    test('should use daemon recovery config', () => {
      expect(daemon.systemRecovery.config).toBe(daemon.recoveryConfig.system_recovery);
    });
  });
});
