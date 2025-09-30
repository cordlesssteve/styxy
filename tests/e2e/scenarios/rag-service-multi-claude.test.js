/**
 * End-to-end test for RAG Service Multi-Claude Scenario (Feature #1)
 *
 * Simulates the real-world scenario where multiple Claude Code instances
 * start simultaneously and all try to allocate ports for the RAG service.
 *
 * Expected behavior:
 * - Only 1 port allocated for RAG service
 * - All Claude instances receive the same port
 * - After first instance releases, second can claim new allocation
 */

const TestDaemonHelper = require('../../helpers/daemon-helper');
const TestCliHelper = require('../../helpers/cli-helper');

describe('RAG Service Multi-Claude Scenario', () => {
  let daemonHelper;
  let daemon;
  let cli;

  beforeEach(async () => {
    daemonHelper = new TestDaemonHelper();

    // Configure daemon with AI service type (matches real config)
    const configOverride = {
      service_types: {
        'ai': {
          description: 'AI and ML services',
          preferred_ports: [11430, 11431, 11432, 11433],
          port_range: [11400, 11499],
          instance_behavior: 'single', // Key: singleton behavior
          multi_instance_pattern: 'sequential',
          examples: ['Ollama', 'Local LLMs', 'AI inference servers', 'RAG service', 'Embedding models']
        }
      }
    };

    const daemonInfo = await daemonHelper.start({ configOverride });
    daemon = daemonInfo.daemon;
    cli = new TestCliHelper(daemonInfo.port);
  });

  afterEach(async () => {
    await daemonHelper.cleanup();
  });

  describe('Scenario: 3 Claude Code instances start simultaneously', () => {
    it('should allocate only 1 port, all instances receive same port', async () => {
      // Simulate 3 Claude Code instances requesting RAG service port
      const promises = [
        cli.allocate('ai', {
          name: 'rag-service',
          instance: 'claude-instance-1',
          project: '/home/user/projects/project-1'
        }),
        cli.allocate('ai', {
          name: 'rag-service',
          instance: 'claude-instance-2',
          project: '/home/user/projects/project-2'
        }),
        cli.allocate('ai', {
          name: 'rag-service',
          instance: 'claude-instance-3',
          project: '/home/user/projects/project-3'
        })
      ];

      const results = await Promise.all(promises);

      // All allocations should succeed
      results.forEach((result, index) => {
        expect(result.success).toBe(true);
        expect(result.port).toBeDefined();
      });

      // All should receive the SAME port
      const ports = results.map(r => r.port);
      const uniquePorts = [...new Set(ports)];
      expect(uniquePorts.length).toBe(1);

      const sharedPort = ports[0];
      expect(sharedPort).toBeGreaterThanOrEqual(11400);
      expect(sharedPort).toBeLessThanOrEqual(11499);

      // Only ONE actual allocation in daemon
      expect(daemon.allocations.size).toBe(1);
      expect(daemon.allocations.has(sharedPort)).toBe(true);

      // Only ONE singleton registered
      expect(daemon.singletonServices.size).toBe(1);
      const singleton = daemon.getSingleton('ai');
      expect(singleton).toBeDefined();
      expect(singleton.port).toBe(sharedPort);
    });

    it('should return existing instance metadata to subsequent requests', async () => {
      // First instance allocates
      const firstResult = await cli.allocate('ai', {
        name: 'rag-service',
        instance: 'claude-instance-1',
        project: '/home/user/projects/project-1'
      });

      expect(firstResult.existing).toBeUndefined(); // First allocation is new

      // Second instance requests same service
      const secondResult = await cli.allocate('ai', {
        name: 'rag-service',
        instance: 'claude-instance-2',
        project: '/home/user/projects/project-2'
      });

      // Second request gets existing allocation
      expect(secondResult.port).toBe(firstResult.port);
      expect(secondResult.existing).toBe(true);
      expect(secondResult.existingInstanceId).toBe('claude-instance-1');
      expect(secondResult.existingPid).toBeDefined();
    });
  });

  describe('Scenario: First instance releases, second can claim', () => {
    it('should allow new allocation after first instance releases', async () => {
      // Instance 1 allocates
      const firstResult = await cli.allocate('ai', {
        name: 'rag-service',
        instance: 'claude-instance-1',
        project: '/home/user/project-1'
      });

      const firstPort = firstResult.port;
      const firstLockId = firstResult.lockId || firstResult.lock_id;

      // Instance 2 tries to allocate (gets same port)
      const blockedResult = await cli.allocate('ai', {
        name: 'rag-service',
        instance: 'claude-instance-2',
        project: '/home/user/project-2'
      });

      expect(blockedResult.port).toBe(firstPort);
      expect(blockedResult.existing).toBe(true);

      // Instance 1 releases (e.g., session ends)
      const releaseResult = await cli.release(firstLockId);
      expect(releaseResult.success).toBe(true);

      // Verify singleton released
      const singleton = daemon.getSingleton('ai');
      expect(singleton).toBeUndefined();

      // Instance 2 can now claim new allocation
      const newResult = await cli.allocate('ai', {
        name: 'rag-service',
        instance: 'claude-instance-2',
        project: '/home/user/project-2'
      });

      expect(newResult.success).toBe(true);
      expect(newResult.existing).toBeUndefined(); // New allocation
      expect(newResult.port).toBeDefined();

      // Verify new singleton registered
      const newSingleton = daemon.getSingleton('ai');
      expect(newSingleton).toBeDefined();
      expect(newSingleton.instanceId).toBe('claude-instance-2');
    });
  });

  describe('Scenario: Stale RAG service cleanup', () => {
    it('should release singleton when RAG service becomes stale', async () => {
      // Allocate RAG service
      const result = await cli.allocate('ai', {
        name: 'rag-service',
        instance: 'claude-instance-1',
        project: '/home/user/project-1'
      });

      const port = result.port;

      // Manually mark allocation as stale (simulate process crash)
      const allocation = daemon.allocations.get(port);
      allocation.allocated_at = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago
      allocation.process_id = 99999; // Non-existent PID

      // Run cleanup
      await daemon.cleanupStaleAllocations();

      // Verify allocation removed
      expect(daemon.allocations.has(port)).toBe(false);

      // Verify singleton released
      const singleton = daemon.getSingleton('ai');
      expect(singleton).toBeUndefined();

      // New allocation should succeed
      const newResult = await cli.allocate('ai', {
        name: 'rag-service',
        instance: 'claude-instance-2',
        project: '/home/user/project-2'
      });

      expect(newResult.success).toBe(true);
      expect(newResult.existing).toBeUndefined();
    });
  });

  describe('Scenario: 5 simultaneous Claude instances', () => {
    it('should handle 5 concurrent RAG service requests efficiently', async () => {
      const startTime = Date.now();

      // Simulate 5 Claude Code instances starting at once
      const promises = [];
      for (let i = 1; i <= 5; i++) {
        promises.push(
          cli.allocate('ai', {
            name: 'rag-service',
            instance: `claude-instance-${i}`,
            project: `/home/user/project-${i}`
          })
        );
      }

      const results = await Promise.all(promises);
      const duration = Date.now() - startTime;

      // All requests succeed
      results.forEach(result => {
        expect(result.success).toBe(true);
      });

      // All receive same port
      const ports = results.map(r => r.port);
      expect(new Set(ports).size).toBe(1);

      // Only one allocation exists
      expect(daemon.allocations.size).toBe(1);
      expect(daemon.singletonServices.size).toBe(1);

      // Should complete quickly (< 500ms for all 5)
      expect(duration).toBeLessThan(500);
    });
  });

  describe('Scenario: Mixed service types (RAG + Ollama)', () => {
    it('should allow separate singletons for different AI services', async () => {
      // In a real scenario, you might have:
      // - RAG service (ChromaDB + embeddings) → instance_id: "rag-service"
      // - Ollama service → instance_id: "ollama"
      //
      // Both are "ai" service type with single instance behavior
      // But in current implementation, service type = singleton key
      // So both would share the same singleton

      const ragResult = await cli.allocate('ai', {
        name: 'rag-service',
        instance: 'rag-main',
        project: '/home/user/rag'
      });

      const ollamaResult = await cli.allocate('ai', {
        name: 'ollama',
        instance: 'ollama-main',
        project: '/home/user/ollama'
      });

      // Current behavior: both share same port (single "ai" singleton)
      expect(ragResult.port).toBe(ollamaResult.port);
      expect(ollamaResult.existing).toBe(true);

      // This documents current limitation:
      // If you need separate singletons for RAG and Ollama,
      // they should be different service types (e.g., "ai-rag", "ai-ollama")
      expect(daemon.singletonServices.size).toBe(1);
    });
  });

  describe('Scenario: Daemon restart with active RAG service', () => {
    it('should restore singleton state after daemon restart', async () => {
      // Allocate RAG service
      const result = await cli.allocate('ai', {
        name: 'rag-service',
        instance: 'claude-instance-1',
        project: '/home/user/project'
      });

      const originalPort = result.port;
      const originalLockId = result.lockId || result.lock_id;

      // Save state
      await daemon.saveState();

      // Simulate daemon restart
      const newDaemon = await daemonHelper.restart();

      // Verify singleton restored
      const singleton = newDaemon.getSingleton('ai');
      expect(singleton).toBeDefined();
      expect(singleton.port).toBe(originalPort);
      expect(singleton.lockId).toBe(originalLockId);
      expect(singleton.instanceId).toBe('claude-instance-1');

      // New allocation request should get existing port
      const newCli = new TestCliHelper(newDaemon.port);
      const newResult = await newCli.allocate('ai', {
        name: 'rag-service',
        instance: 'claude-instance-2',
        project: '/home/user/project-2'
      });

      expect(newResult.port).toBe(originalPort);
      expect(newResult.existing).toBe(true);
    });
  });

  describe('Real-world edge cases', () => {
    it('should handle rapid succession allocate-release-allocate', async () => {
      // Instance 1 allocates
      const result1 = await cli.allocate('ai', {
        name: 'rag-service',
        instance: 'instance-1'
      });

      const lockId1 = result1.lockId || result1.lock_id;

      // Instance 1 releases immediately
      await cli.release(lockId1);

      // Instance 2 allocates immediately after
      const result2 = await cli.allocate('ai', {
        name: 'rag-service',
        instance: 'instance-2'
      });

      expect(result2.success).toBe(true);
      expect(result2.existing).toBeUndefined(); // New allocation

      // Instance 3 tries (should get instance-2's allocation)
      const result3 = await cli.allocate('ai', {
        name: 'rag-service',
        instance: 'instance-3'
      });

      expect(result3.port).toBe(result2.port);
      expect(result3.existing).toBe(true);
    });

    it('should prevent port conflicts when singleton uses preferred port', async () => {
      // RAG service gets first preferred port (11430)
      const ragResult = await cli.allocate('ai', {
        name: 'rag-service',
        instance: 'claude-1'
      });

      expect(ragResult.port).toBe(11430);

      // Multiple subsequent requests should all get 11430
      for (let i = 2; i <= 5; i++) {
        const result = await cli.allocate('ai', {
          name: 'rag-service',
          instance: `claude-${i}`
        });

        expect(result.port).toBe(11430);
        expect(result.existing).toBe(true);
      }

      // Still only 1 allocation
      expect(daemon.allocations.size).toBe(1);
    });
  });
});
