/**
 * Daemon Test Helper
 *
 * Provides utilities for testing daemon functionality with proper cleanup
 */

const StyxyDaemon = require('../../src/daemon');
const fs = require('fs');
const path = require('path');

class DaemonTestHelper {
  constructor() {
    this.daemons = [];
    this.testDirs = [];
  }

  /**
   * Create a daemon instance for testing
   * @param {Object} options - Daemon options
   * @returns {Promise<StyxyDaemon>}
   */
  async createDaemon(options = {}) {
    const testConfigDir = options.configDir || this.createTestConfigDir();

    const daemon = new StyxyDaemon({
      port: options.port || this.findAvailablePort(),
      configDir: testConfigDir,
      ...options
    });

    // Track for cleanup
    this.daemons.push(daemon);
    if (!this.testDirs.includes(testConfigDir)) {
      this.testDirs.push(testConfigDir);
    }

    // Load state but don't start server
    await daemon.loadState();

    return daemon;
  }

  /**
   * Create a unique test config directory
   * @returns {string}
   */
  createTestConfigDir() {
    const testDir = path.join(
      __dirname,
      '../.test-config',
      `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    );

    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }

    this.testDirs.push(testDir);
    return testDir;
  }

  /**
   * Find an available port for testing
   * @returns {number}
   */
  findAvailablePort() {
    // Use high ports for testing to avoid conflicts
    return 9900 + Math.floor(Math.random() * 50);
  }

  /**
   * Clean up all created daemons and test directories
   * Call this in afterEach or afterAll
   */
  async cleanup() {
    // Stop and destroy all daemons
    for (const daemon of this.daemons) {
      try {
        // Stop server if running
        if (daemon.server && daemon.server.listening) {
          await new Promise((resolve) => {
            daemon.server.close(resolve);
          });
        }

        // Clear cleanup interval
        if (daemon.cleanupInterval) {
          clearInterval(daemon.cleanupInterval);
          daemon.cleanupInterval = null;
        }

        // Destroy components
        if (daemon.healthMonitor) {
          daemon.healthMonitor.destroy();
        }

        if (daemon.metrics) {
          daemon.metrics.destroy();
        }

        if (daemon.portScannerBreaker) {
          daemon.portScannerBreaker.destroy();
        }

        if (daemon.rateLimiter) {
          daemon.rateLimiter.destroy();
        }

        if (daemon.auth && daemon.auth.destroy) {
          daemon.auth.destroy();
        }
      } catch (error) {
        console.warn(`Cleanup error for daemon: ${error.message}`);
      }
    }

    // Remove test directories
    for (const testDir of this.testDirs) {
      try {
        if (fs.existsSync(testDir)) {
          fs.rmSync(testDir, { recursive: true, force: true });
        }
      } catch (error) {
        console.warn(`Failed to remove test directory ${testDir}: ${error.message}`);
      }
    }

    // Reset tracking arrays
    this.daemons = [];
    this.testDirs = [];
  }

  /**
   * Create an external server on a specific port (for conflict testing)
   * @param {number} port
   * @returns {Promise<net.Server>}
   */
  async createExternalServer(port) {
    const net = require('net');
    const server = net.createServer();

    await new Promise((resolve) => {
      server.listen(port, '127.0.0.1', resolve);
    });

    return server;
  }

  /**
   * Close an external server
   * @param {net.Server} server
   */
  closeExternalServer(server) {
    if (server && server.listening) {
      server.close();
    }
  }

  /**
   * Wait for a condition to be true (with timeout)
   * @param {Function} condition - Async function that returns boolean
   * @param {number} timeout - Timeout in ms
   * @param {number} interval - Check interval in ms
   */
  async waitFor(condition, timeout = 5000, interval = 100) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      if (await condition()) {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, interval));
    }

    throw new Error(`Timeout waiting for condition after ${timeout}ms`);
  }
}

/**
 * Create a global helper instance for use in tests
 */
function createTestHelper() {
  return new DaemonTestHelper();
}

module.exports = { DaemonTestHelper, createTestHelper };
