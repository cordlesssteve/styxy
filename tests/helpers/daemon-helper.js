/**
 * Helper utilities for daemon testing
 */

const tmp = require('tmp');
const path = require('path');
const fs = require('fs');
const net = require('net');
const StyxyDaemon = require('../../src/daemon');
const { getTestConfig } = require('../fixtures/test-configs');

class TestDaemonHelper {
  constructor() {
    this.daemon = null;
    this.tmpDir = null;
    this.port = null;
  }

  async start(config = {}) {
    // Create isolated temporary directory
    this.tmpDir = tmp.dirSync({ prefix: 'styxy-daemon-test-', unsafeCleanup: true });

    // Find available port
    this.port = await this.findAvailablePort(10000, 11000);

    // Set test environment variables to skip authentication
    process.env.NODE_ENV = 'test';
    process.env.STYXY_SKIP_AUTH = 'true';

    // Create daemon with test configuration
    const testConfig = getTestConfig({
      port: this.port,
      configDir: this.tmpDir.name,
      ...config
    });

    this.daemon = new StyxyDaemon(testConfig);

    // Start daemon
    await this.daemon.start();

    return {
      daemon: this.daemon,
      port: this.port,
      configDir: this.tmpDir.name,
      baseUrl: `http://127.0.0.1:${this.port}`
    };
  }

  async stop() {
    if (this.daemon) {
      // Call the full daemon stop method to clean up all timers and resources
      await this.daemon.stop();
      this.daemon = null;
    }
  }

  async cleanup() {
    await this.stop();
    if (this.tmpDir) {
      this.tmpDir.removeCallback();
      this.tmpDir = null;
    }
  }

  async findAvailablePort(start = 10000, end = 11000) {
    const net = require('net');

    for (let port = start; port <= end; port++) {
      if (await this.isPortAvailable(port)) {
        return port;
      }
    }
    throw new Error(`No available ports in range ${start}-${end}`);
  }

  isPortAvailable(port) {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.listen(port, '127.0.0.1', () => {
        server.close(() => resolve(true));
      });
      server.on('error', () => resolve(false));
    });
  }

  createTestState(allocations = {}, instances = {}) {
    const stateFile = path.join(this.tmpDir.name, 'daemon.state');
    const state = {
      saved_at: new Date().toISOString(),
      allocations,
      instances
    };
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  }
}

module.exports = TestDaemonHelper;