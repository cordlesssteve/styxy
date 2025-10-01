/**
 * Simple unit tests for port availability checking (Feature #3, Phase 1)
 */

const net = require('net');

/**
 * Check if a port is actually available at OS level
 */
async function checkPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();

    const cleanup = () => {
      try {
        if (server.listening) {
          server.close();
        }
      } catch (err) {
        // Ignore
      }
    };

    const timeout = setTimeout(() => {
      cleanup();
      resolve(false);
    }, 1000);

    server.once('error', (err) => {
      clearTimeout(timeout);
      cleanup();
      resolve(false);
    });

    server.once('listening', () => {
      clearTimeout(timeout);
      cleanup();
      resolve(true);
    });

    try {
      server.listen(port, '127.0.0.1');
    } catch (err) {
      clearTimeout(timeout);
      cleanup();
      resolve(false);
    }
  });
}

describe('Port Availability Check - Simple Unit Tests', () => {
  test('should return true for available high port', async () => {
    const port = 54321;
    const available = await checkPortAvailable(port);
    expect(available).toBe(true);
  });

  test('should return false for port in use', async () => {
    const port = 54322;

    // Start server
    const server = net.createServer();
    await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));

    // Check availability - should be false
    const available = await checkPortAvailable(port);
    expect(available).toBe(false);

    // Cleanup
    server.close();
  });

  test('should handle multiple availability checks', async () => {
    const results = await Promise.all([
      checkPortAvailable(54323),
      checkPortAvailable(54324),
      checkPortAvailable(54325)
    ]);

    expect(results).toEqual([true, true, true]);
  });
});
