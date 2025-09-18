/**
 * Helper utilities for CLI testing
 */

const spawn = require('cross-spawn');
const path = require('path');

class TestCliHelper {
  constructor(daemonPort) {
    this.daemonPort = daemonPort;
    this.cliPath = path.join(__dirname, '../../bin/styxy');
  }

  async run(args = [], options = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn('node', [this.cliPath, ...args], {
        stdio: 'pipe',
        env: {
          ...process.env,
          STYXY_DAEMON_PORT: this.daemonPort?.toString(),
          ...options.env
        },
        ...options
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        resolve({
          code,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          success: code === 0
        });
      });

      child.on('error', reject);

      // Kill process after timeout
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error('CLI command timed out'));
      }, options.timeout || 10000);

      child.on('close', () => clearTimeout(timeout));
    });
  }

  /**
   * Run command with JSON output and parse result
   */
  async runJson(args = [], options = {}) {
    const result = await this.run([...args, '--json'], options);

    if (result.stdout) {
      try {
        result.json = JSON.parse(result.stdout);
      } catch (error) {
        result.json = null;
        result.parseError = error.message;
      }
    }

    return result;
  }

  async allocate(serviceType, options = {}) {
    const args = ['allocate', '-s', serviceType];

    if (options.port) {
      args.push('-p', options.port.toString());
    }

    if (options.name) {
      args.push('-n', options.name);
    }

    if (options.project) {
      args.push('--project', options.project);
    }

    return this.run(args);
  }

  async release(lockId) {
    return this.run(['release', lockId]);
  }

  async check(port) {
    return this.run(['check', port.toString()]);
  }

  async list(options = {}) {
    const args = ['list'];
    if (options.verbose) {
      args.push('-v');
    }
    return this.run(args);
  }

  async scan(options = {}) {
    const args = ['scan'];
    if (options.start) {
      args.push('-s', options.start.toString());
    }
    if (options.end) {
      args.push('-e', options.end.toString());
    }
    return this.run(args);
  }

  async cleanup(options = {}) {
    const args = ['cleanup'];
    if (options.force) {
      args.push('-f');
    }
    return this.run(args);
  }

  async instances() {
    return this.run(['instances']);
  }

  async daemonCommand(action, options = {}) {
    const args = ['daemon', action];
    if (options.port) {
      args.push('-p', options.port.toString());
    }
    if (options.detach) {
      args.push('-d');
    }
    return this.run(args);
  }
}

module.exports = TestCliHelper;