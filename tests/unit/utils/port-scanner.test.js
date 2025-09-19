/**
 * Unit tests for PortScanner class
 */

const PortScanner = require('../../../src/utils/port-scanner');
const { execSync } = require('child_process');

// Mock child_process to avoid actual system calls
jest.mock('child_process');

describe('PortScanner', () => {
  let portScanner;

  beforeEach(() => {
    portScanner = new PortScanner();
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default values', () => {
      expect(portScanner.platform).toBe(process.platform);
      expect(portScanner.cache).toBeInstanceOf(Map);
      expect(portScanner.cacheTimeout).toBe(5000);
    });
  });

  describe('isPortAvailable', () => {
    it('should return cached result when available', async () => {
      // Set up cache
      portScanner.cache.set('port_3000', {
        available: true,
        timestamp: Date.now()
      });

      const result = await portScanner.isPortAvailable(3000);

      expect(result).toBe(true);
      expect(execSync).not.toHaveBeenCalled();
    });

    it('should check with ss when cache expired', async () => {
      // Set up expired cache
      portScanner.cache.set('port_3000', {
        available: false,
        timestamp: Date.now() - 10000 // 10 seconds ago
      });

      execSync.mockReturnValue(''); // Empty result means port available

      const result = await portScanner.isPortAvailable(3000);

      expect(result).toBe(true);
      expect(execSync).toHaveBeenCalledWith(
        'ss -tlnp',
        expect.any(Object)
      );
    });

    it('should fall back to other methods when ss fails', async () => {
      execSync
        .mockImplementationOnce(() => {
          throw new Error('ss not found');
        })
        .mockReturnValue(''); // lsof succeeds

      const result = await portScanner.isPortAvailable(3000);

      expect(result).toBe(true);
      expect(execSync).toHaveBeenCalledWith(
        'lsof -i :3000',
        expect.any(Object)
      );
    });

    it('should handle all methods failing gracefully', async () => {
      execSync.mockImplementation(() => {
        throw new Error('Command failed');
      });

      const result = await portScanner.isPortAvailable(3000);

      expect(result).toBe(true); // Fallback to available
    });
  });

  describe('checkWithSS', () => {
    it('should return true when ss finds no results', async () => {
      execSync.mockReturnValue('');

      const result = await portScanner.checkWithSS(3000);

      expect(result).toBe(true);
    });

    it('should return false when ss finds port usage', async () => {
      execSync.mockReturnValue('LISTEN 0 128 *:3000 *:*');

      const result = await portScanner.checkWithSS(3000);

      expect(result).toBe(false);
    });

    it('should return true when ss exits with status 1', async () => {
      const error = new Error('Command failed');
      error.status = 1;
      execSync.mockImplementation(() => {
        throw error;
      });

      const result = await portScanner.checkWithSS(3000);

      expect(result).toBe(true);
    });
  });

  describe('checkWithLsof', () => {
    it('should return true when lsof finds no results', async () => {
      execSync.mockReturnValue('');

      const result = await portScanner.checkWithLsof(3000);

      expect(result).toBe(true);
    });

    it('should return false when lsof finds port usage', async () => {
      execSync.mockReturnValue('node 1234 user TCP *:3000 (LISTEN)');

      const result = await portScanner.checkWithLsof(3000);

      expect(result).toBe(false);
    });
  });

  describe('getPortInfo', () => {
    it('should return null when no port info found', async () => {
      execSync.mockReturnValue('');

      const result = await portScanner.getPortInfo(3000);

      expect(result).toBeNull();
    });

    it('should return parsed port info from ss', async () => {
      execSync.mockReturnValue('tcp LISTEN 0 128 *:3000 *:* users:(("node",pid=1234,fd=10))');

      const result = await portScanner.getPortInfo(3000);

      expect(result).toEqual({
        port: 3000,
        protocol: 'tcp',
        state: 'LISTEN',
        local_address: '128',
        process: {
          name: 'users:(("node",pid=1234,fd=10))'
        },
        tool: 'ss'
      });
    });
  });

  describe('parseSSOutput', () => {
    it('should parse ss output correctly', () => {
      const output = 'tcp LISTEN 0 128 *:3000 *:* users:(("node",pid=1234,fd=10))';

      const result = portScanner.parseSSOutput(output, 3000);

      expect(result).toEqual({
        port: 3000,
        protocol: 'tcp',
        state: 'LISTEN',
        local_address: '128',
        process: {
          name: 'users:(("node",pid=1234,fd=10))'
        },
        tool: 'ss'
      });
    });
  });

  describe('parseLsofOutput', () => {
    it('should parse lsof output correctly', () => {
      const output = 'COMMAND  PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME\nnode    1234 user   10u  IPv4  12345      0t0  TCP *:3000 (LISTEN)';

      const result = portScanner.parseLsofOutput(output, 3000);

      expect(result).toEqual({
        port: 3000,
        protocol: 'tcp',
        process: {
          name: 'node',
          pid: 1234,
          user: 'user'
        },
        local_address: '*:3000',
        tool: 'lsof'
      });
    });

    it('should handle output without header', () => {
      const output = 'node    1234 user   10u  IPv4  12345      0t0  TCP *:3000 (LISTEN)';

      const result = portScanner.parseLsofOutput(output, 3000);

      expect(result).toEqual({
        port: 3000,
        protocol: 'tcp',
        process: {
          name: 'node',
          pid: 1234,
          user: 'user'
        },
        local_address: '*:3000',
        tool: 'lsof'
      });
    });
  });

  describe('parseProcessInfo', () => {
    it('should parse process info with pid and name', () => {
      const result = portScanner.parseProcessInfo('1234/node');

      expect(result).toEqual({
        pid: 1234,
        name: 'node'
      });
    });

    it('should parse process info with only pid', () => {
      const result = portScanner.parseProcessInfo('1234');

      expect(result).toEqual({
        pid: 1234,
        name: null
      });
    });

    it('should handle empty or dash input', () => {
      expect(portScanner.parseProcessInfo('')).toBeNull();
      expect(portScanner.parseProcessInfo('-')).toBeNull();
    });
  });

  describe('clearCache', () => {
    it('should clear the cache', () => {
      portScanner.cache.set('test', 'value');
      expect(portScanner.cache.size).toBe(1);

      portScanner.clearCache();

      expect(portScanner.cache.size).toBe(0);
    });
  });

  describe('checkMultiplePorts', () => {
    it('should check multiple ports in parallel', async () => {
      execSync.mockReturnValue(''); // All ports available

      const ports = [3000, 3001, 3002];
      const results = await portScanner.checkMultiplePorts(ports);

      expect(results.size).toBe(3);
      expect(results.get(3000)).toBe(true);
      expect(results.get(3001)).toBe(true);
      expect(results.get(3002)).toBe(true);
    });
  });
});