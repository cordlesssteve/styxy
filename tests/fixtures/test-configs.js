/**
 * Test configuration fixtures
 */

const path = require('path');

const getTestConfig = (overrides = {}) => ({
  listen_port: 0, // Use dynamic port assignment
  log_level: 'error', // Reduce noise in tests
  cleanup_interval: 5, // Faster cleanup for tests
  service_types: {
    dev: { preferred_ports: [3000, 3001], range: [3000, 3099] },
    api: { preferred_ports: [8000, 8001], range: [8000, 8099] },
    test: { preferred_ports: [9000, 9001], range: [9000, 9099] },
    storybook: { preferred_ports: [6006, 6007], range: [6006, 6010] },
    docs: { preferred_ports: [4000, 4001], range: [4000, 4099] }
  },
  ...overrides
});

const getTestPortRange = () => ({
  start: 10000, // Use high ports to avoid conflicts
  end: 10999
});

module.exports = {
  getTestConfig,
  getTestPortRange
};