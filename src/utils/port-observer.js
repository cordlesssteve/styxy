/**
 * Port Observer - Passive Port Monitoring System
 *
 * Watches for port bindings across the system and tracks ownership
 * without requiring explicit allocation calls.
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

class PortObserver {
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.scanInterval = options.scanInterval || 10000; // 10 seconds default
    this.scanTimer = null;
    this.isScanning = false;

    // Cached observations: port -> { pid, process, command, timestamp, service_type }
    this.observations = new Map();

    // Track which Claude instances are active
    this.instances = new Map(); // instance_id -> { project_path, last_seen }
  }

  /**
   * Start periodic port observation
   */
  start() {
    if (this.scanTimer) {
      this.logger.warn('Port observer already running');
      return;
    }

    this.logger.info('Starting port observer', { interval: this.scanInterval });

    // Initial scan
    this.scan();

    // Schedule periodic scans
    this.scanTimer = setInterval(() => {
      this.scan();
    }, this.scanInterval);
  }

  /**
   * Stop periodic observation
   */
  stop() {
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
      this.logger.info('Port observer stopped');
    }
  }

  /**
   * Perform a port scan and update observations
   */
  async scan() {
    if (this.isScanning) {
      this.logger.debug('Scan already in progress, skipping');
      return;
    }

    this.isScanning = true;

    try {
      const boundPorts = await this.getSystemPortBindings();

      // Update observations
      const now = Date.now();
      const currentPorts = new Set();

      for (const binding of boundPorts) {
        currentPorts.add(binding.port);

        // Add or update observation
        this.observations.set(binding.port, {
          pid: binding.pid,
          process: binding.process,
          command: binding.command,
          timestamp: now,
          service_type: this.inferServiceType(binding.command),
          instance_id: this.inferInstanceId(binding.command, binding.cwd)
        });
      }

      // Remove observations for ports that are no longer bound
      for (const [port, observation] of this.observations) {
        if (!currentPorts.has(port)) {
          this.logger.debug('Port released', { port, pid: observation.pid });
          this.observations.delete(port);
        }
      }

      this.logger.debug('Port scan complete', {
        bound_ports: currentPorts.size,
        observations: this.observations.size
      });

    } catch (error) {
      this.logger.error('Port scan failed', { error: error.message });
    } finally {
      this.isScanning = false;
    }
  }

  /**
   * Get all port bindings from the operating system
   */
  async getSystemPortBindings() {
    const bindings = [];

    try {
      // Use lsof to get detailed port information
      // -i :port-range gets internet connections
      // -P prevents port name resolution (show numbers)
      // -n prevents hostname resolution (faster)
      const { stdout } = await execAsync('lsof -i -P -n | grep LISTEN', {
        timeout: 5000
      });

      const lines = stdout.trim().split('\n');

      for (const line of lines) {
        const parsed = this.parsePortLine(line);
        if (parsed) {
          bindings.push(parsed);
        }
      }

    } catch (error) {
      // lsof might not be available or might fail
      this.logger.debug('lsof failed, trying netstat', { error: error.message });

      try {
        // Fallback to netstat
        const { stdout } = await execAsync('netstat -tulpn 2>/dev/null | grep LISTEN', {
          timeout: 5000
        });

        const lines = stdout.trim().split('\n');

        for (const line of lines) {
          const parsed = this.parseNetstatLine(line);
          if (parsed) {
            bindings.push(parsed);
          }
        }
      } catch (netstatError) {
        // Last resort: ss command (modern Linux)
        try {
          const { stdout } = await execAsync('ss -tulpn | grep LISTEN', {
            timeout: 5000
          });

          const lines = stdout.trim().split('\n');

          for (const line of lines) {
            const parsed = this.parseSsLine(line);
            if (parsed) {
              bindings.push(parsed);
            }
          }
        } catch (ssError) {
          this.logger.error('All port scanning methods failed');
        }
      }
    }

    return bindings;
  }

  /**
   * Parse lsof output line
   * Format: COMMAND  PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME
   */
  parsePortLine(line) {
    const parts = line.trim().split(/\s+/);

    if (parts.length < 9) return null;

    const command = parts[0];
    const pid = parseInt(parts[1], 10);
    const name = parts[8]; // e.g., "*:8080" or "127.0.0.1:8080"

    const portMatch = name.match(/:(\d+)$/);
    if (!portMatch) return null;

    const port = parseInt(portMatch[1], 10);

    return {
      port,
      pid,
      process: command,
      command: this.getProcessCommand(pid),
      cwd: this.getProcessCwd(pid)
    };
  }

  /**
   * Parse netstat output line
   */
  parseNetstatLine(line) {
    const parts = line.trim().split(/\s+/);

    if (parts.length < 6) return null;

    const localAddress = parts[3]; // e.g., "0.0.0.0:8080"
    const pidProgram = parts[6]; // e.g., "1234/node"

    const portMatch = localAddress.match(/:(\d+)$/);
    if (!portMatch) return null;

    const port = parseInt(portMatch[1], 10);

    const pidMatch = pidProgram.match(/^(\d+)\/(.+)$/);
    if (!pidMatch) return null;

    const pid = parseInt(pidMatch[1], 10);
    const process = pidMatch[2];

    return {
      port,
      pid,
      process,
      command: this.getProcessCommand(pid),
      cwd: this.getProcessCwd(pid)
    };
  }

  /**
   * Parse ss output line
   */
  parseSsLine(line) {
    const parts = line.trim().split(/\s+/);

    if (parts.length < 5) return null;

    const localAddress = parts[4]; // e.g., "*:8080"

    const portMatch = localAddress.match(/:(\d+)$/);
    if (!portMatch) return null;

    const port = parseInt(portMatch[1], 10);

    // ss shows process info in format: users:(("node",pid=1234,fd=20))
    const processMatch = line.match(/users:\(\("([^"]+)",pid=(\d+)/);
    if (!processMatch) return null;

    const process = processMatch[1];
    const pid = parseInt(processMatch[2], 10);

    return {
      port,
      pid,
      process,
      command: this.getProcessCommand(pid),
      cwd: this.getProcessCwd(pid)
    };
  }

  /**
   * Get full command line for a process
   */
  getProcessCommand(pid) {
    try {
      const { execSync } = require('child_process');
      const command = execSync(`ps -p ${pid} -o command=`, {
        encoding: 'utf8',
        timeout: 1000
      }).trim();
      return command;
    } catch (error) {
      return 'unknown';
    }
  }

  /**
   * Get working directory for a process
   */
  getProcessCwd(pid) {
    try {
      const { execSync } = require('child_process');
      const cwd = execSync(`lsof -p ${pid} -d cwd -Fn | grep '^n' | cut -c2-`, {
        encoding: 'utf8',
        timeout: 1000
      }).trim();
      return cwd || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Infer service type from command
   */
  inferServiceType(command) {
    if (!command || command === 'unknown') return 'unknown';

    const cmd = command.toLowerCase();

    // Development servers
    if (cmd.includes('npm') && (cmd.includes('dev') || cmd.includes('start'))) return 'dev';
    if (cmd.includes('next dev')) return 'dev';
    if (cmd.includes('vite')) return 'dev';
    if (cmd.includes('webpack-dev-server')) return 'dev';
    if (cmd.includes('react-scripts start')) return 'dev';
    if (cmd.includes('http.server')) return 'http-server'; // Python http.server

    // Testing
    if (cmd.includes('cypress')) return 'test';
    if (cmd.includes('playwright')) return 'test';
    if (cmd.includes('jest')) return 'test';

    // Storybook
    if (cmd.includes('storybook')) return 'storybook';

    // API servers
    if (cmd.includes('uvicorn')) return 'api';
    if (cmd.includes('fastapi')) return 'api';
    if (cmd.includes('django') && cmd.includes('runserver')) return 'api';
    if (cmd.includes('flask')) return 'api';

    // Documentation
    if (cmd.includes('docusaurus')) return 'docs';
    if (cmd.includes('mkdocs')) return 'docs';

    // Database
    if (cmd.includes('mongod')) return 'database';
    if (cmd.includes('postgres')) return 'database';
    if (cmd.includes('redis-server')) return 'database';

    // Functions
    if (cmd.includes('firebase') && cmd.includes('emulator')) return 'functions';

    // Default
    return 'unknown';
  }

  /**
   * Infer Claude instance ID from command or cwd
   */
  inferInstanceId(command, cwd) {
    // Try to extract from environment variables in command
    const envMatch = command?.match(/CLAUDE_INSTANCE_ID=([^\s]+)/);
    if (envMatch) return envMatch[1];

    // Try to extract from working directory
    if (cwd) {
      // Look for common patterns in project paths
      const pathParts = cwd.split('/');

      // Check if running from a Claude Code project
      if (pathParts.includes('projects')) {
        const projectIndex = pathParts.indexOf('projects');
        if (projectIndex < pathParts.length - 1) {
          return `claude-${pathParts[projectIndex + 1]}`;
        }
      }
    }

    return 'unknown';
  }

  /**
   * Register a Claude instance
   */
  registerInstance(instanceId, metadata = {}) {
    this.instances.set(instanceId, {
      ...metadata,
      last_seen: Date.now()
    });
  }

  /**
   * Get observation for a specific port
   */
  getObservation(port) {
    return this.observations.get(port) || null;
  }

  /**
   * Get all observations
   */
  getAllObservations() {
    return Array.from(this.observations.entries()).map(([port, obs]) => ({
      port,
      ...obs
    }));
  }

  /**
   * Suggest available ports for a service type
   */
  suggestPorts(serviceType, count = 5) {
    // Get the range for this service type (would come from config)
    const ranges = this.getServiceRanges();
    const range = ranges[serviceType] || ranges['dev']; // Default to dev range

    const [start, end] = range;
    const suggestions = [];

    for (let port = start; port <= end && suggestions.length < count; port++) {
      if (!this.observations.has(port)) {
        suggestions.push(port);
      }
    }

    return suggestions;
  }

  /**
   * Get service type port ranges (hardcoded for now, should come from config)
   */
  getServiceRanges() {
    return {
      dev: [3000, 3099],
      api: [8000, 8099],
      test: [9000, 9099],
      storybook: [6000, 6099],
      docs: [4000, 4099],
      database: [5430, 5499],
      functions: [5000, 5099],
      'http-server': [8000, 8099], // Python http.server (same as api)
      unknown: [10000, 10099]
    };
  }

  /**
   * Get statistics about observed ports
   */
  getStats() {
    const byServiceType = {};
    const byInstance = {};

    for (const [port, obs] of this.observations) {
      // Count by service type
      byServiceType[obs.service_type] = (byServiceType[obs.service_type] || 0) + 1;

      // Count by instance
      byInstance[obs.instance_id] = (byInstance[obs.instance_id] || 0) + 1;
    }

    return {
      total_ports: this.observations.size,
      by_service_type: byServiceType,
      by_instance: byInstance,
      active_instances: this.instances.size
    };
  }
}

module.exports = PortObserver;
