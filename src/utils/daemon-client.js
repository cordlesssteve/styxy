/**
 * Daemon client utility with smart port discovery
 */

/**
 * Discover the daemon URL with fallback strategy
 */
async function getDaemonUrl() {
  // 1. Check environment variable override
  const portOverride = process.env.STYXY_DAEMON_PORT;
  if (portOverride) {
    return `http://127.0.0.1:${portOverride}`;
  }

  // 2. Try auto-discovery on common ports
  const commonPorts = [9876, 9877, 9878, 9879, 9880];

  for (const port of commonPorts) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/status`, {
        signal: AbortSignal.timeout(1000) // 1 second timeout
      });

      if (response.ok) {
        const data = await response.json();
        if (data.status === 'running') {
          return `http://127.0.0.1:${port}`;
        }
      }
    } catch (error) {
      // Continue to next port
      continue;
    }
  }

  // 3. Fallback to default
  return 'http://127.0.0.1:9876';
}

/**
 * Make a request to the daemon with automatic URL discovery
 */
async function daemonRequest(endpoint, options = {}) {
  const baseUrl = await getDaemonUrl();
  const url = `${baseUrl}${endpoint}`;

  try {
    const response = await fetch(url, options);
    return response;
  } catch (error) {
    if (error.code === 'ECONNREFUSED' || error.name === 'TypeError') {
      throw new Error('Styxy daemon is not running. Start it with: styxy daemon start');
    }
    throw error;
  }
}

module.exports = {
  getDaemonUrl,
  daemonRequest
};