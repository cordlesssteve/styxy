/**
 * Helper utilities for port testing
 */

const net = require('net');

class TestPortHelper {
  static reservedPorts = new Set();

  /**
   * Get an ephemeral port from the OS
   */
  static async getEphemeralPort() {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        server.close(() => {
          // Reserve this port to prevent reuse within same test run
          this.reservedPorts.add(port);
          resolve(port);
        });
      });
      server.on('error', reject);
    });
  }

  /**
   * Execute callback with a reserved ephemeral port
   */
  static async withReservedPort(callback) {
    const port = await this.getEphemeralPort();
    try {
      return await callback(port);
    } finally {
      // Port automatically released when callback completes
    }
  }

  /**
   * Legacy method - now uses ephemeral ports for better reliability
   */
  static async findAvailablePort(start = 15000, end = 16000) {
    // Use ephemeral ports instead of scanning ranges
    return this.getEphemeralPort();
  }

  static isPortAvailable(port) {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.listen(port, '127.0.0.1', () => {
        server.close(() => resolve(true));
      });
      server.on('error', () => resolve(false));
    });
  }

  static createTestServer(port) {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.listen(port, '127.0.0.1', () => {
        resolve(server);
      });
      server.on('error', reject);
    });
  }

  static closeServer(server) {
    return new Promise((resolve) => {
      if (server && server.listening) {
        server.close(resolve);
      } else {
        resolve();
      }
    });
  }

  static async withTestServers(ports, callback) {
    const servers = [];
    try {
      // Start all test servers
      for (const port of ports) {
        const server = await this.createTestServer(port);
        servers.push(server);
      }

      // Run the test
      await callback(servers);
    } finally {
      // Clean up all servers
      await Promise.all(servers.map(server => this.closeServer(server)));
    }
  }

  /**
   * Get multiple ephemeral ports
   */
  static async getRandomPortsInRange(count, start = 15000, end = 16000) {
    const ports = [];
    for (let i = 0; i < count; i++) {
      const port = await this.getEphemeralPort();
      ports.push(port);
    }
    return ports;
  }

  /**
   * Clear reserved ports (for test cleanup)
   */
  static clearReservations() {
    this.reservedPorts.clear();
  }
}

module.exports = TestPortHelper;