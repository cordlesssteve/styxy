/**
 * Port Scanner Utility
 *
 * Provides OS-level port availability checking using system tools
 * like lsof, netstat, and ss for cross-platform compatibility.
 */

const { execSync } = require('child_process');
const os = require('os');

class PortScanner {
  constructor() {
    this.platform = os.platform();
    this.cache = new Map();
    this.cacheTimeout = 5000; // 5 seconds cache
  }

  /**
   * Check if a port is actually available at the OS level
   */
  async isPortAvailable(port) {
    const cacheKey = `port_${port}`;
    const cached = this.cache.get(cacheKey);

    if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
      return cached.available;
    }

    let available = true;

    try {
      // Try multiple detection methods for reliability
      const methods = [
        () => this.checkWithSS(port),
        () => this.checkWithLsof(port),
        () => this.checkWithNetstat(port)
      ];

      for (const method of methods) {
        try {
          const result = await method();
          if (result !== null) {
            available = result;
            break;
          }
        } catch (error) {
          // Continue to next method if this one fails
          continue;
        }
      }
    } catch (error) {
      // If all methods fail, assume available (fallback behavior)
      console.warn(`Port availability check failed for ${port}:`, error.message);
      available = true;
    }

    // Cache the result
    this.cache.set(cacheKey, {
      available,
      timestamp: Date.now()
    });

    return available;
  }

  /**
   * Get detailed information about what's using a port
   */
  async getPortInfo(port) {
    try {
      const methods = [
        () => this.getPortInfoWithSS(port),
        () => this.getPortInfoWithLsof(port),
        () => this.getPortInfoWithNetstat(port)
      ];

      for (const method of methods) {
        try {
          const result = await method();
          if (result) {
            return result;
          }
        } catch (error) {
          continue;
        }
      }

      return null;
    } catch (error) {
      console.warn(`Port info lookup failed for ${port}:`, error.message);
      return null;
    }
  }

  /**
   * Check port availability using ss (modern Linux)
   */
  async checkWithSS(port) {
    try {
      const result = execSync(`ss -tlnp | grep :${port}`, {
        encoding: 'utf8',
        timeout: 3000,
        stdio: ['ignore', 'pipe', 'ignore']
      });

      // If ss finds anything, port is not available
      return result.trim().length === 0;
    } catch (error) {
      if (error.status === 1) {
        // ss returns 1 when no matches found (port available)
        return true;
      }
      throw error;
    }
  }

  /**
   * Check port availability using lsof (Unix-like systems)
   */
  async checkWithLsof(port) {
    try {
      const result = execSync(`lsof -i :${port}`, {
        encoding: 'utf8',
        timeout: 3000,
        stdio: ['ignore', 'pipe', 'ignore']
      });

      // If lsof finds anything, port is not available
      return result.trim().length === 0;
    } catch (error) {
      if (error.status === 1) {
        // lsof returns 1 when no matches found (port available)
        return true;
      }
      throw error;
    }
  }

  /**
   * Check port availability using netstat (cross-platform fallback)
   */
  async checkWithNetstat(port) {
    try {
      let cmd;
      if (this.platform === 'win32') {
        cmd = `netstat -an | findstr :${port}`;
      } else {
        cmd = `netstat -tlnp | grep :${port}`;
      }

      const result = execSync(cmd, {
        encoding: 'utf8',
        timeout: 3000,
        stdio: ['ignore', 'pipe', 'ignore']
      });

      // If netstat finds anything, port is not available
      return result.trim().length === 0;
    } catch (error) {
      if (error.status === 1) {
        // netstat returns 1 when no matches found (port available)
        return true;
      }
      throw error;
    }
  }

  /**
   * Get detailed port info using ss
   */
  async getPortInfoWithSS(port) {
    try {
      const result = execSync(`ss -tlnp | grep :${port}`, {
        encoding: 'utf8',
        timeout: 3000,
        stdio: ['ignore', 'pipe', 'ignore']
      });

      if (!result.trim()) {
        return null;
      }

      return this.parseSSOutput(result, port);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get detailed port info using lsof
   */
  async getPortInfoWithLsof(port) {
    try {
      const result = execSync(`lsof -i :${port} -P`, {
        encoding: 'utf8',
        timeout: 3000,
        stdio: ['ignore', 'pipe', 'ignore']
      });

      if (!result.trim()) {
        return null;
      }

      return this.parseLsofOutput(result, port);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get detailed port info using netstat
   */
  async getPortInfoWithNetstat(port) {
    try {
      let cmd;
      if (this.platform === 'win32') {
        cmd = `netstat -ano | findstr :${port}`;
      } else {
        cmd = `netstat -tlnp | grep :${port}`;
      }

      const result = execSync(cmd, {
        encoding: 'utf8',
        timeout: 3000,
        stdio: ['ignore', 'pipe', 'ignore']
      });

      if (!result.trim()) {
        return null;
      }

      return this.parseNetstatOutput(result, port);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Parse ss command output
   */
  parseSSOutput(output, port) {
    const lines = output.trim().split('\n');
    const info = [];

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 5) {
        const processInfo = parts[parts.length - 1];
        const localAddress = parts[3];

        info.push({
          port: parseInt(port),
          protocol: parts[0].toLowerCase(),
          state: parts[1],
          local_address: localAddress,
          process: this.parseProcessInfo(processInfo),
          tool: 'ss'
        });
      }
    }

    return info.length > 0 ? info[0] : null;
  }

  /**
   * Parse lsof command output
   */
  parseLsofOutput(output, port) {
    const lines = output.trim().split('\n');

    // Skip header line if present
    const dataLines = lines.filter(line => !line.startsWith('COMMAND'));

    if (dataLines.length === 0) {
      return null;
    }

    const line = dataLines[0];
    const parts = line.trim().split(/\s+/);

    if (parts.length >= 8) {
      return {
        port: parseInt(port),
        protocol: parts[7].includes('TCP') ? 'tcp' : 'udp',
        process: {
          name: parts[0],
          pid: parseInt(parts[1]),
          user: parts[2]
        },
        local_address: parts[8],
        tool: 'lsof'
      };
    }

    return null;
  }

  /**
   * Parse netstat command output
   */
  parseNetstatOutput(output, port) {
    const lines = output.trim().split('\n');

    if (lines.length === 0) {
      return null;
    }

    const line = lines[0];
    const parts = line.trim().split(/\s+/);

    if (this.platform === 'win32') {
      // Windows netstat format
      if (parts.length >= 4) {
        return {
          port: parseInt(port),
          protocol: parts[0].toLowerCase(),
          local_address: parts[1],
          state: parts[3],
          process: { pid: parts[4] ? parseInt(parts[4]) : null },
          tool: 'netstat'
        };
      }
    } else {
      // Unix netstat format
      if (parts.length >= 6) {
        return {
          port: parseInt(port),
          protocol: parts[0].toLowerCase(),
          local_address: parts[3],
          state: parts[5],
          process: this.parseProcessInfo(parts[6]),
          tool: 'netstat'
        };
      }
    }

    return null;
  }

  /**
   * Parse process information from command output
   */
  parseProcessInfo(processStr) {
    if (!processStr || processStr === '-') {
      return null;
    }

    // Format: "pid/command" or just "pid"
    const match = processStr.match(/^(\d+)(?:\/(.+))?$/);
    if (match) {
      return {
        pid: parseInt(match[1]),
        name: match[2] || null
      };
    }

    return { name: processStr };
  }

  /**
   * Clear the cache
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * Get multiple port statuses efficiently
   */
  async checkMultiplePorts(ports) {
    const results = new Map();

    // Process in parallel for better performance
    const promises = ports.map(async (port) => {
      const available = await this.isPortAvailable(port);
      results.set(port, available);
    });

    await Promise.all(promises);
    return results;
  }
}

module.exports = PortScanner;